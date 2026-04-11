#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawnSync } = require('child_process');

const DEFAULT_CSV = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-marketing-posts.csv');
const REQUIRED_REVIEW_COLUMNS = ['reviewed', 'reviewed_at'];

function parseArgs(argv) {
  const args = {
    csv: DEFAULT_CSV,
    index: null,
    priority: null,
    dryRun: false,
    includeReviewed: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--csv' && argv[i + 1]) {
      args.csv = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--index' && argv[i + 1]) {
      args.index = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--priority' && argv[i + 1]) {
      args.priority = String(argv[i + 1]).toLowerCase();
      i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--include-reviewed') {
      args.includeReviewed = true;
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
  node marketing/youtube/youtube-marketing-review.js
  node marketing/youtube/youtube-marketing-review.js --priority high
  node marketing/youtube/youtube-marketing-review.js --index 2
  node marketing/youtube/youtube-marketing-review.js --dry-run
  node marketing/youtube/youtube-marketing-review.js --include-reviewed

What it does:
  - Reads marketing/youtube-marketing-posts.csv
  - Opens one YouTube video at a time in your browser
  - Prints the drafted comment
  - Copies the drafted comment to your clipboard
  - Marks rows as reviewed in the CSV when you go through them

What it does not do:
  - It does not log into YouTube
  - It does not submit comments for you
  - It leaves the final post decision and edits to you
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
    return [];
  }

  // Handle BOM if present
  let headerRow = rows[0];
  if (headerRow[0] && headerRow[0].charCodeAt(0) === 0xFEFF) {
    headerRow[0] = headerRow[0].substring(1);
  }

  const [header, ...dataRows] = rows;
  const records = dataRows.map((dataRow) => {
    const record = {};
    header.forEach((key, index) => {
      record[key.trim()] = dataRow[index] ?? '';
    });
    return record;
  });

  return { header: header.map(h => h.trim()), rows: records };
}

function ensureReviewColumns(header, rows) {
  const nextHeader = [...header];

  for (const column of REQUIRED_REVIEW_COLUMNS) {
    if (!nextHeader.includes(column)) {
      nextHeader.push(column);
    }
  }

  rows.forEach((row) => {
    for (const column of REQUIRED_REVIEW_COLUMNS) {
      if (!(column in row)) {
        row[column] = '';
      }
    }
  });

  return nextHeader;
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

function assertUniqueByVideoUrl(rows) {
  const seen = new Map();

  rows.forEach((row, index) => {
    const videoUrl = String(row.video_url || '').trim();
    const lineNumber = index + 2;

    if (!videoUrl) {
      throw new Error(`CSV row ${lineNumber} is missing video_url.`);
    }

    if (seen.has(videoUrl)) {
      const firstLine = seen.get(videoUrl);
      throw new Error(
        `Duplicate CSV entry detected for video_url ${videoUrl} at lines ${firstLine} and ${lineNumber}.`
      );
    }

    seen.set(videoUrl, lineNumber);
  });
}

function openUrl(url) {
  const platform = os.platform();

  if (platform === 'darwin') {
    return spawnSync('open', [url], { stdio: 'ignore' });
  }

  if (platform === 'win32') {
    return spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  }

  return spawnSync('xdg-open', [url], { stdio: 'ignore' });
}

function copyToClipboard(text) {
  const platform = os.platform();

  if (platform === 'darwin') {
    return spawnSync('pbcopy', [], { input: text, encoding: 'utf8' });
  }

  if (platform === 'win32') {
    return spawnSync('clip', [], { input: text, encoding: 'utf8' });
  }

  return spawnSync('xclip', ['-selection', 'clipboard'], {
    input: text,
    encoding: 'utf8',
  });
}

function prompt(rl, message) {
  return new Promise((resolve) => {
    rl.question(message, resolve);
  });
}

function isReviewed(row) {
  return String(row.reviewed || '').trim().toLowerCase() === 'yes';
}

function markReviewed(row) {
  row.reviewed = 'yes';
  row.reviewed_at = new Date().toISOString();
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.csv)) {
    throw new Error(`CSV not found: ${args.csv}`);
  }

  const csvText = fs.readFileSync(args.csv, 'utf8');
  const parsed = parseCsv(csvText);
  const header = ensureReviewColumns(parsed.header, parsed.rows);
  const rows = parsed.rows;
  assertUniqueByVideoUrl(rows);

  let filtered = rows;
  if (!args.includeReviewed) {
    filtered = filtered.filter((row) => !isReviewed(row));
  }
  if (args.priority) {
    filtered = filtered.filter(
      (row) => String(row.priority || '').toLowerCase() === args.priority
    );
  }

  if (args.index !== null) {
    if (!Number.isInteger(args.index) || args.index < 1 || args.index > filtered.length) {
      throw new Error(`--index must be between 1 and ${filtered.length}`);
    }
    filtered = [filtered[args.index - 1]];
  }

  if (filtered.length === 0) {
    console.log('No matching marketing rows found.');
    return;
  }

  console.log(`Loaded ${filtered.length} marketing entr${filtered.length === 1 ? 'y' : 'ies'} from ${args.csv}`);
  console.log('This script opens the video, copies the drafted comment, and marks reviewed rows in the CSV.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (let i = 0; i < filtered.length; i += 1) {
      const row = filtered[i];
      console.log(`\n[${i + 1}/${filtered.length}] ${row.channel_name || 'Unknown Channel'} - ${row.video_title}`);
      console.log(`Date: ${row.upload_date} | Priority: ${row.priority} | Score: ${row.total_score || 'N/A'}`);
      console.log(`URL: ${row.video_url}`);
      console.log(`Why it fits: ${row.why_it_fits || 'N/A'}`);
      console.log('\nDrafted reply:\n');
      console.log(row.suggested_comment || 'No comment drafted.');
      console.log('\nNotes:');
      console.log(row.notes || 'None');

      if (!args.dryRun) {
        const openResult = openUrl(row.video_url);
        if (openResult.status !== 0) {
          console.log('\nCould not open the browser automatically on this machine.');
        }

        const copyResult = copyToClipboard(row.suggested_comment || '');
        if (copyResult.status === 0) {
          console.log('\nReply copied to clipboard.');
        } else {
          console.log('\nCould not copy to clipboard automatically.');
        }

        markReviewed(row);
        saveCsv(args.csv, header, rows);
        console.log(`Marked as reviewed at ${row.reviewed_at}.`);
      }

      const answer = await prompt(
        rl,
        '\nPress Enter for the next item, type "skip" to continue, or "q" to quit: '
      );

      if (answer.trim().toLowerCase() === 'q') {
        break;
      }
    }
  } finally {
    rl.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
