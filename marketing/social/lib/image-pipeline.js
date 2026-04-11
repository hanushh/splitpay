'use strict';

/**
 * marketing/social/lib/image-pipeline.js
 *
 * Shared image generation pipeline utilities used by both
 * social-poster-script.js and test-image-gen.js.
 *
 * Dependencies: sharp, qrcode (npm) + built-in Node.js modules only.
 */

const path     = require('path');
const sharp    = require('sharp');
const QRCode   = require('qrcode');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ─── Constants ────────────────────────────────────────────────────────────────

const IMAGEN_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
const SHEETS_BASE  = 'https://sheets.googleapis.com/v4/spreadsheets';

const LOGO_PATH       = path.join(__dirname, '../../../assets/images/icon.png');
const PLAY_BADGE_PATH = path.join(__dirname, '../assets/google-play-badge.png');
const BADGE_EDGE_PAD  = 36;
const PLAYSTORE_URL   = 'https://play.google.com/store/apps/details?id=com.hanushh.paysplit';
const CANVAS_W        = 1080;
const CANVAS_H        = 1350; // Instagram/Facebook recommended portrait (4:5)

const BRAND_PROMPT_PREFIX = `Shoot this as authentic lifestyle photography — real people, real environments, \
candid and natural. Do not add any text, labels, signs, hex codes, brand overlays, or UI frames to the image. \
Do not frame or enclose the scene inside a phone outline or device mockup. \
If a phone appears, it must be a small prop held naturally by someone in the scene — never a border around the image. \
Fill the entire frame edge-to-edge with the scene.\n\nImage prompt: `;

const MIN_PUBLISH_SCORE  = 3;  // Retry if score is below this
const MAX_IMAGE_ATTEMPTS = 3;  // Hard cap — publish best result after this many tries
const GEMINI_REWRITE_MODEL = 'gemini-2.5-flash';

// ─── Text helper ──────────────────────────────────────────────────────────────

/** Splits text into lines of at most maxChars characters, breaking at word boundaries. Max 3 lines. */
function wrapText(text, maxChars) {
  const words = String(text || '').trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// ─── Logo overlay ─────────────────────────────────────────────────────────────

/**
 * Composites the PaySplit logo pill (top-right) and CTA strip (bottom)
 * onto a raw image buffer. Optionally renders hero text at the top.
 *
 * @param {Buffer} imageBuffer  Raw PNG/JPEG from Imagen
 * @param {string} heroText     Optional bold headline printed at the top
 * @returns {Promise<Buffer>}   Composited PNG buffer
 */
async function overlayLogo(imageBuffer, heroText = '') {
  // ── logo pill constants (top-right, vertical: icon above text) ─────────
  const ICON_SIZE  = 80;
  const LOGO_PAD   = 16;
  const LOGO_GAP   = 8;
  const LOGO_FONT  = 28;
  const logoNameW  = Math.ceil(LOGO_FONT * 0.62 * 'PaySplit'.length);
  const LOGO_W     = Math.max(ICON_SIZE, logoNameW) + LOGO_PAD * 2;
  const LOGO_H     = LOGO_PAD + ICON_SIZE + LOGO_GAP + LOGO_FONT + LOGO_PAD;

  // ── bottom strip constants (full-width CTA bar) ─────────────────────────
  const STRIP_H       = 150;
  const STRIP_PAD     = 36;
  const STRIP_ICON_SZ = 120;
  const ICON_TEXT_GAP = 12;
  const NAME_FONT     = 28;
  const TAG_FONT      = 17;
  const TEXT_ROW_GAP  = 6;
  const QR_SIZE       = 90;
  const QR_PAD        = 7;
  const PLAY_BADGE_W  = 190;
  const PLAY_BADGE_H  = Math.round(PLAY_BADGE_W * 250 / 646);
  const COL_GAP       = 14;
  const qrContSz      = QR_SIZE + QR_PAD * 2;
  const rightBlockW   = qrContSz + COL_GAP + PLAY_BADGE_W;

  // ── generate assets ─────────────────────────────────────────────────────
  const iconBuf = await sharp(LOGO_PATH)
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const stripIconBuf = await sharp(LOGO_PATH)
    .resize(STRIP_ICON_SZ, STRIP_ICON_SZ, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const qrBuf = await QRCode.toBuffer(PLAYSTORE_URL, {
    width: QR_SIZE, margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });

  const playBadgeBuf = await sharp(PLAY_BADGE_PATH)
    .resize(PLAY_BADGE_W, PLAY_BADGE_H)
    .png()
    .toBuffer();

  // ── logo pill SVG (top-right, vertical layout) ──────────────────────────
  const iconX = Math.round((LOGO_W - ICON_SIZE) / 2);
  const textX = Math.round(LOGO_W / 2);
  const textY = LOGO_PAD + ICON_SIZE + LOGO_GAP + LOGO_FONT;
  const logoPillSvg = `<svg width="${LOGO_W}" height="${LOGO_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${LOGO_W}" height="${LOGO_H}" rx="12" fill="#112117" fill-opacity="0.9"/>
    <rect width="${LOGO_W}" height="${LOGO_H}" rx="12" fill="none" stroke="#17e86b" stroke-width="1.5"/>
    <image href="data:image/png;base64,${iconBuf.toString('base64')}"
           x="${iconX}" y="${LOGO_PAD}" width="${ICON_SIZE}" height="${ICON_SIZE}"/>
    <text x="${textX}" y="${textY}"
          text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${LOGO_FONT}" font-weight="bold" fill="#ffffff">PaySplit</text>
  </svg>`;

  const logoPillBuf = await sharp(Buffer.from(logoPillSvg)).png().toBuffer();

  // ── bottom CTA strip SVG (full-width) ────────────────────────────────────
  const stripIconX = STRIP_PAD;
  const stripIconY = Math.round((STRIP_H - STRIP_ICON_SZ) / 2);
  const textColX   = STRIP_PAD + STRIP_ICON_SZ + ICON_TEXT_GAP;
  const totalTextH = NAME_FONT + TEXT_ROW_GAP + TAG_FONT;
  const nameY      = Math.round((STRIP_H - totalTextH) / 2) + NAME_FONT;
  const tagY       = nameY + TEXT_ROW_GAP + TAG_FONT;
  const rightX     = CANVAS_W - STRIP_PAD - rightBlockW;
  const qrContY    = Math.round((STRIP_H - qrContSz) / 2);
  const qrImgX     = rightX + QR_PAD;
  const qrImgY     = qrContY + QR_PAD;
  const playX      = rightX + qrContSz + COL_GAP;
  const playY      = Math.round((STRIP_H - PLAY_BADGE_H) / 2);

  const stripSvg = `<svg width="${CANVAS_W}" height="${STRIP_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CANVAS_W}" height="${STRIP_H}" fill="#112117" fill-opacity="0.95"/>
    <line x1="0" y1="1" x2="${CANVAS_W}" y2="1" stroke="#17e86b" stroke-width="2"/>
    <image href="data:image/png;base64,${stripIconBuf.toString('base64')}"
           x="${stripIconX}" y="${stripIconY}" width="${STRIP_ICON_SZ}" height="${STRIP_ICON_SZ}"/>
    <text x="${textColX}" y="${nameY}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${NAME_FONT}" font-weight="bold" fill="#ffffff">PaySplit</text>
    <text x="${textColX}" y="${tagY}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${TAG_FONT}" fill="#17e86b">Split bills. Settle up instantly.</text>
    <rect x="${rightX}" y="${qrContY}" width="${qrContSz}" height="${qrContSz}" rx="5" fill="#ffffff"/>
    <image href="data:image/png;base64,${qrBuf.toString('base64')}"
           x="${qrImgX}" y="${qrImgY}" width="${QR_SIZE}" height="${QR_SIZE}"/>
    <image href="data:image/png;base64,${playBadgeBuf.toString('base64')}"
           x="${playX}" y="${playY}" width="${PLAY_BADGE_W}" height="${PLAY_BADGE_H}"/>
  </svg>`;

  const stripBuf = await sharp(Buffer.from(stripSvg)).png().toBuffer();

  // ── composite layers (painter's algorithm: last = on top) ────────────────
  // 1. bottom CTA strip, 2. hero text gradient, 3. logo pill (always on top)
  const composites = [
    { input: stripBuf, top: CANVAS_H - STRIP_H, left: 0 },
  ];

  if (heroText && heroText.trim()) {
    const HERO_FONT  = 72;
    const HERO_PAD_X = 54;
    const HERO_PAD_Y = 72;
    const LINE_H     = Math.round(HERO_FONT * 1.2);
    const MAX_CHARS  = 20;
    const lines      = wrapText(heroText.trim(), MAX_CHARS);
    const gradH      = HERO_PAD_Y + lines.length * LINE_H + 40;

    const textLines = lines.map((line, i) =>
      `<text x="${HERO_PAD_X}" y="${HERO_PAD_Y + i * LINE_H}"
             font-family="Arial, Helvetica, sans-serif"
             font-size="${HERO_FONT}" font-weight="bold" fill="#ffffff"
             filter="url(#shadow)">${line}</text>`
    ).join('\n    ');

    const heroSvg = `<svg width="1080" height="${gradH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#000000" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow" x="-5%" y="-5%" width="110%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.7"/>
        </filter>
      </defs>
      <rect width="1080" height="${gradH}" fill="url(#topFade)"/>
      ${textLines}
    </svg>`;

    composites.push({ input: await sharp(Buffer.from(heroSvg)).png().toBuffer(), top: 0, left: 0 });
  }

  composites.push({ input: logoPillBuf, top: BADGE_EDGE_PAD, left: CANVAS_W - LOGO_W - BADGE_EDGE_PAD });

  return sharp(imageBuffer)
    .resize(CANVAS_W, CANVAS_H, { fit: 'cover' })
    .composite(composites)
    .png()
    .toBuffer();
}

// ─── Prompt rewriter ──────────────────────────────────────────────────────────

/**
 * Calls Gemini CLI to rewrite a low-scoring image prompt.
 * Preserves phone-as-prop; rewrites phone-as-frame.
 *
 * @param {string} originalPrompt
 * @param {number} score
 * @param {string} issues
 * @returns {Promise<string>}
 */
async function rewritePrompt(originalPrompt, score, issues) {
  const instruction = `You are helping fix a poor AI-generated lifestyle image for PaySplit, a bill-splitting app.

The following image prompt scored ${score}/5 when sent to an AI image generator.
${issues ? `Issues found: ${issues}` : ''}

Rules for rewriting:
- A phone held naturally as a prop by a person in the scene is GOOD — keep it if present
- The phone must NEVER be a border or frame around the entire image — restructure the scene if this was the issue
- Do NOT include any text, labels, hex codes, brand names, or overlays in the scene description
- Fill the entire frame edge-to-edge with the scene — no blank bands or empty zones
- Keep the same social theme and lifestyle context as the original
- Be specific about lighting, mood, people, and environment
- Return ONLY the rewritten prompt text — no explanation, no preamble, no quotes

Original prompt:
${originalPrompt}`;

  const { stdout } = await execFileAsync(
    'gemini',
    ['-p', instruction, '-m', GEMINI_REWRITE_MODEL, '-y'],
    { timeout: 60000, maxBuffer: 2 * 1024 * 1024 }
  );

  const rewritten = stdout.trim();
  if (!rewritten) throw new Error('Gemini returned empty rewrite');
  return rewritten;
}

// ─── Config sheet reader ──────────────────────────────────────────────────────

/**
 * Reads key/value pairs from the "Config" sheet tab.
 * Returns an object with lowercase keys. Non-fatal — returns {} on any error.
 *
 * @param {string} spreadsheetId
 * @param {string} token  Bearer token for Sheets API
 * @returns {Promise<Record<string, string>>}
 */
async function fetchSheetConfig(spreadsheetId, token) {
  try {
    const range = encodeURIComponent('Config');
    const url   = `${SHEETS_BASE}/${spreadsheetId}/values/${range}`;
    const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json  = await res.json();
    const result = {};
    for (const [key, value] of (json.values || [])) {
      if (key) result[String(key).trim().toLowerCase()] = String(value ?? '').trim();
    }
    return result;
  } catch {
    return {};
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  IMAGEN_BASE,
  SHEETS_BASE,
  BRAND_PROMPT_PREFIX,
  MIN_PUBLISH_SCORE,
  MAX_IMAGE_ATTEMPTS,
  CANVAS_W,
  CANVAS_H,
  wrapText,
  overlayLogo,
  rewritePrompt,
  fetchSheetConfig,
};
