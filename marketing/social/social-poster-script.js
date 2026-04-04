#!/usr/bin/env node

/**
 * social-poster-script.js
 *
 * Reads poster prompts/captions from a Google Spreadsheet, generates an
 * Instagram-sized poster image via the Nano Banana API, then publishes it to
 * both Instagram and Facebook.
 *
 * ── Required environment variables ──────────────────────────────────────────
 *
 *   GOOGLE_SHEETS_API_KEY        Google Sheets API key (read-only is fine)
 *   GOOGLE_SPREADSHEET_ID        The spreadsheet ID from its URL
 *   GOOGLE_SHEET_NAME            Sheet tab name, e.g. "Posts" (default: Sheet1)
 *
 *   NANO_BANANA_API_KEY          Nano Banana API key
 *   NANO_BANANA_MODEL_KEY        Nano Banana model key / pipeline ID
 *   NANO_BANANA_API_URL          Nano Banana inference endpoint URL
 *                                e.g. https://api.nanobananapi.com/run
 *
 *   FACEBOOK_ACCESS_TOKEN        Page access token (long-lived)
 *   FACEBOOK_PAGE_ID             Facebook Page ID
 *   INSTAGRAM_USER_ID            Instagram Business / Creator account ID
 *
 * ── Spreadsheet columns ──────────────────────────────────────────────────────
 *
 *   prompt      (required) Image generation prompt sent to Nano Banana
 *   caption     (required) Post caption / copy
 *   hashtags    (optional) Space- or comma-separated hashtags
 *   platforms   (optional) Comma-separated: "instagram,facebook" (default: both)
 *   posted      (auto)     Set to "yes" after successful posting
 *   posted_at   (auto)     ISO timestamp of posting
 *   image_url   (auto)     URL of the generated image
 *   error       (auto)     Last error message if posting failed
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   # Run with env file:
 *   node --env-file .env.local marketing/social/social-poster-script.js
 *
 *   # Options:
 *   node ... social-poster-script.js --dry-run          # skip actual API calls
 *   node ... social-poster-script.js --row 3            # process only row 3
 *   node ... social-poster-script.js --limit 5          # process up to 5 rows
 *   node ... social-poster-script.js --include-posted   # re-process posted rows
 *   node ... social-poster-script.js --help
 */

'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ─── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    dryRun: false,
    row: null,
    limit: null,
    includePosted: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--include-posted') {
      args.includePosted = true;
    } else if ((arg === '--row' || arg === '-r') && argv[i + 1]) {
      args.row = Number(argv[i + 1]);
      i += 1;
    } else if ((arg === '--limit' || arg === '-l') && argv[i + 1]) {
      args.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node --env-file .env.local marketing/social/social-poster-script.js [options]

Options:
  --dry-run          Read spreadsheet and generate image but skip posting
  --row <n>          Process only the nth unposted row (1-based)
  --limit <n>        Process at most n unposted rows
  --include-posted   Also re-process rows already marked as posted
  --help, -h         Show this help

What this script does:
  1. Reads rows from a Google Spreadsheet
  2. Generates a poster image via the Nano Banana API using the row's prompt
  3. Posts the image + caption to Instagram and/or Facebook
  4. Writes back posted=yes, posted_at, and image_url to the spreadsheet

Required environment variables:
  GOOGLE_SHEETS_API_KEY, GOOGLE_SPREADSHEET_ID, GOOGLE_SHEET_NAME
  NANO_BANANA_API_KEY, NANO_BANANA_MODEL_KEY, NANO_BANANA_API_URL
  FACEBOOK_ACCESS_TOKEN, FACEBOOK_PAGE_ID, INSTAGRAM_USER_ID
`);
}

// ─── Environment ─────────────────────────────────────────────────────────────

function assertEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig() {
  return {
    sheetsApiKey: assertEnv('GOOGLE_SHEETS_API_KEY'),
    spreadsheetId: assertEnv('GOOGLE_SPREADSHEET_ID'),
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Sheet1',

    nanoBananaApiKey: assertEnv('NANO_BANANA_API_KEY'),
    nanoBananaModelKey: assertEnv('NANO_BANANA_MODEL_KEY'),
    nanoBananaApiUrl: assertEnv('NANO_BANANA_API_URL'),

    facebookAccessToken: assertEnv('FACEBOOK_ACCESS_TOKEN'),
    facebookPageId: assertEnv('FACEBOOK_PAGE_ID'),
    instagramUserId: assertEnv('INSTAGRAM_USER_ID'),
  };
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpRequest(rawUrl, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(rawUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${rawUrl}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Fetches all rows from the spreadsheet.
 * Returns { header: string[], rows: Record<string, string>[], rawRows: string[][] }
 */
async function fetchSpreadsheetRows(config) {
  const range = encodeURIComponent(`${config.sheetName}`);
  const endpoint =
    `${SHEETS_BASE}/${config.spreadsheetId}/values/${range}?key=${config.sheetsApiKey}`;

  const response = await httpRequest(endpoint);
  const rawGrid = response.values || [];

  if (rawGrid.length === 0) {
    return { header: [], rows: [], rawRows: [] };
  }

  const [headerRow, ...dataRows] = rawGrid;
  const header = headerRow.map((h) => String(h).trim().toLowerCase());

  const rows = dataRows.map((dataRow) => {
    const record = {};
    header.forEach((key, idx) => {
      record[key] = dataRow[idx] ?? '';
    });
    return record;
  });

  return { header, rows, rawRows: dataRows };
}

/**
 * Writes updated values back to the spreadsheet for a specific row.
 * rowIndex is 0-based data row index (excludes header).
 */
async function updateSpreadsheetRow(rowIndex, updates, config) {
  // Row 1 in Sheets is the header, data starts at row 2
  const sheetRow = rowIndex + 2;

  // Fetch current header to know column positions
  const range = encodeURIComponent(`${config.sheetName}!1:1`);
  const headerRes = await httpRequest(
    `${SHEETS_BASE}/${config.spreadsheetId}/values/${range}?key=${config.sheetsApiKey}`
  );
  const header = (headerRes.values?.[0] ?? []).map((h) => String(h).trim().toLowerCase());

  // Ensure columns exist; if not, append them
  const AUTO_COLUMNS = ['posted', 'posted_at', 'image_url', 'error'];
  for (const col of AUTO_COLUMNS) {
    if (!header.includes(col)) {
      header.push(col);
    }
  }

  // Build the update value range: write only the auto columns
  // We use batchUpdate via the Sheets API write endpoint (requires OAuth in
  // production — here we use the API key approach which is read-only, so in a
  // real deployment replace this with a service-account OAuth2 token).
  const values = [header.map((col) => updates[col] ?? '')];
  const writeRange = encodeURIComponent(`${config.sheetName}!A${sheetRow}`);
  const writeUrl =
    `${SHEETS_BASE}/${config.spreadsheetId}/values/${writeRange}?valueInputOption=USER_ENTERED&key=${config.sheetsApiKey}`;

  await httpRequest(
    writeUrl,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${config.facebookAccessToken}` },
    },
    { range: `${config.sheetName}!A${sheetRow}`, majorDimension: 'ROWS', values }
  );
}

// ─── Nano Banana image generation ────────────────────────────────────────────

/**
 * Calls the Nano Banana API to generate a poster image from a text prompt.
 *
 * Nano Banana's inference endpoint accepts:
 *   POST <NANO_BANANA_API_URL>
 *   {
 *     "apiKey":      "<NANO_BANANA_API_KEY>",
 *     "modelKey":    "<NANO_BANANA_MODEL_KEY>",
 *     "modelInputs": { "prompt": "...", "width": 1080, "height": 1080 }
 *   }
 *
 * It returns a JSON object with an `imageUrl` (or `output.imageUrl`) field
 * containing a publicly accessible URL to the generated image.
 *
 * Adjust the response parsing below to match the actual Nano Banana
 * response schema for your model.
 */
async function generatePoster(prompt, config) {
  console.log(`  [nano-banana] Generating image for prompt: "${prompt.slice(0, 80)}..."`);

  const payload = {
    apiKey: config.nanoBananaApiKey,
    modelKey: config.nanoBananaModelKey,
    modelInputs: {
      prompt,
      width: 1080,
      height: 1080,
      num_inference_steps: 30,
      guidance_scale: 7.5,
    },
  };

  const response = await httpRequest(
    config.nanoBananaApiUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    payload
  );

  // Adapt this to the actual Nano Banana response structure for your model
  const imageUrl =
    response.imageUrl ||
    response.image_url ||
    response.output?.imageUrl ||
    response.output?.image_url ||
    (Array.isArray(response.output) ? response.output[0] : null);

  if (!imageUrl) {
    throw new Error(
      `Nano Banana did not return an image URL. Response: ${JSON.stringify(response)}`
    );
  }

  console.log(`  [nano-banana] Image ready: ${imageUrl}`);
  return imageUrl;
}

// ─── Instagram ────────────────────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Posts an image to Instagram.
 *
 * Instagram Graph API two-step process:
 *   1. Create a media container (returns container ID)
 *   2. Publish the container
 *
 * The image must be at a publicly accessible URL.
 */
async function postToInstagram(imageUrl, caption, config) {
  console.log('  [instagram] Creating media container...');

  // Step 1: create container
  const containerUrl =
    `${GRAPH_BASE}/${config.instagramUserId}/media` +
    `?image_url=${encodeURIComponent(imageUrl)}` +
    `&caption=${encodeURIComponent(caption)}` +
    `&access_token=${config.facebookAccessToken}`;

  const container = await httpRequest(containerUrl, { method: 'POST' });

  if (!container.id) {
    throw new Error(`Instagram container creation failed: ${JSON.stringify(container)}`);
  }

  const containerId = container.id;
  console.log(`  [instagram] Container created: ${containerId}`);

  // Step 2: publish container (Instagram may need a few seconds to process)
  await sleep(3000);

  const publishUrl =
    `${GRAPH_BASE}/${config.instagramUserId}/media_publish` +
    `?creation_id=${containerId}` +
    `&access_token=${config.facebookAccessToken}`;

  const published = await httpRequest(publishUrl, { method: 'POST' });

  if (!published.id) {
    throw new Error(`Instagram publish failed: ${JSON.stringify(published)}`);
  }

  console.log(`  [instagram] Published! Post ID: ${published.id}`);
  return published.id;
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

/**
 * Posts an image to a Facebook Page.
 *
 * Uses the /photos endpoint which accepts a publicly accessible image URL.
 */
async function postToFacebook(imageUrl, caption, config) {
  console.log('  [facebook] Posting photo to Page...');

  const postUrl =
    `${GRAPH_BASE}/${config.facebookPageId}/photos` +
    `?url=${encodeURIComponent(imageUrl)}` +
    `&caption=${encodeURIComponent(caption)}` +
    `&access_token=${config.facebookAccessToken}`;

  const result = await httpRequest(postUrl, { method: 'POST' });

  if (!result.id && !result.post_id) {
    throw new Error(`Facebook post failed: ${JSON.stringify(result)}`);
  }

  const postId = result.post_id || result.id;
  console.log(`  [facebook] Published! Post ID: ${postId}`);
  return postId;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCaption(row) {
  const parts = [row.caption || ''];

  if (row.hashtags) {
    const tags = row.hashtags
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .join(' ');
    if (tags) parts.push(tags);
  }

  return parts.filter(Boolean).join('\n\n');
}

function targetPlatforms(row) {
  const raw = String(row.platforms || '').trim().toLowerCase();
  if (!raw) return ['instagram', 'facebook'];
  return raw.split(/[\s,]+/).filter(Boolean);
}

function isPosted(row) {
  return String(row.posted || '').trim().toLowerCase() === 'yes';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const args = parseArgs(process.argv.slice(2));

  console.log('\n══════════════════════════════════════════════');
  console.log('  PaySplit Social Poster');
  console.log('══════════════════════════════════════════════\n');

  if (args.dryRun) {
    console.log('DRY RUN — no images will be generated or posts published.\n');
  }

  const config = loadConfig();

  // ── 1. Fetch spreadsheet ──────────────────────────────────────────────────
  console.log(`[1/3] Fetching rows from spreadsheet ${config.spreadsheetId} (${config.sheetName})...`);
  const { header, rows } = await fetchSpreadsheetRows(config);

  if (rows.length === 0) {
    console.log('No rows found in the spreadsheet. Nothing to do.');
    return;
  }

  // Validate required columns
  const REQUIRED_COLS = ['prompt', 'caption'];
  for (const col of REQUIRED_COLS) {
    if (!header.includes(col)) {
      throw new Error(
        `Spreadsheet is missing required column: "${col}". ` +
        `Found columns: ${header.join(', ')}`
      );
    }
  }

  // Filter rows
  let pending = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => args.includePosted || !isPosted(row))
    .filter(({ row }) => row.prompt && row.caption);

  if (args.row !== null) {
    if (!Number.isInteger(args.row) || args.row < 1 || args.row > pending.length) {
      throw new Error(`--row must be between 1 and ${pending.length}`);
    }
    pending = [pending[args.row - 1]];
  } else if (args.limit !== null) {
    pending = pending.slice(0, args.limit);
  }

  console.log(`   Found ${rows.length} total row(s), ${pending.length} to process.\n`);

  if (pending.length === 0) {
    console.log('All rows already posted. Use --include-posted to re-process them.');
    return;
  }

  // ── 2. Process each row ───────────────────────────────────────────────────
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += 1) {
    const { row, idx } = pending[i];
    const platforms = targetPlatforms(row);
    const caption = buildCaption(row);

    console.log(`[${i + 1}/${pending.length}] Row ${idx + 2}: "${row.prompt.slice(0, 60)}..."`);
    console.log(`   Platforms : ${platforms.join(', ')}`);
    console.log(`   Caption   : ${caption.slice(0, 80)}${caption.length > 80 ? '...' : ''}`);

    try {
      // ── 2a. Generate poster with Nano Banana ──────────────────────────────
      let imageUrl;
      if (args.dryRun) {
        imageUrl = 'https://placehold.co/1080x1080.png?text=dry+run';
        console.log(`  [nano-banana] DRY RUN — skipping image generation.`);
      } else {
        imageUrl = await generatePoster(row.prompt, config);
      }

      // ── 2b. Post to platforms ─────────────────────────────────────────────
      if (!args.dryRun) {
        if (platforms.includes('instagram')) {
          await postToInstagram(imageUrl, caption, config);
        }

        if (platforms.includes('facebook')) {
          await postToFacebook(imageUrl, caption, config);
        }

        // ── 2c. Update spreadsheet ─────────────────────────────────────────
        const updatedRow = {
          ...row,
          posted: 'yes',
          posted_at: new Date().toISOString(),
          image_url: imageUrl,
          error: '',
        };

        await updateSpreadsheetRow(idx, updatedRow, config);
        console.log(`  [sheets] Row ${idx + 2} marked as posted.\n`);
      } else {
        console.log(`  DRY RUN — would post to: ${platforms.join(', ')}\n`);
      }

      succeeded += 1;
    } catch (err) {
      console.error(`  ERROR on row ${idx + 2}: ${err.message}\n`);
      failed += 1;

      // Try to record error back to spreadsheet (best-effort)
      if (!args.dryRun) {
        try {
          await updateSpreadsheetRow(
            idx,
            { ...row, error: err.message },
            config
          );
        } catch {
          // Ignore write-back failures
        }
      }
    }
  }

  // ── 3. Summary ────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════');
  console.log(`  Done.  Succeeded: ${succeeded}  Failed: ${failed}`);
  console.log('══════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
