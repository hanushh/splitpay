#!/usr/bin/env node

/**
 * social-poster-script.js
 *
 * Reads a weekly content calendar from a Google Spreadsheet, generates
 * Instagram-sized poster images via the Nano Banana API, then publishes
 * them to Instagram and Facebook.
 *
 * ── Required environment variables ──────────────────────────────────────────
 *
 *   GOOGLE_SHEETS_API_KEY        Google Sheets API key (read-only is fine)
 *   GOOGLE_SPREADSHEET_ID        The spreadsheet ID from its URL
 *   GOOGLE_SHEET_NAME            Sheet tab name (default: Sheet1)
 *   GOOGLE_SERVICE_ACCOUNT_JSON  Path to service-account JSON for write-back
 *
 *   GEMINI_IMAGE_MODEL           Image generation model (default: gemini-2.0-flash-exp-image-generation)
 *                                Authentication is handled by the gemini CLI (no API key needed)
 *
 *   SUPABASE_URL                 Supabase project URL (for image hosting)
 *   SUPABASE_SERVICE_ROLE_KEY    Supabase service-role key (for storage uploads)
 *   SUPABASE_STORAGE_BUCKET      Storage bucket name (default: social-images)
 *
 *   FACEBOOK_ACCESS_TOKEN        Page access token (long-lived)
 *   FACEBOOK_PAGE_ID             Facebook Page ID
 *   INSTAGRAM_USER_ID            Instagram Business / Creator account ID
 *   FACEBOOK_GRAPH_API_VERSION   e.g. v19.0 (default)
 *
 * ── Spreadsheet layout (weekly calendar) ────────────────────────────────────
 *
 *   week_number     (required) Integer week number, e.g. 15
 *   week_start      (required) Monday date of that week, e.g. 2026-04-07
 *   scheduled_date  (required) ISO date the post should go live, e.g. 2026-04-08
 *   day_of_week     (required) Monday / Tuesday / … / Sunday
 *   prompt          (required) Image generation prompt sent to Nano Banana
 *   caption         (required) Post caption / copy
 *   hashtags        (optional) Space- or comma-separated hashtags
 *   platforms       (optional) instagram,facebook  (default: both)
 *   posted          (auto)     "yes" after successful posting
 *   posted_at       (auto)     ISO timestamp of posting
 *   image_url       (auto)     URL of the generated poster image
 *   error           (auto)     Last error message if posting failed
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   node --env-file .env.local marketing/social/social-poster-script.js [options]
 *
 *   --calendar              Print the weekly calendar for the current week and exit
 *   --calendar --week 15    Print the calendar for week 15 and exit
 *   --this-week             Process all unposted rows in the current week (default)
 *   --today                 Process only rows scheduled for today
 *   --week <n>              Process rows in week number <n>
 *   --day <name>            Process rows for a specific day, e.g. --day Monday
 *   --date <YYYY-MM-DD>     Process rows for a specific date
 *   --dry-run               Skip image generation and posting (calendar still prints)
 *   --include-posted        Re-process rows already marked as posted
 *   --help, -h              Show this help
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const {
  withRetry,
  utcIso,
  utcTodayIso,
  isoWeekNumberUtc,
  currentIsoWeekUtc,
  acquireLock,
  releaseLock,
  getServiceAccountToken,
} = require('./lib/utils');

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const GRAPH_BASE = `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_API_VERSION || 'v19.0'}`;
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// ─── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    calendarOnly: false,
    thisWeek: false,
    today: false,
    week: null,
    day: null,
    date: null,
    dryRun: false,
    includePosted: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--calendar') {
      args.calendarOnly = true;
    } else if (arg === '--this-week') {
      args.thisWeek = true;
    } else if (arg === '--today') {
      args.today = true;
    } else if (arg === '--week' && argv[i + 1]) {
      args.week = Number(argv[i + 1]); i += 1;
    } else if (arg === '--day' && argv[i + 1]) {
      args.day = capitalise(argv[i + 1]); i += 1;
    } else if (arg === '--date' && argv[i + 1]) {
      args.date = argv[i + 1]; i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--include-posted') {
      args.includePosted = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp(); process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.calendarOnly && !args.today && args.week === null && args.day === null && args.date === null) {
    args.thisWeek = true;
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node --env-file .env.local marketing/social/social-poster-script.js [options]

Filters (default: --this-week):
  --this-week             Process all unposted rows in the current ISO week
  --today                 Process only rows scheduled for today (UTC)
  --week <n>              Process all rows in week number <n>
  --day <name>            Process rows for a specific day (e.g. Monday)
  --date <YYYY-MM-DD>     Process rows for a specific date

Modifiers:
  --calendar              Print the weekly calendar view and exit (no posting)
  --dry-run               Show what would happen without posting or generating
  --include-posted        Re-process rows already marked as posted

Other:
  --help, -h              Show this help
`);
}

// ─── Environment ─────────────────────────────────────────────────────────────

function assertEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadConfig() {
  return {
    spreadsheetId: assertEnv('GOOGLE_SPREADSHEET_ID'),
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Sheet1',
    serviceAccountJson: assertEnv('GOOGLE_SERVICE_ACCOUNT_JSON'),

    geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-exp-image-generation',

    supabaseUrl: assertEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: assertEnv('SUPABASE_SERVICE_ROLE_KEY'),
    supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET || 'social-images',

    facebookAccessToken: assertEnv('FACEBOOK_ACCESS_TOKEN'),
    facebookPageId: assertEnv('FACEBOOK_PAGE_ID'),
    instagramUserId: assertEnv('INSTAGRAM_USER_ID'),
  };
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function apiFetch(rawUrl, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers };
  if (body !== null) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...headers };
  }
  const res = await fetch(rawUrl, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${rawUrl}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Date / week helpers ──────────────────────────────────────────────────────

/** Monday date (YYYY-MM-DD UTC) for the week containing a given UTC date string. */
function weekStartFor(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return utcIso(d);
}

/** All 7 YYYY-MM-DD UTC dates for the week starting on mondayIso. */
function weekDates(mondayIso) {
  const result = [];
  const base = new Date(mondayIso + 'T00:00:00Z');
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    result.push(utcIso(d));
  }
  return result;
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function formatDisplayDate(isoDate) {
  if (!isoDate) return '';
  const [, m, d] = isoDate.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m) - 1]} ${String(Number(d)).padStart(2, ' ')}`;
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

async function fetchSpreadsheetRows(config, token) {
  const range = encodeURIComponent(config.sheetName);
  const endpoint = `${SHEETS_BASE}/${config.spreadsheetId}/values/${range}`;
  const response = await withRetry(
    () => apiFetch(endpoint, { headers: { Authorization: `Bearer ${token}` } }),
    { attempts: 3, label: 'Sheets fetch' }
  );
  const rawGrid = response.values || [];

  if (rawGrid.length === 0) return { header: [], rows: [] };

  const [headerRow, ...dataRows] = rawGrid;
  const header = headerRow.map((h) => String(h).trim().toLowerCase());

  const rows = dataRows.map((dataRow) => {
    const record = {};
    header.forEach((key, idx) => { record[key] = dataRow[idx] ?? ''; });
    return record;
  });

  return { header, rows };
}

async function updateSpreadsheetRow(rowIndex, updates, header, config, token) {
  if (!token) {
    console.log('  [sheets] No service-account token — skipping write-back.');
    return;
  }

  const sheetRow = rowIndex + 2;
  const AUTO_COLS = ['posted', 'posted_at', 'image_url', 'error'];
  const fullHeader = [...header];
  for (const col of AUTO_COLS) {
    if (!fullHeader.includes(col)) fullHeader.push(col);
  }

  const values = [fullHeader.map((col) => updates[col] ?? '')];
  const writeRange = encodeURIComponent(`${config.sheetName}!A${sheetRow}`);
  const writeUrl =
    `${SHEETS_BASE}/${config.spreadsheetId}/values/${writeRange}` +
    `?valueInputOption=USER_ENTERED`;

  await withRetry(
    () => apiFetch(writeUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: { range: `${config.sheetName}!A${sheetRow}`, majorDimension: 'ROWS', values },
    }),
    { attempts: 3, label: 'Sheets write-back' }
  );
}

// ─── Gemini image generation (via gemini CLI) ─────────────────────────────────

async function generatePoster(prompt, config) {
  console.log(`  │  [gemini] Generating image: "${prompt.slice(0, 72)}${prompt.length > 72 ? '…' : ''}"`);
  console.log(`  │  [gemini] Model: ${config.geminiImageModel}`);

  const tmpPath = path.join(os.tmpdir(), `paysplit-poster-${Date.now()}.png`);

  const cliPrompt = [
    `Generate a 1080×1080 Instagram marketing poster image based on the prompt below.`,
    `Save the generated image as a PNG to this exact path: ${tmpPath}`,
    ``,
    `Image prompt: ${prompt}`,
  ].join('\n');

  await withRetry(
    async () => {
      await execFileAsync(
        'gemini',
        ['-p', cliPrompt, '-m', config.geminiImageModel, '-y'],
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
      );
      if (!fs.existsSync(tmpPath)) {
        throw new Error(`gemini CLI did not produce an image at ${tmpPath}`);
      }
    },
    { attempts: 3, baseDelay: 2000, label: 'Gemini CLI image generation' }
  );

  const imageBuffer = fs.readFileSync(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }

  const imageUrl = await uploadImageToSupabase(imageBuffer, config);
  console.log(`  │  [gemini] Image ready: ${imageUrl}`);
  return imageUrl;
}

async function uploadImageToSupabase(imageBuffer, config) {
  const objectPath = `social-posts/${Date.now()}.png`;
  const uploadUrl = `${config.supabaseUrl}/storage/v1/object/${config.supabaseBucket}/${objectPath}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upload failed (${res.status}): ${text}`);
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${config.supabaseBucket}/${objectPath}`;
}

// ─── Instagram ────────────────────────────────────────────────────────────────

/**
 * Polls the Instagram Graph API until the container status is FINISHED.
 * Replaces the old fixed sleep(4000).
 */
async function pollInstagramContainer(containerId, config, { intervalMs = 2000, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await apiFetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${config.facebookAccessToken}`
    );
    if (res.status_code === 'FINISHED') return;
    if (res.status_code === 'ERROR' || res.status_code === 'EXPIRED') {
      throw new Error(
        `Instagram container ${containerId} failed with status: ${res.status_code}${res.status ? ` (${res.status})` : ''}`
      );
    }
    console.log(`  │  [instagram] Container status: ${res.status_code || 'UNKNOWN'} — waiting ${intervalMs}ms...`);
    await sleep(intervalMs);
  }
  throw new Error(`Instagram container ${containerId} did not finish within ${timeoutMs / 1000}s`);
}

async function postToInstagram(imageUrl, caption, config) {
  console.log('  │  [instagram] Creating media container...');

  const container = await withRetry(
    () => apiFetch(
      `${GRAPH_BASE}/${config.instagramUserId}/media` +
      `?image_url=${encodeURIComponent(imageUrl)}` +
      `&caption=${encodeURIComponent(caption)}` +
      `&access_token=${config.facebookAccessToken}`,
      { method: 'POST' }
    ),
    { attempts: 3, baseDelay: 2000, label: 'Instagram create container' }
  );

  if (!container.id) {
    throw new Error(`Instagram container creation failed: ${JSON.stringify(container)}`);
  }

  console.log(`  │  [instagram] Container: ${container.id} — polling for FINISHED status...`);
  await pollInstagramContainer(container.id, config);

  const published = await withRetry(
    () => apiFetch(
      `${GRAPH_BASE}/${config.instagramUserId}/media_publish` +
      `?creation_id=${container.id}` +
      `&access_token=${config.facebookAccessToken}`,
      { method: 'POST' }
    ),
    { attempts: 3, baseDelay: 2000, label: 'Instagram publish' }
  );

  if (!published.id) {
    throw new Error(`Instagram publish failed: ${JSON.stringify(published)}`);
  }

  console.log(`  │  [instagram] Published! Post ID: ${published.id}`);
  return published.id;
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

async function postToFacebook(imageUrl, caption, config) {
  console.log('  │  [facebook] Posting to Page...');

  const result = await withRetry(
    () => apiFetch(
      `${GRAPH_BASE}/${config.facebookPageId}/photos` +
      `?url=${encodeURIComponent(imageUrl)}` +
      `&caption=${encodeURIComponent(caption)}` +
      `&access_token=${config.facebookAccessToken}`,
      { method: 'POST' }
    ),
    { attempts: 3, baseDelay: 2000, label: 'Facebook post' }
  );

  if (!result.id && !result.post_id) {
    throw new Error(`Facebook post failed: ${JSON.stringify(result)}`);
  }

  const postId = result.post_id || result.id;
  console.log(`  │  [facebook] Published! Post ID: ${postId}`);
  return postId;
}

// ─── Weekly calendar renderer ─────────────────────────────────────────────────

function printWeeklyCalendar(weekNumber, mondayIso, allRows, todayIsoDate) {
  const dates = weekDates(mondayIso);
  const [y] = mondayIso.split('-');
  const monDisplay = formatDisplayDate(dates[0]);
  const sunDisplay = formatDisplayDate(dates[6]);

  console.log(`\n  Week ${weekNumber}   (${monDisplay} – ${sunDisplay}, ${y})\n`);

  const COL = { day: 16, prompt: 36, platforms: 17, status: 11 };
  const border = (l, m, r) =>
    l + '─'.repeat(COL.day) + m + '─'.repeat(COL.prompt) +
    m + '─'.repeat(COL.platforms) + m + '─'.repeat(COL.status) + r;

  const cell = (str, width) => {
    const s = String(str ?? '');
    return s.length > width - 2 ? s.slice(0, width - 3) + '…' : s.padEnd(width - 1, ' ');
  };

  const row = (day, prompt, platforms, status) =>
    `│ ${cell(day, COL.day)}│ ${cell(prompt, COL.prompt)}│ ${cell(platforms, COL.platforms)}│ ${cell(status, COL.status)}│`;

  console.log(border('┌', '┬', '┐'));
  console.log(row('Day', 'Prompt', 'Platforms', 'Status'));
  console.log(border('├', '┼', '┤'));

  DAYS_OF_WEEK.forEach((dayName, i) => {
    const dateIso = dates[i];
    const isToday = dateIso === todayIsoDate;
    const shortDay = dayName.slice(0, 3);
    const displayDate = formatDisplayDate(dateIso);
    const todayMarker = isToday ? ' ●' : '  ';
    const dayLabel = `${shortDay}  ${displayDate}${todayMarker}`;

    const match = allRows.find((r) => (r.scheduled_date || '').trim() === dateIso);
    if (!match) {
      console.log(row(dayLabel, '—', '', ''));
    } else {
      const platforms = buildPlatformLabel(match.platforms);
      const status = isPosted(match) ? '✓ posted' : 'pending';
      console.log(row(dayLabel, match.prompt || '', platforms, status));
    }
  });

  console.log(border('└', '┴', '┘'));
  console.log('');
}

function buildPlatformLabel(raw) {
  const list = targetPlatforms({ platforms: raw });
  const labels = [];
  if (list.includes('instagram')) labels.push('IG');
  if (list.includes('facebook')) labels.push('FB');
  return labels.join(' + ');
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
  const full = parts.filter(Boolean).join('\n\n');
  // Guard against Instagram's 2200-char limit
  return full.length > 2200 ? full.slice(0, 2199) + '…' : full;
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
  console.log('  PaySplit Social Poster  —  Weekly Calendar');
  console.log('══════════════════════════════════════════════');
  if (args.dryRun) console.log('\n  DRY RUN — no images generated, no posts published.');

  // ── Acquire run lock ────────────────────────────────────────────────────
  if (!acquireLock('poster')) {
    console.error('\n[FATAL] Another poster run is already in progress. Exiting.');
    process.exit(1);
  }

  try {
    const config = loadConfig();
    const today = utcTodayIso();

    // ── Fetch service-account token (used for all Sheets reads + writes) ──
    const sheetToken = await withRetry(
      () => getServiceAccountToken(config.serviceAccountJson),
      { attempts: 3, label: 'service-account token exchange' }
    );

    // ── 1. Fetch spreadsheet ────────────────────────────────────────────
    console.log(`\n[1/3] Fetching spreadsheet ${config.spreadsheetId} (${config.sheetName})...`);
    const { header, rows } = await fetchSpreadsheetRows(config, sheetToken);

    if (rows.length === 0) {
      console.log('      No rows found. Nothing to do.');
      return;
    }

    for (const col of ['week_number', 'week_start', 'scheduled_date', 'day_of_week', 'prompt', 'caption']) {
      if (!header.includes(col)) {
        throw new Error(`Spreadsheet is missing required column: "${col}". Found: ${header.join(', ')}`);
      }
    }

    console.log(`      ${rows.length} row(s) loaded.`);

    // ── 2. Determine target week ──────────────────────────────────────────
    let targetWeekNum;
    if (args.week !== null) {
      targetWeekNum = args.week;
    } else if (args.date) {
      targetWeekNum = isoWeekNumberUtc(new Date(args.date));
    } else {
      targetWeekNum = currentIsoWeekUtc();
    }

    const weekRow = rows.find((r) => Number(r.week_number) === targetWeekNum);
    const mondayIso = weekRow
      ? weekRow.week_start.trim()
      : weekStartFor(today);

    // ── 3. Print weekly calendar ──────────────────────────────────────────
    console.log('\n[2/3] Weekly calendar:');
    const weekRows = rows.filter((r) => Number(r.week_number) === targetWeekNum);
    printWeeklyCalendar(targetWeekNum, mondayIso, weekRows, today);

    if (args.calendarOnly) {
      console.log('      (--calendar flag set — exiting without posting)');
      return;
    }

    // ── 4. Filter rows to process ─────────────────────────────────────────
    let pending = weekRows
      .map((row) => ({ row, idx: rows.indexOf(row) }))
      .filter(({ row }) => args.includePosted || !isPosted(row))
      .filter(({ row }) => row.prompt && row.caption);

    if (args.today) {
      pending = pending.filter(({ row }) => (row.scheduled_date || '').trim() === today);
    } else if (args.day) {
      pending = pending.filter(({ row }) => capitalise(row.day_of_week || '') === args.day);
    } else if (args.date) {
      pending = pending.filter(({ row }) => (row.scheduled_date || '').trim() === args.date);
    }

    console.log(`[3/3] Processing ${pending.length} post(s)...\n`);

    if (pending.length === 0) {
      const hint = args.today
        ? 'No posts scheduled for today.'
        : 'All posts in this week are already marked as posted. Use --include-posted to re-run them.';
      console.log(`      ${hint}`);
      return;
    }

    // ── 5. Generate + post ────────────────────────────────────────────────
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += 1) {
      const { row, idx } = pending[i];
      const platforms = targetPlatforms(row);
      const caption = buildCaption(row);
      const dayLabel = `${row.day_of_week} ${row.scheduled_date}`;

      console.log(`  ┌─ [${i + 1}/${pending.length}] ${dayLabel}`);
      console.log(`  │  Prompt    : ${row.prompt.slice(0, 70)}${row.prompt.length > 70 ? '…' : ''}`);
      console.log(`  │  Platforms : ${platforms.join(', ')}`);

      try {
        let imageUrl;
        if (args.dryRun) {
          imageUrl = 'https://placehold.co/1080x1080.png?text=dry+run';
          console.log('  │  [nano-banana] DRY RUN — skipped.');
        } else {
          imageUrl = await generatePoster(row.prompt, config);
        }

        if (!args.dryRun) {
          if (platforms.includes('instagram')) {
            await postToInstagram(imageUrl, caption, config);
          }
          if (platforms.includes('facebook')) {
            await postToFacebook(imageUrl, caption, config);
          }

          await updateSpreadsheetRow(
            idx,
            { ...row, posted: 'yes', posted_at: new Date().toISOString(), image_url: imageUrl, error: '' },
            header,
            config,
            sheetToken
          );
        } else {
          console.log(`  │  DRY RUN — would post to: ${platforms.join(', ')}`);
        }

        console.log('  └─ Done.\n');
        succeeded += 1;
      } catch (err) {
        console.error(`  └─ ERROR: ${err.message}\n`);
        failed += 1;

        if (!args.dryRun) {
          try {
            await updateSpreadsheetRow(idx, { ...row, error: err.message }, header, config, sheetToken);
          } catch { /* best-effort */ }
        }
      }
    }

    // ── 6. Summary ────────────────────────────────────────────────────────
    console.log('══════════════════════════════════════════════');
    console.log(`  Done.  ✓ ${succeeded} succeeded   ✗ ${failed} failed`);
    console.log('══════════════════════════════════════════════\n');

    if (failed > 0) process.exit(1);

  } finally {
    releaseLock('poster');
  }
}

run().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
