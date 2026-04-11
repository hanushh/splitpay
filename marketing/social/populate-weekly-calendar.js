#!/usr/bin/env node

/**
 * populate-weekly-calendar.js
 *
 * Runs weekly (via cron) to fill the next week's rows in the Google Spreadsheet
 * content calendar.  Uses Gemini with Google Search grounding to pull in recent
 * happenings and generate on-brand post ideas for PaySplit.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *   1. Computes the target week's dates (default: next ISO week).
 *   2. Calls Gemini with Google Search grounding enabled so the model can look
 *      up recent news (fintech, personal finance, travel, group spending, etc.).
 *   3. Validates and normalises each generated post (caption length, hashtags…).
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
 *   GEMINI_MODEL                 e.g. gemini-2.5-flash  (default)
 *                                Authentication is handled by the gemini CLI (no API key needed)
 *
 *   GOOGLE_SPREADSHEET_ID        Spreadsheet ID from its URL
 *   GOOGLE_SHEET_NAME            Tab name (default: Sheet1)
 *   GOOGLE_SERVICE_ACCOUNT_JSON  Path to service-account JSON (reads + writes)
 *
 *   SOCIAL_CONTENT_TOPICS        Optional comma-separated topic overrides
 *                                e.g. "summer festivals, crypto, remote work"
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   node --env-file .env.local marketing/social/populate-weekly-calendar.js
 *
 *   --next-week          Populate next ISO week (default)
 *   --this-week          Populate the current ISO week instead
 *   --week <n>           Populate a specific ISO week number
 *   --posts <n>          Number of posts to generate (default: 4, max: 7)
 *   --topics <t,…>       Override SOCIAL_CONTENT_TOPICS for this run only
 *   --dry-run            Generate + print content without writing to the sheet
 *   --help, -h           Show this help
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const {
  withRetry,
  utcIso,
  currentIsoWeekUtc,
  validatePost,
  acquireLock,
  releaseLock,
  getServiceAccountToken,
} = require('./lib/utils');
const { DAYS_OF_WEEK, buildSystemPrompt, buildUserPrompt } = require('./lib/prompts');

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gemini-2.0-flash';

const DEFAULT_TOPICS = [
  'personal finance & budgeting',
  'group travel or holidays',
  'dining out, food & nightlife',
  'fintech & payment apps',
  'friendship, flatmates, or shared living',
  'seasonal events happening this week (sports, festivals, holidays)',
];

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { nextWeek: true, thisWeek: false, week: null, posts: 4, dryRun: false, topics: null };

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
    } else if (arg === '--topics' && argv[i + 1]) {
      args.topics = argv[i + 1]; i += 1;
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
  --next-week            Populate next ISO week (default)
  --this-week            Populate the current ISO week
  --week <n>             Populate a specific ISO week number
  --posts <n>            Number of posts to generate: 1–7 (default: 4)
  --topics <t1,t2,…>    Override search topics for this run
  --dry-run              Print generated posts without writing to the spreadsheet
  --help, -h             Show this help

Env override:
  SOCIAL_CONTENT_TOPICS  Comma-separated topics (same as --topics but persistent)

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
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_MODEL,

    spreadsheetId: assertEnv('GOOGLE_SPREADSHEET_ID'),
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Sheet1',
    serviceAccountJson: assertEnv('GOOGLE_SERVICE_ACCOUNT_JSON'),
  };
}

// ─── Date / week helpers ──────────────────────────────────────────────────────

/** Returns the Monday (UTC Date object) of a given ISO week and year. */
function mondayOfIsoWeek(week, year) {
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
    return utcIso(d);
  });
}

function currentYearUtc() { return new Date().getUTCFullYear(); }

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function apiFetch(url, { method = 'GET', headers = {}, body = null } = {}) {
  const init = { method, headers };
  if (body !== null) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...headers };
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Google Sheets helpers ────────────────────────────────────────────────────

async function getOrInitHeader(config, token) {
  const range = encodeURIComponent(`${config.sheetName}!1:1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${range}`;

  const res = await withRetry(
    () => apiFetch(url, { headers: { Authorization: `Bearer ${token}` } }),
    { attempts: 3, label: 'Sheets header read' }
  );

  const existing = res.values?.[0]?.map((h) => String(h).trim().toLowerCase()) ?? [];
  if (existing.length > 0) return existing;

  const defaultHeader = [
    'week_number', 'week_start', 'scheduled_date', 'day_of_week',
    'hero_text', 'prompt', 'caption', 'hashtags', 'platforms',
    'posted', 'posted_at', 'image_url', 'error', 'news_hook',
  ];
  await sheetsWrite(config, token, `${config.sheetName}!A1`, [defaultHeader]);
  return defaultHeader;
}

async function sheetsWrite(config, token, range, values) {
  const encodedRange = encodeURIComponent(range);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodedRange}` +
    `?valueInputOption=USER_ENTERED`;

  await withRetry(
    () => apiFetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: { range, majorDimension: 'ROWS', values },
    }),
    { attempts: 3, label: 'Sheets write' }
  );
}

async function sheetsAppend(config, token, values) {
  const range = encodeURIComponent(`${config.sheetName}`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  await withRetry(
    () => apiFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { majorDimension: 'ROWS', values },
    }),
    { attempts: 3, label: 'Sheets append' }
  );
}

async function existingScheduledDates(config, token) {
  const range = encodeURIComponent(`${config.sheetName}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${range}`;

  const res = await withRetry(
    () => apiFetch(url, { headers: { Authorization: `Bearer ${token}` } }),
    { attempts: 3, label: 'Sheets duplicate check' }
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

async function recentScoredExamples(config, token, limit = 8) {
  const range = encodeURIComponent(config.sheetName);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${range}`;
  let res;
  try {
    res = await apiFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return []; // non-fatal
  }

  const rawGrid = res.values || [];
  if (rawGrid.length < 2) return [];

  const header   = rawGrid[0].map((h) => String(h).trim().toLowerCase());
  const scoreCol = header.indexOf('ai_image_score');
  const issueCol = header.indexOf('ai_image_issues');
  const promptCol = header.indexOf('prompt');
  if (scoreCol === -1 || promptCol === -1) return [];

  const scored = [];
  for (let i = rawGrid.length - 1; i >= 1 && scored.length < limit; i--) {
    const row   = rawGrid[i];
    const score = Number(row[scoreCol]);
    if (!score) continue;
    scored.push({
      score,
      issues: issueCol !== -1 ? String(row[issueCol] || '') : '',
      prompt: String(row[promptCol] || ''),
    });
  }
  return scored;
}

// ─── Gemini content generation ────────────────────────────────────────────────

async function generatePostsWithGemini(weekNumber, weekStart, dates, postCount, topics, config, recentExamples = []) {
  // Combine system + user instructions into a single prompt for the CLI.
  // The gemini CLI uses Google Search automatically when the prompt requires
  // current information, so no explicit grounding config is needed.
  const fullPrompt = `${buildSystemPrompt(recentExamples)}\n\n${buildUserPrompt(weekNumber, weekStart, dates, postCount, topics)}`;

  console.log(`  [gemini] Model : ${config.geminiModel}`);
  console.log('  [gemini] Running via gemini CLI (Google Search grounding built-in)...');

  const { stdout } = await withRetry(
    () => execFileAsync(
      'gemini',
      ['-p', fullPrompt, '-m', config.geminiModel, '-y'],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
    ),
    { attempts: 3, baseDelay: 2000, label: 'Gemini CLI content generation' }
  );

  // Gemini CLI sometimes prepends search/thinking prose before the JSON.
  // Extract the first JSON array found in the output.
  const arrayMatch = stdout.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error(
      `Gemini returned no JSON array. Raw output:\n${stdout.slice(0, 500)}`
    );
  }

  let posts;
  try {
    posts = JSON.parse(arrayMatch[0]);
  } catch (e) {
    throw new Error(
      `Gemini returned non-JSON. Raw output:\n${stdout.slice(0, 500)}\n\nParse error: ${e.message}`
    );
  }

  if (!Array.isArray(posts)) {
    throw new Error(`Expected a JSON array from Gemini, got: ${typeof posts}`);
  }

  const REQUIRED = ['day_of_week', 'scheduled_date', 'hero_text', 'prompt', 'caption', 'hashtags', 'platforms'];
  posts.forEach((p, i) => {
    for (const field of REQUIRED) {
      if (!p[field]) throw new Error(`Post [${i}] (${p.day_of_week || '?'}) is missing field: "${field}"`);
    }
  });

  return posts;
}

// ─── Output printer ───────────────────────────────────────────────────────────

function printGeneratedPosts(posts, weekNumber, weekStart) {
  const [y] = weekStart.split('-');
  console.log(`\n  ── Generated posts for Week ${weekNumber} (${y}) ──────────────────\n`);

  posts.forEach((p, i) => {
    const captionPreview = p.caption.slice(0, 100) + (p.caption.length > 100 ? '…' : '');
    const promptPreview = p.prompt.slice(0, 90) + (p.prompt.length > 90 ? '…' : '');
    console.log(`  [${i + 1}] ${p.day_of_week}  ${p.scheduled_date}`);
    console.log(`      News hook : ${p.news_hook || '—'}`);
    console.log(`      Hero text : ${p.hero_text || '—'}`);
    console.log(`      Prompt    : ${promptPreview}`);
    console.log(`      Caption   : ${captionPreview}`);
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

  // ── Acquire run lock ──────────────────────────────────────────────────────
  if (!acquireLock('populate')) {
    console.error('\n[FATAL] Another populate run is already in progress. Exiting.');
    process.exit(1);
  }

  try {
    const config = loadConfig();
    const year = currentYearUtc();

    // Topics: CLI flag → env var → defaults
    const topicsRaw = args.topics || process.env.SOCIAL_CONTENT_TOPICS || '';
    const topics = topicsRaw
      ? topicsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : DEFAULT_TOPICS;

    if (topics !== DEFAULT_TOPICS) {
      console.log(`\n  Topics override: ${topics.join(', ')}`);
    }

    // ── Determine target week ───────────────────────────────────────────────
    let targetWeek;
    if (args.week !== null) {
      targetWeek = args.week;
    } else if (args.thisWeek) {
      targetWeek = currentIsoWeekUtc();
    } else {
      targetWeek = currentIsoWeekUtc() + 1;
    }

    const mondayDate = mondayOfIsoWeek(targetWeek, year);
    const weekStartIso = utcIso(mondayDate);
    const dates = weekDates(mondayDate);

    console.log(`\n[1/4] Target: Week ${targetWeek}  (${weekStartIso} → ${dates[6]})`);
    console.log(`      Generating ${args.posts} post(s)...`);

    // ── Acquire service-account token (used for all Sheets reads + writes) ──
    const token = await withRetry(
      () => getServiceAccountToken(config.serviceAccountJson),
      { attempts: 3, label: 'service-account token exchange' }
    );

    // ── Check for existing rows ─────────────────────────────────────────────
    console.log('\n[2/4] Checking spreadsheet for existing entries...');
    let existingDates = new Set();
    try {
      existingDates = await existingScheduledDates(config, token);
      const overlap = dates.filter((d) => existingDates.has(d));
      if (overlap.length > 0) {
        console.log(`      Warning: ${overlap.length} day(s) already have rows: ${overlap.join(', ')}`);
        console.log('      Those dates will be skipped after generation.');
      } else {
        console.log('      No conflicts found — all days are available.');
      }
    } catch (err) {
      console.log(`      Could not read sheet (${err.message}). Proceeding anyway.`);
    }

    // ── Generate content with Gemini ────────────────────────────────────────
    console.log('\n[3/4] Calling Gemini with Google Search grounding...');
    const examples = await recentScoredExamples(config, token);
    if (examples.length > 0) {
      const good = examples.filter((e) => e.score >= 4).length;
      const bad  = examples.filter((e) => e.score <= 2).length;
      console.log(`      Injecting ${examples.length} past example(s) into prompt (${good} good, ${bad} poor).`);
    }
    const rawPosts = await generatePostsWithGemini(
      targetWeek, weekStartIso, dates, args.posts, topics, config, examples
    );
    console.log(`      Generated ${rawPosts.length} post(s). Validating...`);

    // Validate + normalise each post
    const posts = [];
    for (const raw of rawPosts) {
      const { valid, warnings, post } = validatePost(raw, dates);
      if (warnings.length > 0) {
        console.log(`  [validate] ${raw.day_of_week}: ${warnings.join('; ')}`);
      }
      if (!valid) {
        console.log(`  [validate] Dropping post for ${raw.day_of_week} — invalid after normalisation.`);
      } else {
        posts.push(post);
      }
    }

    console.log(`      ${posts.length} post(s) passed validation.`);
    printGeneratedPosts(posts, targetWeek, weekStartIso);

    // ── Write to spreadsheet ────────────────────────────────────────────────
    if (args.dryRun) {
      console.log('[4/4] DRY RUN — skipping spreadsheet write.\n');
    } else {
      console.log('[4/4] Writing to spreadsheet...');

      const header = await getOrInitHeader(config, token);

      const newPosts = posts.filter((p) => !existingDates.has(p.scheduled_date));
      if (newPosts.length < posts.length) {
        console.log(`      Skipped ${posts.length - newPosts.length} post(s) with duplicate dates.`);
      }

      if (newPosts.length === 0) {
        console.log('      Nothing new to write.');
      } else {
        const rows = newPosts.map((p) => {
          const record = {
            week_number: String(targetWeek),
            week_start: weekStartIso,
            scheduled_date: p.scheduled_date,
            day_of_week: p.day_of_week,
            hero_text: p.hero_text || '',
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

  } finally {
    releaseLock('populate');
  }
}

run().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
