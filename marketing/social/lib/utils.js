'use strict';

/**
 * marketing/social/lib/utils.js
 *
 * Shared utilities for populate-weekly-calendar.js and social-poster-script.js.
 * No external dependencies — built-in Node.js modules only.
 */

const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const crypto   = require('crypto');

// ─── Retry ────────────────────────────────────────────────────────────────────

/**
 * Calls fn() up to opts.attempts times with exponential backoff.
 * Delays: baseDelay, baseDelay*2, baseDelay*4, …
 *
 * @param {() => Promise<any>} fn
 * @param {{ attempts?: number, baseDelay?: number, label?: string }} opts
 * @returns {Promise<any>}
 */
async function withRetry(fn, { attempts = 3, baseDelay = 1000, label = 'call' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`  [retry] ${label} failed (attempt ${i + 1}/${attempts}): ${err.message}`);
        console.log(`  [retry] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// ─── UTC date helpers ─────────────────────────────────────────────────────────

/** Formats a Date as YYYY-MM-DD using UTC fields (never local time). */
function utcIso(d) {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** Returns today's date as YYYY-MM-DD in UTC. */
function utcTodayIso() {
  return utcIso(new Date());
}

/** ISO week number (1–53) computed purely from UTC fields. */
function isoWeekNumberUtc(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

/** Current ISO week number in UTC. */
function currentIsoWeekUtc() {
  return isoWeekNumberUtc(new Date());
}

// ─── Content validation ───────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_CAPTION_LENGTH = 2200;
const MIN_HASHTAGS = 5;
const MAX_HASHTAGS = 10;
const MIN_PROMPT_LENGTH = 50;

/**
 * Validates and normalises a Gemini-generated post object.
 * Mutates the post in place (truncates caption if needed).
 *
 * @param {object} post
 * @param {string[]} validDates  Array of YYYY-MM-DD strings for the target week
 * @returns {{ valid: boolean, warnings: string[], post: object }}
 */
function validatePost(post, validDates = []) {
  const warnings = [];
  const p = { ...post };

  // 1. Caption length
  if (!p.caption) {
    return { valid: false, warnings: ['caption is empty'], post: null };
  }
  if (p.caption.length > MAX_CAPTION_LENGTH) {
    warnings.push(`caption truncated from ${p.caption.length} to ${MAX_CAPTION_LENGTH} chars`);
    p.caption = p.caption.slice(0, MAX_CAPTION_LENGTH - 1) + '…';
  }

  // 2. Hashtag count
  const tags = String(p.hashtags || '')
    .split(/\s+/)
    .filter((t) => t.startsWith('#'));
  if (tags.length < MIN_HASHTAGS) {
    warnings.push(`only ${tags.length} hashtag(s) — recommend at least ${MIN_HASHTAGS}`);
  } else if (tags.length > MAX_HASHTAGS) {
    warnings.push(`${tags.length} hashtags — trim to ${MAX_HASHTAGS} for best reach`);
  }

  // 3. Day/date alignment
  if (p.scheduled_date && p.day_of_week) {
    const dateIdx = validDates.indexOf(p.scheduled_date);
    if (dateIdx !== -1) {
      const expectedDay = DAYS_OF_WEEK[dateIdx];
      if (expectedDay && expectedDay.toLowerCase() !== p.day_of_week.toLowerCase()) {
        warnings.push(
          `day_of_week "${p.day_of_week}" does not match scheduled_date "${p.scheduled_date}" (expected "${expectedDay}") — correcting`
        );
        p.day_of_week = expectedDay;
      }
    }
  }

  // 4. Prompt length
  if (!p.prompt || p.prompt.length < MIN_PROMPT_LENGTH) {
    warnings.push(`prompt is very short (${(p.prompt || '').length} chars) — image quality may suffer`);
  }

  return { valid: true, warnings, post: p };
}

// ─── Lock file ────────────────────────────────────────────────────────────────

function lockPath(scriptName) {
  return path.join(os.tmpdir(), `paysplit-social-${scriptName}.lock`);
}

/**
 * Acquires a lock file. Returns true if acquired, false if already locked.
 * Uses O_EXCL (atomic create) so concurrent processes cannot both succeed.
 *
 * @param {string} scriptName  e.g. 'populate' or 'poster'
 * @returns {boolean}
 */
function acquireLock(scriptName) {
  const lp = lockPath(scriptName);
  try {
    fs.writeFileSync(lp, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Check if the locking process is still alive
      try {
        const pid = Number(fs.readFileSync(lp, 'utf8').trim());
        process.kill(pid, 0); // throws if process doesn't exist
        return false; // still running
      } catch {
        // Stale lock — previous run crashed without cleanup
        fs.unlinkSync(lp);
        fs.writeFileSync(lp, String(process.pid), { flag: 'wx' });
        return true;
      }
    }
    throw err;
  }
}

/**
 * Releases the lock file. Call in a finally block.
 * @param {string} scriptName
 */
function releaseLock(scriptName) {
  try {
    fs.unlinkSync(lockPath(scriptName));
  } catch {
    // Best-effort; file may already be gone
  }
}

// ─── Google service-account token ────────────────────────────────────────────

/**
 * Exchanges a Google service-account JSON key for a short-lived Bearer token.
 * The token is valid for 1 hour. Call once per run and reuse.
 *
 * @param {string} jsonPath  Absolute path to the service-account JSON file
 * @returns {Promise<string>}  Access token
 */
async function getServiceAccountToken(jsonPath) {
  const sa = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);

  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const pay = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${hdr}.${pay}`);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${hdr}.${pay}.${sig}`;

  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const parsed = await res.json();
  if (parsed.access_token) return parsed.access_token;
  throw new Error(`Token exchange failed: ${parsed.error_description || JSON.stringify(parsed)}`);
}

// ─── Gemini Vision image evaluator (REST API) ────────────────────────────────

const GEMINI_VISION_MODEL = 'gemini-2.5-flash';
const GEMINI_VISION_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';

const EVAL_PROMPT = `You are evaluating a generated social media image for PaySplit, a bill-splitting app.

Check for these issues:
- Phone/device outline framing the ENTIRE image (the whole scene is inside a phone shape) — major flaw
- Hex colour codes, labels, placeholder text, or brand overlays baked into the scene — major flaw
- Blank or unnatural areas (solid colour bands, empty zones)
- Poor composition or unengaging scene

Return ONLY valid JSON, no markdown:
{
  "score": <integer 1-5>,
  "issues": "<comma-separated list of problems, or empty string if none>"
}

Scoring:
5 = Excellent lifestyle photo, fills the frame, no artifacts
4 = Good, minor imperfections
3 = Acceptable but noticeable problems
2 = Significant flaw (e.g. phone frame around entire image, text artefacts)
1 = Unusable`;

/**
 * Evaluates a raw Imagen-generated image buffer using the Gemini Vision REST API.
 * Sends the image as base64 inline_data. Reads GEMINI_API_KEY from process.env.
 *
 * @param {Buffer} imageBuffer  Raw PNG/JPEG buffer from Imagen
 * @returns {Promise<{ score: number, issues: string }>}
 */
async function evaluateGeneratedImage(imageBuffer) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set — cannot evaluate image');

  const url = `${GEMINI_VISION_BASE}/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/png', data: imageBuffer.toString('base64') } },
          { text: EVAL_PROMPT },
        ],
      }],
      generationConfig: { temperature: 0 },
    }),
  });

  const parsed = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini Vision API ${res.status}: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { score: 0, issues: 'no JSON in eval output' };

  const result = JSON.parse(match[0]);
  return {
    score:  Number(result.score)  || 0,
    issues: String(result.issues || ''),
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  withRetry,
  utcIso,
  utcTodayIso,
  isoWeekNumberUtc,
  currentIsoWeekUtc,
  validatePost,
  acquireLock,
  releaseLock,
  getServiceAccountToken,
  evaluateGeneratedImage,
};
