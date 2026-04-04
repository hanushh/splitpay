#!/usr/bin/env node

/**
 * populate-weekly-calendar.js
 *
 * Runs weekly (via cron) to fill the next week's rows in the Google Spreadsheet
 * content calendar.  Uses Gemini with Google Search grounding to pull in recent
 * happenings and generate on-brand post ideas for PaySplit / PaySplit.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *   1. Computes the target week's dates (default: next ISO week).
 *   2. Calls Gemini with Google Search grounding enabled so the model can look
 *      up recent news (fintech, personal finance, travel, group spending, etc.).
 *   3. Asks the model to return a JSON array of 3–5 post objects, one per
 *      scheduled day, each containing:
 *        - day_of_week, scheduled_date
 *        - prompt   (image-generation prompt for Nano Banana)
 *        - caption  (Instagram / Facebook post copy, ≤ 2 200 chars)
 *        - hashtags (space-separated)
 *        - platforms (instagram,facebook)
 *        - news_hook (the real-world angle that inspired this post)
 *   4. Appends the rows to the Google Spreadsheet so social-poster-script.js
 *      can pick them up and publish them.
 *
 * ── Cron setup ───────────────────────────────────────────────────────────────
 *
 *   Run every Monday at 08:00 to populate the *following* week:
 *
 *     0 8 * * 1  node --env-file /path/to/.env.production \
 *                     /path/to/marketing/social/populate-weekly-calendar.js
 *
 * ── Required environment variables ──────────────────────────────────────────
 *
 *   GEMINI_API_KEY               Google AI Studio / Vertex key
 *   GEMINI_MODEL                 e.g. gemini-2.0-flash  (default)
 *
 *   GOOGLE_SHEETS_API_KEY        Google Sheets REST API key (for reads)
 *   GOOGLE_SPREADSHEET_ID        Spreadsheet ID from its URL
 *   GOOGLE_SHEET_NAME            Tab name (default: Sheet1)
 *   GOOGLE_SERVICE_ACCOUNT_JSON  Path to service-account JSON (needed for writes)
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   node --env-file .env.local marketing/social/populate-weekly-calendar.js
 *
 *   --next-week          Populate next ISO week (default)
 *   --this-week          Populate the current ISO week instead
 *   --week <n>           Populate a specific ISO week number
 *   --posts <n>          Number of posts to generate (default: 4, max: 7)
 *   --dry-run            Generate + print content without writing to the sheet
 *   --help, -h           Show this help
 */

'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const url = require('url');
const { GoogleGenerativeAI, DynamicRetrievalMode } = require('@google/generative-ai');

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_MODEL = 'gemini-2.0-flash';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { nextWeek: true, thisWeek: false, week: null, posts: 4, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--next-week') {
      args.nextWeek = true; args.thisWeek = false;
    } else if (arg === '--this-week') {
      args.thisWeek = true; args.nextWeek = false;
    } else if (arg === '--week' && argv[i + 1]) {
      args.week = Number(argv[i + 1]); args.nextWeek = false; args.thisWeek = false; i += 1;
    } else if (arg === '--posts' && argv[i + 1]) {
      args.posts = Math.min(7, Math.max(1, Number(argv[i + 1]))); i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp(); process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node --env-file .env.local marketing/social/populate-weekly-calendar.js [options]

Options:
  --next-week       Populate next ISO week (default)
  --this-week       Populate the current ISO week
  --week <n>        Populate a specific ISO week number
  --posts <n>       Number of posts to generate: 1–7 (default: 4)
  --dry-run         Print generated posts without writing to the spreadsheet
  --help, -h        Show this help

Cron example (every Monday at 08:00):
  0 8 * * 1  node --env-file /path/.env.production \\
                  /path/marketing/social/populate-weekly-calendar.js

Required env vars:
  GEMINI_API_KEY, GOOGLE_SHEETS_API_KEY, GOOGLE_SPREADSHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_JSON (for writes), GOOGLE_SHEET_NAME (optional)
`);
}

// ─── Environment ──────────────────────────────────────────────────────────────

function assertEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function loadConfig() {
  return {
    geminiApiKey: assertEnv('GEMINI_API_KEY'),
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_MODEL,

    sheetsApiKey: assertEnv('GOOGLE_SHEETS_API_KEY'),
    spreadsheetId: assertEnv('GOOGLE_SPREADSHEET_ID'),
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Sheet1',
    serviceAccountJson: assertEnv('GOOGLE_SERVICE_ACCOUNT_JSON'),
  };
}

// ─── Date / week helpers ──────────────────────────────────────────────────────

function localIso(d) {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function currentIsoWeek() { return isoWeekNumber(new Date()); }

/** Returns the Monday (UTC) of a given ISO week and year. */
function mondayOfIsoWeek(week, year) {
  // Jan 4th is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (dow - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}

function weekDates(mondayDate) {
  return DAYS_OF_WEEK.map((_, i) => {
    const d = new Date(mondayDate);
    d.setUTCDate(mondayDate.getUTCDate() + i);
    return localIso(d);
  });
}

function currentYear() { return new Date().getFullYear(); }

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpRaw(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body ? Buffer.from(body) : null;
    const req = https.request(
      {
        hostname, path, method,
        headers: {
          ...headers,
          ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve(data); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ─── Google service-account token ────────────────────────────────────────────

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
  const res = await httpRaw(
    'oauth2.googleapis.com', '/token', 'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );

  if (!res.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(res)}`);
  return res.access_token;
}

// ─── Google Sheets helpers ────────────────────────────────────────────────────

/** Returns existing header row from the sheet, or the default one if the sheet is empty. */
async function getOrInitHeader(config, token) {
  const range = encodeURIComponent(`${config.sheetName}!1:1`);
  const parsed = new url.URL(
    `${SHEETS_BASE}/${config.spreadsheetId}/values/${range}?key=${config.sheetsApiKey}`
  );

  const res = await httpRaw(
    parsed.hostname,
    parsed.pathname + parsed.search,
    'GET',
    {},
    null
  );

  const existing = res.values?.[0]?.map((h) => String(h).trim().toLowerCase()) ?? [];
  if (existing.length > 0) return existing;

  // Sheet is empty — write the header row first
  const defaultHeader = [
    'week_number', 'week_start', 'scheduled_date', 'day_of_week',
    'prompt', 'caption', 'hashtags', 'platforms',
    'posted', 'posted_at', 'image_url', 'error', 'news_hook',
  ];
  await sheetsWrite(config, token, `${config.sheetName}!A1`, [defaultHeader]);
  return defaultHeader;
}

async function sheetsWrite(config, token, range, values) {
  const encodedRange = encodeURIComponent(range);
  const path =
    `/v4/spreadsheets/${config.spreadsheetId}/values/${encodedRange}` +
    `?valueInputOption=USER_ENTERED`;

  await httpRaw(
    'sheets.googleapis.com',
    path,
    'PUT',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    JSON.stringify({ range, majorDimension: 'ROWS', values })
  );
}

/** Appends rows after the last row that has data. */
async function sheetsAppend(config, token, values) {
  const range = encodeURIComponent(`${config.sheetName}`);
  const path =
    `/v4/spreadsheets/${config.spreadsheetId}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  await httpRaw(
    'sheets.googleapis.com',
    path,
    'POST',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    JSON.stringify({ majorDimension: 'ROWS', values })
  );
}

/** Returns all scheduled_date values already in the sheet for duplicate-checking. */
async function existingScheduledDates(config) {
  const range = encodeURIComponent(`${config.sheetName}`);
  const parsed = new url.URL(
    `${SHEETS_BASE}/${config.spreadsheetId}/values/${range}?key=${config.sheetsApiKey}`
  );

  const res = await httpRaw(
    parsed.hostname, parsed.pathname + parsed.search, 'GET', {}, null
  );

  const rawGrid = res.values || [];
  if (rawGrid.length < 2) return new Set();

  const header = rawGrid[0].map((h) => String(h).trim().toLowerCase());
  const dateCol = header.indexOf('scheduled_date');
  if (dateCol === -1) return new Set();

  const dates = new Set();
  for (let i = 1; i < rawGrid.length; i += 1) {
    const v = rawGrid[i][dateCol];
    if (v) dates.add(String(v).trim());
  }
  return dates;
}

// ─── Gemini content generation ────────────────────────────────────────────────

/**
 * Builds the system prompt that tells Gemini what PaySplit is and what
 * kind of posts to create.
 */
function buildSystemPrompt() {
  return `You are a social-media content strategist for PaySplit (also called PaySplit),
a mobile app that makes splitting bills, group expenses, and shared costs effortless.

Target audience: 18–35-year-olds who travel with friends, share flats, dine out in groups,
or manage any kind of shared expense.

Brand voice: friendly, witty, modern, empowering — never corporate or stuffy.
Brand colours: vibrant green (#17e86b) on dark background.

Your task is to create a week of Instagram/Facebook marketing posts.
Each post must:
  • Tie into a real, timely news story or trend you found via search
  • Naturally connect the trend to a pain point PaySplit solves
  • Feel native to Instagram — conversational, relatable, a little playful
  • Include a vivid image-generation prompt (for Nano Banana / Stable Diffusion)
    that produces a bold 1080×1080 poster. Reference the brand colours.
  • Include a caption (max 2 200 chars) with a clear call-to-action
  • Include 5–10 relevant hashtags`;
}

/**
 * Builds the user prompt that requests a specific week's posts as JSON.
 */
function buildUserPrompt(weekNumber, weekStart, dates, postCount) {
  const dayList = DAYS_OF_WEEK.slice(0, 7)
    .map((d, i) => `  ${d}: ${dates[i]}`)
    .join('\n');

  return `Use Google Search to find the most recent and relevant news stories,
trends, or viral moments related to any of these topics:
  - personal finance & budgeting
  - group travel or holidays
  - dining out, food & nightlife
  - fintech & payment apps
  - friendship, flatmates, or shared living
  - seasonal events happening this week (sports, festivals, holidays)

Based on what you find, create exactly ${postCount} Instagram/Facebook posts
for Week ${weekNumber} (${weekStart}).

Available days and their dates:
${dayList}

Spread the posts across different days (avoid clustering them all on the same day).
Choose the days that make the most sense given the news angle.

Return ONLY valid JSON — no markdown, no commentary, no code fences.
The JSON must be an array of exactly ${postCount} objects, each with these fields:

{
  "day_of_week":      "Monday",          // one of the 7 day names above
  "scheduled_date":  "YYYY-MM-DD",       // matching date for that day
  "prompt":          "...",              // detailed Nano Banana image prompt
  "caption":         "...",              // full post caption with CTA
  "hashtags":        "#splitbills #...", // space-separated hashtags
  "platforms":       "instagram,facebook",
  "news_hook":       "..."               // 1-sentence summary of the news angle used
}`;
}

/**
 * Calls Gemini with Google Search grounding and returns the parsed post array.
 */
async function generatePostsWithGemini(weekNumber, weekStart, dates, postCount, config) {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);

  // Gemini 2.0+ uses googleSearch tool; 1.5 uses googleSearchRetrieval
  const isGemini2 = config.geminiModel.startsWith('gemini-2');
  const tools = isGemini2
    ? [{ googleSearch: {} }]
    : [{
        googleSearchRetrieval: {
          dynamicRetrievalConfig: {
            mode: DynamicRetrievalMode.MODE_DYNAMIC,
            dynamicThreshold: 0.3,
          },
        },
      }];

  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: buildSystemPrompt(),
    tools,
  });

  const prompt = buildUserPrompt(weekNumber, weekStart, dates, postCount);

  console.log(`  [gemini] Model : ${config.geminiModel}`);
  console.log('  [gemini] Search grounding enabled — fetching recent news...');

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // Strip any accidental markdown fences the model might add
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let posts;
  try {
    posts = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Gemini returned non-JSON content. Raw response:\n${text}\n\nParse error: ${e.message}`
    );
  }

  if (!Array.isArray(posts)) {
    throw new Error(`Expected a JSON array, got: ${typeof posts}`);
  }

  // Validate required fields
  const REQUIRED = ['day_of_week', 'scheduled_date', 'prompt', 'caption', 'hashtags', 'platforms'];
  posts.forEach((p, i) => {
    for (const field of REQUIRED) {
      if (!p[field]) throw new Error(`Post [${i}] is missing required field: "${field}"`);
    }
  });

  // Log search grounding citations if available
  const candidates = result.response.candidates;
  const groundingMeta = candidates?.[0]?.groundingMetadata;
  if (groundingMeta?.webSearchQueries?.length) {
    console.log(`  [gemini] Search queries used:`);
    groundingMeta.webSearchQueries.forEach((q) => console.log(`           • ${q}`));
  }

  return posts;
}

// ─── Calendar printer ─────────────────────────────────────────────────────────

function printGeneratedPosts(posts, weekNumber, weekStart) {
  const [y] = weekStart.split('-');
  console.log(`\n  ── Generated posts for Week ${weekNumber} (${y}) ──────────────────\n`);

  posts.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.day_of_week}  ${p.scheduled_date}`);
    console.log(`      News hook : ${p.news_hook || '—'}`);
    console.log(`      Prompt    : ${p.prompt.slice(0, 90)}${p.prompt.length > 90 ? '…' : ''}`);
    console.log(`      Caption   : ${p.caption.slice(0, 100)}${p.caption.length > 100 ? '…' : ''}`);
    console.log(`      Hashtags  : ${p.hashtags}`);
    console.log(`      Platforms : ${p.platforms}\n`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const args = parseArgs(process.argv.slice(2));

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  PaySplit  —  Weekly Calendar Populator');
  console.log('══════════════════════════════════════════════════════');
  if (args.dryRun) console.log('\n  DRY RUN — sheet will NOT be updated.\n');

  const config = loadConfig();
  const year = currentYear();

  // ── Determine target week ─────────────────────────────────────────────────
  let targetWeek;
  if (args.week !== null) {
    targetWeek = args.week;
  } else if (args.thisWeek) {
    targetWeek = currentIsoWeek();
  } else {
    // Default: next week
    targetWeek = currentIsoWeek() + 1;
  }

  const mondayDate = mondayOfIsoWeek(targetWeek, year);
  const weekStartIso = localIso(mondayDate);
  const dates = weekDates(mondayDate);

  console.log(`\n[1/4] Target: Week ${targetWeek}  (${weekStartIso} → ${dates[6]})`);
  console.log(`      Generating ${args.posts} post(s)...`);

  // ── Check for existing rows (avoid duplicates) ────────────────────────────
  console.log('\n[2/4] Checking spreadsheet for existing entries...');
  let existingDates = new Set();
  try {
    existingDates = await existingScheduledDates(config);
    if (existingDates.size > 0) {
      const overlap = dates.filter((d) => existingDates.has(d));
      if (overlap.length > 0) {
        console.log(`      Warning: ${overlap.length} day(s) already have rows: ${overlap.join(', ')}`);
        console.log('      Those dates will be skipped after generation.');
      } else {
        console.log('      No conflicts found — all days are available.');
      }
    } else {
      console.log('      Sheet is empty or has no date conflicts.');
    }
  } catch (err) {
    console.log(`      Could not read sheet (${err.message}). Proceeding anyway.`);
  }

  // ── Generate content with Gemini ──────────────────────────────────────────
  console.log('\n[3/4] Calling Gemini with Google Search grounding...');
  const posts = await generatePostsWithGemini(
    targetWeek, weekStartIso, dates, args.posts, config
  );
  console.log(`      Generated ${posts.length} post(s).`);

  printGeneratedPosts(posts, targetWeek, weekStartIso);

  // ── Write to spreadsheet ──────────────────────────────────────────────────
  if (args.dryRun) {
    console.log('[4/4] DRY RUN — skipping spreadsheet write.\n');
  } else {
    console.log('[4/4] Writing to spreadsheet...');

    const token = await getServiceAccountToken(config.serviceAccountJson);
    const header = await getOrInitHeader(config, token);

    // Filter out already-existing dates
    const newPosts = posts.filter((p) => !existingDates.has(p.scheduled_date));
    if (newPosts.length < posts.length) {
      console.log(`      Skipped ${posts.length - newPosts.length} post(s) with duplicate dates.`);
    }

    if (newPosts.length === 0) {
      console.log('      Nothing new to write.');
    } else {
      // Build rows matching the header column order
      const rows = newPosts.map((p) => {
        const record = {
          week_number: String(targetWeek),
          week_start: weekStartIso,
          scheduled_date: p.scheduled_date,
          day_of_week: p.day_of_week,
          prompt: p.prompt,
          caption: p.caption,
          hashtags: p.hashtags,
          platforms: p.platforms,
          posted: '',
          posted_at: '',
          image_url: '',
          error: '',
          news_hook: p.news_hook || '',
        };
        return header.map((col) => record[col] ?? '');
      });

      await sheetsAppend(config, token, rows);
      console.log(`      Appended ${newPosts.length} row(s) to "${config.sheetName}".`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Done.  Week ${targetWeek} calendar ${args.dryRun ? 'previewed' : 'populated'}.`);
  console.log('══════════════════════════════════════════════════════\n');
}

run().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
