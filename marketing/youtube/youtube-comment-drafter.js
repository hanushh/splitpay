#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ENV_PATH = path.join(process.cwd(), '.env.development');
loadEnvFile(ENV_PATH);

function loadEnvFile(filepath) {
  if (!fs.existsSync(filepath)) {
    return;
  }

  const envText = fs.readFileSync(filepath, 'utf8');

  envText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      return;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

const DEFAULT_CSV = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-marketing-posts.csv');
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.hanushh.paysplit';
const SKIP_STATUSES = new Set([
  'commented',
  'rejected',
  'too_old',
  'comments_off',
  'forced_fit',
  'competitor_promo',
  'false_positive',
]);

function parseArgs(argv) {
  const args = {
    csv: DEFAULT_CSV,
    overwrite: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--csv' && argv[i + 1]) {
      args.csv = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--overwrite') {
      args.overwrite = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
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
  console.log(`Usage:
  node marketing/youtube/youtube-comment-drafter.js
  node marketing/youtube/youtube-comment-drafter.js --overwrite
  node marketing/youtube/youtube-comment-drafter.js --dry-run

What it does:
  - Reads marketing/youtube/youtube-marketing-posts.csv
  - Generates transcript-aware suggested_comment drafts
  - Fills only blank comment cells by default

What it does not do:
  - It does not search YouTube
  - It does not submit comments for you
  - It does not overwrite existing drafts unless you pass --overwrite
`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';

      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return { header: [], rows: [] };
  }

  const [header, ...dataRows] = rows;
  const records = dataRows.map((dataRow) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = dataRow[index] ?? '';
    });
    return record;
  });

  return { header, rows: records };
}

function escapeCsvField(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function saveCsv(filepath, header, rows) {
  const lines = [
    header.map((column) => escapeCsvField(column)).join(','),
    ...rows.map((row) => header.map((column) => escapeCsvField(row[column] ?? '')).join(',')),
  ];
  fs.writeFileSync(filepath, `${lines.join('\n')}\n`, 'utf8');
}

function normalizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBucketFromQuery(query) {
  const normalized = normalizeQuery(query);

  if (
    normalized.includes('splitwise') ||
    normalized.includes('split bills') ||
    normalized.includes('expense sharing') ||
    normalized.includes('bill splitting')
  ) {
    return 'direct_intent';
  }

  if (
    normalized.includes('roommate') ||
    normalized.includes('rent') ||
    normalized.includes('utilities') ||
    normalized.includes('shared house') ||
    normalized.includes('flatmate')
  ) {
    return 'roommate';
  }

  if (
    normalized.includes('trip') ||
    normalized.includes('travel') ||
    normalized.includes('vacation') ||
    normalized.includes('nomad')
  ) {
    return 'travel';
  }

  if (
    normalized.includes('hostel') ||
    normalized.includes('student') ||
    normalized.includes('college')
  ) {
    return 'student';
  }

  if (
    normalized.includes('awkward') ||
    normalized.includes('etiquette') ||
    normalized.includes('money fights') ||
    normalized.includes('talk about bills') ||
    normalized.includes('asking roommates for money') ||
    normalized.includes('not paying their share')
  ) {
    return 'behavior';
  }

  return 'general';
}

function extractMatchedQuery(whyItFits) {
  const match = String(whyItFits || '').match(/Matched query: \[(.*?)\]\./);
  return match ? match[1] : '';
}

function sanitizeCommentText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/"/g, '')
    .trim();
}

function extractTranscriptExcerpt(whyItFits) {
  const match = String(whyItFits || '').match(/Transcript excerpt: "(.*)"$/);
  return match ? match[1] : '';
}

function extractCommentFocus(transcriptExcerpt, title) {
  const source = sanitizeCommentText(transcriptExcerpt || title);
  if (!source) {
    return 'shared expenses getting awkward';
  }
  const firstSentence = source.split(/(?<=[.!?])\s+/)[0] || source;
  return firstSentence.split(/\s+/).slice(0, 14).join(' ').trim();
}

function buildSuggestedComment(row) {
  const bucket = getBucketFromQuery(extractMatchedQuery(row.why_it_fits));
  const transcriptExcerpt = extractTranscriptExcerpt(row.why_it_fits);
  const focus = extractCommentFocus(transcriptExcerpt, row.video_title);

  let opener = `The part about ${focus} is exactly where shared expenses start getting awkward.`;
  let closer = `It helps groups track balances without one person having to keep score out loud: ${PLAY_STORE_URL}`;

  if (bucket === 'direct_intent') {
    opener = `Useful breakdown, especially around ${focus}.`;
    closer = `It's an Android app for shared expenses with balances and settle-ups, and I'd genuinely value honest feedback if you're comparing options: ${PLAY_STORE_URL}`;
  } else if (bucket === 'roommate') {
    opener = `The part about ${focus} is exactly the kind of roommate friction that gets messy fast.`;
    closer = `It is built for shared rent, utilities, and other house costs so everyone can see the running balance in one place: ${PLAY_STORE_URL}`;
  } else if (bucket === 'travel') {
    opener = `The part about ${focus} is exactly where trip costs get awkward for groups.`;
    closer = `It is useful for group travel and shared costs so people can log expenses and see balances without chasing each other later: ${PLAY_STORE_URL}`;
  } else if (bucket === 'student') {
    opener = `The part about ${focus} is exactly where student or hostel costs stop feeling simple.`;
    closer = `It is useful for shared student expenses, rent, and other group costs so the ledger stays visible to everyone: ${PLAY_STORE_URL}`;
  } else if (bucket === 'behavior') {
    opener = `The part about ${focus} is exactly what makes money stuff feel awkward in groups.`;
    closer = `It helps make shared balances visible without turning one friend or roommate into the collector: ${PLAY_STORE_URL}`;
  }

  return `${opener} Full disclosure: I'm building PaySplit. ${closer}`;
}

function extractVideoId(url) {
  const match = String(url || '').match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

function detectLangFromNotes(notes) {
  const match = String(notes || '').match(/Detected language:\s*([a-z]{2})/i);
  return match ? match[1].toLowerCase() : 'en';
}

async function fetchFullTranscript(videoId, lang) {
  const langs = lang !== 'en' ? [lang, 'en'] : ['en'];

  for (const l of langs) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${l}&fmt=json3`;
      const res = await fetch(url);
      if (!res.ok) {
        continue;
      }
      const data = await res.json();
      const events = data.events || [];
      const text = events
        .flatMap((e) => (e.segs || []).map((s) => s.utf8 || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        return text;
      }
    } catch {
      // try next language or return null
    }
  }

  return null;
}

function buildPrompt(row, transcript, lang) {
  const bucket = getBucketFromQuery(extractMatchedQuery(row.why_it_fits));
  const langNote = lang !== 'en'
    ? `The video is in language code "${lang}". Write the comment in that same language.`
    : 'Write in English.';

  const bucketGuidance = bucket === 'direct_intent'
    ? 'The audience is already comparing tools. Acknowledge the comparison, mention only the one or two PaySplit strengths most relevant to the video, and invite honest feedback — these viewers are skeptical.'
    : bucket === 'behavior'
      ? 'The viewer is mid-problem and not yet looking for an app. Validate the frustration first, then offer PaySplit as a way to remove the awkwardness — lead with emotional relief, not feature lists.'
      : 'Connect PaySplit naturally to the specific shared-expense situation described in the video.';

  return `You are writing a YouTube comment on behalf of Hanushh, the developer of PaySplit — a free Android app for splitting bills among friends and groups.

VIDEO TITLE: ${row.video_title}
CHANNEL: ${row.channel_name || ''}
TOPIC BUCKET: ${bucket}
PLAY STORE LINK: ${PLAY_STORE_URL}

TRANSCRIPT:
${transcript}

TASK:
Write a single YouTube comment. Follow this structure exactly:
1. React to one specific moment from the transcript — quote or paraphrase something the speaker actually said. Do NOT reference the title. Do NOT be generic.
2. Disclose naturally that you built PaySplit. Vary the phrasing (examples: "Full disclosure: I built PaySplit for exactly this", "Developer of PaySplit here", "I actually built an app called PaySplit after running into this problem").
3. Connect PaySplit to their specific situation in one sentence and include the Play Store link.

RULES:
- Three sentences maximum. No more.
- No emoji.
- Never pose as a regular user — always disclose.
- No hard sell. Invite honest feedback if relevant.
- ${bucketGuidance}
- ${langNote}

Output only the comment text. No quotes around it. Nothing else.`;
}

function generateCommentWithClaude(prompt, model) {
  const cliArgs = ['-p', prompt];
  if (model) {
    cliArgs.push('--model', model);
  }
  const result = spawnSync('claude', cliArgs, {
    encoding: 'utf8',
    timeout: 60000,
  });

  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    return null;
  }

  return sanitizeCommentText(result.stdout.trim());
}

async function buildSuggestedCommentAI(row) {
  const videoId = extractVideoId(row.video_url);
  if (!videoId) {
    console.warn(`  No video ID — using template fallback for: ${row.video_url}`);
    return buildSuggestedComment(row);
  }

  const lang = detectLangFromNotes(row.notes);
  const transcript = await fetchFullTranscript(videoId, lang);

  if (!transcript) {
    console.warn(`  No transcript — using template fallback for: ${row.video_title}`);
    return buildSuggestedComment(row);
  }

  const prompt = buildPrompt(row, transcript, lang);
  const aiComment = generateCommentWithClaude(prompt, 'claude-haiku-4-5-20251001');

  if (!aiComment) {
    console.warn(`  Claude failed — using template fallback for: ${row.video_title}`);
    return buildSuggestedComment(row);
  }

  return aiComment;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldDraftRow(row, overwrite) {
  const status = String(row.status || '').trim().toLowerCase();
  if (SKIP_STATUSES.has(status)) {
    return false;
  }

  if (!overwrite && String(row.suggested_comment || '').trim()) {
    return false;
  }

  return true;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.csv)) {
    throw new Error(`CSV not found: ${args.csv}`);
  }

  const csvText = fs.readFileSync(args.csv, 'utf8');
  const parsed = parseCsv(csvText);
  const header = parsed.header;
  const rows = parsed.rows;

  const rowsToUpdate = rows.filter((row) => shouldDraftRow(row, args.overwrite));

  if (args.dryRun) {
    console.log(`Would update ${rowsToUpdate.length} row(s).`);
    return;
  }

  let updatedCount = 0;
  for (const row of rowsToUpdate) {
    console.log(`Drafting comment for: ${row.video_title || row.video_url}`);
    row.suggested_comment = await buildSuggestedCommentAI(row);
    updatedCount += 1;
    if (updatedCount < rowsToUpdate.length) {
      await sleep(500);
    }
  }

  saveCsv(args.csv, header, rows);
  console.log(`Updated ${updatedCount} row(s) in ${args.csv}`);
}

run();
