#!/usr/bin/env node
/**
 * Quick local test for Imagen 4 image generation + logo overlay.
 * Run: node --env-file .env.local test-image-gen.js
 * Output: ./test-output.png
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { getServiceAccountToken, evaluateGeneratedImage } = require('./lib/utils');
const {
  IMAGEN_BASE,
  BRAND_PROMPT_PREFIX,
  MIN_PUBLISH_SCORE,
  MAX_IMAGE_ATTEMPTS,
  overlayLogo,
  rewritePrompt,
  fetchSheetConfig,
} = require('./lib/image-pipeline');

const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'imagen-4.0-fast-generate-001';
const SHEETS_BASE        = 'https://sheets.googleapis.com/v4/spreadsheets';
const OUTPUT_PATH        = path.join(__dirname, 'test-output.png');

if (!GEMINI_API_KEY) {
  console.error('[FAIL] GEMINI_API_KEY is not set. Add it to .env.local and re-run.');
  process.exit(1);
}


// ─── Sheets fetch ─────────────────────────────────────────────────────────────

async function fetchSheetRow(targetDate, targetRow) {
  const spreadsheetId  = process.env.GOOGLE_SPREADSHEET_ID;
  const sheetName      = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!spreadsheetId || !serviceAccount) {
    throw new Error('GOOGLE_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON are required to read from the sheet.');
  }

  const token    = await getServiceAccountToken(serviceAccount);
  const range    = encodeURIComponent(sheetName);
  const url      = `${SHEETS_BASE}/${spreadsheetId}/values/${range}`;
  const res      = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json     = await res.json();
  if (!res.ok) throw new Error(`Sheets API error ${res.status}: ${JSON.stringify(json)}`);

  const [headerRow, ...dataRows] = json.values || [];
  if (!headerRow) throw new Error('Sheet is empty.');

  const header = headerRow.map((h) => String(h).trim().toLowerCase());
  const rows   = dataRows.map((r) => {
    const rec = {};
    header.forEach((key, i) => { rec[key] = r[i] ?? ''; });
    return rec;
  });

  let row;
  if (targetRow !== null) {
    row = rows[targetRow - 1]; // 1-based data row (excludes header)
    if (!row) throw new Error(`Row ${targetRow} not found (sheet has ${rows.length} data rows).`);
  } else if (targetDate) {
    row = rows.find((r) => r.scheduled_date === targetDate);
    if (!row) throw new Error(`No row found for date ${targetDate}.`);
  } else {
    row = rows.find((r) => r.prompt && r.prompt.trim());
    if (!row) throw new Error('No rows with a prompt found in the sheet.');
  }

  if (!row.prompt || !row.prompt.trim()) throw new Error('The selected row has no prompt.');
  return row;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Parse --date YYYY-MM-DD or --row N from argv
  const argv       = process.argv.slice(2);
  let targetDate   = null;
  let targetRow    = null;
  let noRetry      = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--date' && argv[i + 1]) { targetDate = argv[++i]; }
    else if (argv[i] === '--row' && argv[i + 1]) { targetRow = Number(argv[++i]); }
    else if (argv[i] === '--no-retry') { noRetry = true; }
  }

  console.log('\n[1/4] Reading prompt and config from spreadsheet...');
  const spreadsheetId  = process.env.GOOGLE_SPREADSHEET_ID;
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetToken     = serviceAccount ? await getServiceAccountToken(serviceAccount) : null;

  const [row, sheetConfig] = await Promise.all([
    fetchSheetRow(targetDate, targetRow),
    sheetToken && spreadsheetId ? fetchSheetConfig(spreadsheetId, sheetToken) : Promise.resolve({}),
  ]);

  const scoreEnabled = noRetry ? false
    : (sheetConfig.score_enabled ?? 'true').toLowerCase() !== 'false';
  const maxAttempts  = noRetry ? 1
    : Math.max(1, Number(sheetConfig.max_image_attempts) || MAX_IMAGE_ATTEMPTS);
  const minScore     = Number(sheetConfig.min_publish_score) || MIN_PUBLISH_SCORE;

  console.log(`      Score check : ${scoreEnabled ? `enabled (threshold ≥${minScore}, max ${maxAttempts} attempts)` : 'disabled'}`);

  const heroText     = row.hero_text  || '';

  console.log(`      Date      : ${row.scheduled_date || '—'}`);
  console.log(`      Hero text : ${heroText || '—'}`);
  console.log(`      Prompt    : ${row.prompt.slice(0, 80)}…`);
  console.log(`\n      Model     : ${GEMINI_IMAGE_MODEL}`);

  const endpoint = `${IMAGEN_BASE}/${GEMINI_IMAGE_MODEL}:predict?key=${GEMINI_API_KEY}`;

  console.log(`\n[2/4] Generating image${noRetry || !scoreEnabled ? '' : ' with retry loop'}...`);

  let currentPrompt = row.prompt;
  let best = { rawBuffer: null, aiScore: 0, aiIssues: '' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`\n      Attempt ${attempt}/${maxAttempts}: "${currentPrompt.slice(0, 72)}${currentPrompt.length > 72 ? '…' : ''}"`);

    const start = Date.now();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: BRAND_PROMPT_PREFIX + currentPrompt }],
        parameters: { sampleCount: 1, aspectRatio: '3:4' },
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      console.error(`\n[FAIL] API error ${res.status}:`, JSON.stringify(json, null, 2));
      process.exit(1);
    }
    console.log(`      Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

    const b64 = json?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
      console.error('\n[FAIL] No image bytes in response:', JSON.stringify(json).slice(0, 400));
      process.exit(1);
    }

    const rawBuffer = Buffer.from(b64, 'base64');
    console.log(`      Decoded   : ${(rawBuffer.length / 1024).toFixed(1)} KB`);

    let aiScore = 0;
    let aiIssues = '';
    if (scoreEnabled) {
      try {
        ({ score: aiScore, issues: aiIssues } = await evaluateGeneratedImage(rawBuffer));
        console.log(`      AI score  : ${aiScore}/5${aiIssues ? `  —  ${aiIssues}` : '  (no issues)'}`);
      } catch (err) {
        console.log(`      AI score  : skipped (${err.message})`);
      }
    } else {
      console.log('      AI score  : skipped (score_enabled=false)');
    }

    if (aiScore > best.aiScore || best.rawBuffer === null) {
      best = { rawBuffer, aiScore, aiIssues };
    }

    if (!scoreEnabled || aiScore >= minScore) {
      if (scoreEnabled) console.log(`      ✓ Score meets threshold (≥${minScore}) — stopping.`);
      break;
    }

    if (attempt < maxAttempts) {
      console.log(`      Score below threshold (<${minScore}) — rewriting prompt...`);
      try {
        currentPrompt = await rewritePrompt(currentPrompt, aiScore, aiIssues);
        console.log(`      Rewritten : "${currentPrompt.slice(0, 72)}${currentPrompt.length > 72 ? '…' : ''}"`);
      } catch (err) {
        console.log(`      Rewrite skipped (${err.message}) — retrying with same prompt.`);
      }
    } else {
      console.log(`      Max attempts reached — using best result (score: ${best.aiScore}/5).`);
    }
  }

  console.log('\n[3/4] Overlaying logo and CTA strip...');
  const composited = await overlayLogo(best.rawBuffer, heroText);

  fs.writeFileSync(OUTPUT_PATH, composited);
  const outSize = fs.statSync(OUTPUT_PATH).size;

  console.log(`\n✓ Saved: ${OUTPUT_PATH} (${(outSize / 1024).toFixed(1)} KB)`);
  console.log('  Open the file to inspect.\n');
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
