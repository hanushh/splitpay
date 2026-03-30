#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(process.cwd(), '.env.development');
loadEnvFile(ENV_PATH);

const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  console.error("❌ Error: YOUTUBE_API_KEY was not found.");
  console.error("Expected it in the environment or in .env.development at the project root.");
  console.error("Usage: node marketing/youtube/youtube-marketing-scrape.js");
  process.exit(1);
}

const CSV_PATH = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-marketing-posts.csv');
const QUERIES_PATH = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-queries.json');
const QUERY_FAMILIES_PATH = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-query-families.json');
const QUERY_STATE_PATH = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-query-state.json');
const QUERY_COOLDOWN_HOURS = 72;
const MAX_QUERIES_PER_RUN = 5;       // Reduced from 8 → saves 300 units per run
const DAILY_QUOTA_BUDGET = 8000;     // 10,000 unit daily limit minus 2,000 buffer

// Strict freshness: only get videos from the last 90 days (per your priority feedback)
const NINETY_DAYS_AGO = new Date();
NINETY_DAYS_AGO.setDate(NINETY_DAYS_AGO.getDate() - 90);
const PUBLISHED_AFTER = NINETY_DAYS_AGO.toISOString();

if (!fs.existsSync(QUERIES_PATH)) {
  console.error(`❌ Missing query file: ${QUERIES_PATH}`);
  console.error('Create marketing/youtube/youtube-queries.json and manage search terms there.');
  process.exit(1);
}

// Load active queries
const QUERIES = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf8'));

if (!Array.isArray(QUERIES) || QUERIES.length === 0) {
  console.error(`❌ No YouTube queries found in ${QUERIES_PATH}`);
  console.error('Add one or more search phrases to marketing/youtube/youtube-queries.json before running the scraper.');
  process.exit(1);
}

const QUERY_FAMILIES = fs.existsSync(QUERY_FAMILIES_PATH)
  ? JSON.parse(fs.readFileSync(QUERY_FAMILIES_PATH, 'utf8'))
  : [];

// Detect language from Unicode script ranges. Returns a BCP-47 language code or 'en'.
const LANGUAGE_SCRIPTS = [
  { range: [0x0900, 0x097F], lang: 'hi' },  // Devanagari — Hindi / Marathi
  { range: [0x0B80, 0x0BFF], lang: 'ta' },  // Tamil
  { range: [0x0C00, 0x0C7F], lang: 'te' },  // Telugu
  { range: [0x0C80, 0x0CFF], lang: 'kn' },  // Kannada
  { range: [0x0D00, 0x0D7F], lang: 'ml' },  // Malayalam
  { range: [0x0980, 0x09FF], lang: 'bn' },  // Bengali
  { range: [0x0A80, 0x0AFF], lang: 'gu' },  // Gujarati
  { range: [0x0600, 0x06FF], lang: 'ar' },  // Arabic / Urdu
];

function detectLanguage(text) {
  for (const char of text) {
    const code = char.codePointAt(0);
    for (const { range, lang } of LANGUAGE_SCRIPTS) {
      if (code >= range[0] && code <= range[1]) return lang;
    }
  }
  return 'en';
}


const STOP_WORDS = new Set(["a","about","after","again","all","am","an","and","any","are","as","at","be","because","been","before","being","below","between","both","but","by","can","cannot","could","did","do","does","doing","down","during","each","few","for","from","further","had","has","have","having","he","her","here","hers","herself","him","himself","his","how","i","if","in","into","is","it","its","itself","me","more","most","my","myself","no","nor","not","of","off","on","once","only","or","other","our","ours","ourselves","out","over","own","same","she","should","so","some","such","than","that","the","their","theirs","them","themselves","then","there","these","they","this","those","through","to","too","under","until","up","very","was","we","were","what","when","where","which","while","who","whom","why","with","would","you","your","yours","yourself","yourselves","app","video","review","tutorial","guide","best","top"]);
const KEYWORD_ANCHORS = new Set([
  'split',
  'splitting',
  'bill',
  'bills',
  'expense',
  'expenses',
  'rent',
  'roommate',
  'roommates',
  'utilities',
  'shared',
  'trip',
  'travel',
  'friends',
  'budget',
  'hostel',
  'flatmate',
  'flatmates',
  'vacation',
  'pay',
  'paying',
]);

function normalizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeQueries(queries) {
  const uniqueQueries = [];
  const seen = new Map();

  for (const rawQuery of queries) {
    const query = String(rawQuery || '').trim();
    if (!query) {
      continue;
    }

    const normalized = normalizeQuery(query);
    if (seen.has(normalized)) {
      console.log(`⏭️  Skipping duplicate query: ${query} (same as ${seen.get(normalized)})`);
      continue;
    }

    seen.set(normalized, query);
    uniqueQueries.push(query);
  }

  return { uniqueQueries, seenNormalized: seen };
}

function buildQueryPool(manualQueries, families) {
  const pool = [];
  const seen = new Set();

  for (const family of families) {
    const familyQueries = Array.isArray(family.queries) ? family.queries : [];
    for (const rawQuery of familyQueries) {
      const query = String(rawQuery || '').trim();
      if (!query) {
        continue;
      }

      const normalized = normalizeQuery(query);
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      pool.push({
        query,
        familyId: family.id || 'unknown',
        familyPriority: Number(family.priority || 0),
        bucket: family.bucket || getQueryBucket(query),
        source: 'family',
      });
    }
  }

  for (const rawQuery of manualQueries) {
    const query = String(rawQuery || '').trim();
    if (!query) {
      continue;
    }

    const normalized = normalizeQuery(query);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    pool.push({
      query,
      familyId: 'manual_overrides',
      familyPriority: 1,
      bucket: getQueryBucket(query),
      source: 'manual',
    });
  }

  return pool;
}

function getQueryBucket(query) {
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

function getQueryPriority(query, state) {
  const normalized = normalizeQuery(query);
  const entry = state[normalized];

  if (!entry) {
    return 1000;
  }

  const newRowBoost = Number(entry.total_new_rows || 0) * 5;
  const avgBoost = Number(entry.avg_new_rows || 0) * 10;
  const staleBoost = Math.min(hoursSince(entry.last_checked_at), 24 * 14) / 24;
  const penalty =
    entry.last_run_status === 'no_results' ? 8 :
    entry.last_run_status === 'quotaExceeded' ? 3 :
    entry.last_run_status && entry.last_run_status !== 'ok' ? 5 :
    0;

  return newRowBoost + avgBoost + staleBoost - penalty;
}

function selectQueriesForRun(queryPool, state) {
  const familyMap = new Map();

  for (const candidate of queryPool) {
    const { query, familyId } = candidate;
    if (shouldSkipQueryByCooldown(query, state)) {
      const entry = state[normalizeQuery(query)];
      console.log(`⏭️  Skipping recently checked query: ${query} (last checked ${entry.last_checked_at})`);
      continue;
    }

    if (!familyMap.has(familyId)) {
      familyMap.set(familyId, []);
    }
    familyMap.get(familyId).push(candidate);
  }

  for (const familyQueries of familyMap.values()) {
    familyQueries.sort((a, b) => {
      const familyDelta = Number(b.familyPriority || 0) - Number(a.familyPriority || 0);
      if (familyDelta !== 0) {
        return familyDelta;
      }
      return getQueryPriority(b.query, state) - getQueryPriority(a.query, state);
    });
  }

  const selected = [];
  const families = Array.from(familyMap.keys()).sort((a, b) => {
    const aBest = familyMap.get(a)?.[0];
    const bBest = familyMap.get(b)?.[0];
    const familyDelta = Number(bBest?.familyPriority || 0) - Number(aBest?.familyPriority || 0);
    if (familyDelta !== 0) {
      return familyDelta;
    }
    return getQueryPriority(bBest?.query, state) - getQueryPriority(aBest?.query, state);
  });

  while (selected.length < MAX_QUERIES_PER_RUN) {
    let addedInPass = false;

    for (const familyId of families) {
      const familyQueries = familyMap.get(familyId);
      if (!familyQueries || familyQueries.length === 0) {
        continue;
      }

      selected.push(familyQueries.shift());
      addedInPass = true;
      if (selected.length >= MAX_QUERIES_PER_RUN) {
        break;
      }
    }

    if (!addedInPass) {
      break;
    }
  }

  return selected;
}

function loadQueryState() {
  if (!fs.existsSync(QUERY_STATE_PATH)) {
    return {};
  }

  try {
    const data = JSON.parse(fs.readFileSync(QUERY_STATE_PATH, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveQueryState(state) {
  fs.writeFileSync(QUERY_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function hoursSince(timestamp) {
  if (!timestamp) {
    return Infinity;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return Infinity;
  }

  return (Date.now() - parsed) / (1000 * 60 * 60);
}

function shouldSkipQueryByCooldown(query, state) {
  const normalized = normalizeQuery(query);
  const entry = state[normalized];
  if (!entry || !entry.last_checked_at) {
    return false;
  }

  return hoursSince(entry.last_checked_at) < QUERY_COOLDOWN_HOURS;
}

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

// Helper to extract top n-grams from successful titles
function getTopPhrases(titles) {
  const counts = {};
  for (const title of titles) {
    const words = title.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w && !STOP_WORDS.has(w));
    
    // bi-grams (2 words)
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i+1]}`;
      counts[phrase] = (counts[phrase] || 0) + 1;
    }
    // tri-grams (3 words)
    for (let i = 0; i < words.length - 2; i++) {
        const phrase = `${words[i]} ${words[i+1]} ${words[i+2]}`;
        counts[phrase] = (counts[phrase] || 0) + 1;
    }
  }

  // Sort by highest frequency and return phrases appearing >1 time
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .filter(s => {
      const phrase = s[0];
      const words = phrase.split(/\s+/);
      return (
        s[1] > 1 &&
        phrase.length > 4 &&
        words.some((word) => KEYWORD_ANCHORS.has(word))
      );
    })
    .slice(0, 3) // Take the top 3 best new phrases
    .map(s => s[0]);
}

// Helper to reliably escape CSV fields
function escapeCsvField(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// Split a single CSV line into fields, handling quoted fields correctly
function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// Get already tracked URLs from the video_url column only, so we don't duplicate
function getExistingUrls() {
  if (!fs.existsSync(CSV_PATH)) return new Set();
  const lines = fs.readFileSync(CSV_PATH, 'utf8').split(/\r?\n/);
  if (lines.length < 2) return new Set();

  const header = splitCsvLine(lines[0]);
  const urlColIndex = header.indexOf('video_url');
  if (urlColIndex === -1) return new Set();

  const urls = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = splitCsvLine(line);
    const url = fields[urlColIndex];
    if (url) urls.add(url.trim());
  }
  return urls;
}

// Fetch a short excerpt from auto-generated captions using YouTube's public timedtext endpoint.
// Returns the first ~300 chars of spoken text, or null if unavailable.
async function fetchTranscriptExcerpt(videoId, lang = 'en') {
  try {
    const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const events = data.events || [];
    const text = events
      .flatMap(e => (e.segs || []).map(s => s.utf8 || ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;
    return text.slice(0, 300) + (text.length > 300 ? '…' : '');
  } catch {
    return null;
  }
}

async function fetchYouTube(endpoint, params, units = 100, quotaTracker = null) {
  if (quotaTracker) {
    if (quotaTracker.used_today + units > DAILY_QUOTA_BUDGET) {
      const err = new Error(
        `Daily quota budget (${DAILY_QUOTA_BUDGET} units) reached. Used: ${quotaTracker.used_today} units today.`
      );
      err.reason = 'quotaBudgetExhausted';
      throw err;
    }
  }

  params.key = API_KEY;
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    console.error("❌ YouTube API Error Response:", JSON.stringify(data, null, 2));
    const error = new Error(`YouTube API Error: ${data.error?.message || res.statusText}`);
    error.reason = data.error?.errors?.[0]?.reason || null;
    error.status = res.status;
    throw error;
  }

  if (quotaTracker) {
    quotaTracker.used_today += units;
  }
  return data;
}

// Fetch viewCount + commentCount for a batch of video IDs in a single API call (1 unit).
async function fetchVideoStats(videoIds, quotaTracker) {
  if (!videoIds.length) return {};
  try {
    const data = await fetchYouTube(
      'videos',
      { part: 'statistics', id: videoIds.join(',') },
      1,
      quotaTracker
    );
    const statsMap = {};
    for (const item of data.items || []) {
      statsMap[item.id] = {
        viewCount: parseInt(item.statistics?.viewCount || '0', 10),
        commentCount: parseInt(item.statistics?.commentCount || '0', 10),
      };
    }
    return statsMap;
  } catch (err) {
    if (err.reason === 'quotaBudgetExhausted') throw err;
    console.warn(`  ⚠️  Could not fetch video stats: ${err.message}`);
    return {};
  }
}

function calculateScore(video, query, stats = null) {
  let intent = 3;
  let fit = 3;
  let freshness = 3;

  const title = video.snippet.title.toLowerCase();

  // Intent Score
  if (title.includes('alternative') || title.includes('app') || title.includes('review')) intent = 5;
  else if (title.includes('how to') || title.includes('guide')) intent = 4;

  // Fit Score
  if (title.includes('split') || title.includes('expense') || title.includes('bill')) fit = 5;

  // Freshness Score
  const ageDays = (new Date() - new Date(video.snippet.publishedAt)) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) freshness = 5;
  else if (ageDays <= 60) freshness = 4;
  else freshness = 3;

  // Promo safety: derived from real comment count when available, else default 4
  let promo_safety = 4;
  if (stats !== null) {
    const c = stats.commentCount;
    if (c >= 100) promo_safety = 5;
    else if (c >= 20) promo_safety = 4;
    else if (c >= 5) promo_safety = 3;
    else if (c >= 1) promo_safety = 2;
    else promo_safety = 1; // no comments — thread is dead
  }

  const android = 4; // No reliable signal from API alone

  const total = intent + fit + freshness + promo_safety + android;

  let priority = 'low';
  if (total >= 20) priority = 'high';
  else if (total >= 14) priority = 'medium';

  return { intent, fit, freshness, promo_safety, android, total, priority };
}

async function run() {
  console.log(`Starting YouTube scrape for latest videos (since ${NINETY_DAYS_AGO.toISOString().split('T')[0]})...`);
  const existingUrls = getExistingUrls();
  const newRows = [];
  const processedTitles = [];
  const { uniqueQueries, seenNormalized } = dedupeQueries(QUERIES);
  const queryPool = buildQueryPool(uniqueQueries, QUERY_FAMILIES);
  const queryState = loadQueryState();

  // Initialize daily quota tracker (resets automatically when the date changes)
  const today = new Date().toISOString().split('T')[0];
  const quotaTracker = queryState.__quota__ && queryState.__quota__.reset_date === today
    ? queryState.__quota__
    : { used_today: 0, reset_date: today };
  queryState.__quota__ = quotaTracker;
  console.log(`Quota budget: ${DAILY_QUOTA_BUDGET} units/day. Used so far today: ${quotaTracker.used_today}.`);

  let stopReason = null;
  const queriesForRun = selectQueriesForRun(queryPool, queryState);

  console.log(`Running ${queriesForRun.length} query bucket(s) this pass (max ${MAX_QUERIES_PER_RUN}).`);

  for (const queryCandidate of queriesForRun) {
    const query = queryCandidate.query;
    if (stopReason) {
      console.log(`⏹️  Stopping remaining queries: ${stopReason}`);
      break;
    }

    console.log(`\n🔍 Searching: ${query} [family=${queryCandidate.familyId}]`);
    try {
      // 1. Search for videos (100 units)
      const searchData = await fetchYouTube('search', {
        part: 'snippet',
        q: query,
        type: 'video',
        publishedAfter: PUBLISHED_AFTER,
        maxResults: 5,
        order: 'relevance'
      }, 100, quotaTracker);

      if (!searchData.items || searchData.items.length === 0) {
        console.log(`  No recent videos found.`);
        queryState[normalizeQuery(query)] = {
          last_checked_at: new Date().toISOString(),
          last_run_status: 'no_results',
          last_new_rows: 0,
        };
        continue;
      }

      // 2. Batch-fetch statistics for all returned video IDs (1 unit total)
      const allVideoIds = searchData.items.map(item => item.id.videoId).filter(Boolean);
      const statsMap = await fetchVideoStats(allVideoIds, quotaTracker);

      let addedForQuery = 0;
      for (const item of searchData.items) {
        const videoId = item.id.videoId;
        const url = `https://www.youtube.com/watch?v=${videoId}`;

        if (existingUrls.has(url)) {
          console.log(`  ⏭️  Skipping existing: ${url}`);
          continue;
        }

        const snippet = item.snippet;
        const uploadDate = snippet.publishedAt.split('T')[0];
        const stats = statsMap[videoId] || null;
        const scores = calculateScore(item, query, stats);

        const title = snippet.title.replace(/&amp;/g, '&');

        if (scores.priority === 'high' || (scores.fit >= 5 && scores.intent >= 4)) {
          processedTitles.push(title);
        }

        const detectedLang = detectLanguage(title);

        const transcriptExcerpt = await fetchTranscriptExcerpt(videoId, detectedLang !== 'en' ? detectedLang : 'en');

        const whyItFits = transcriptExcerpt
          ? `Matched query: [${query}]. Transcript excerpt: "${transcriptExcerpt}"`
          : `Matched query: [${query}]. No transcript available.`;

        const commentInfo = stats
          ? `comments=${stats.commentCount}, views=${stats.viewCount}`
          : 'stats unavailable';

        const row = [
          escapeCsvField(snippet.channelTitle),
          escapeCsvField(title),
          url,
          uploadDate,
          scores.priority,
          scores.intent,
          scores.fit,
          scores.freshness,
          scores.promo_safety,
          scores.android,
          scores.total,
          'not_commented',
          escapeCsvField(whyItFits),
          '',  // suggested_comment — filled by youtube-comment-drafter.js
          escapeCsvField(`Automated API pull. Detected language: ${detectedLang}. ${commentInfo}.`),
          '',  // comment_result — filled manually after posting
        ];

        newRows.push(row);
        existingUrls.add(url);
        addedForQuery += 1;
        console.log(`  ✅ Added [${scores.priority.toUpperCase()}]: ${snippet.title} (${uploadDate}) promo_safety=${scores.promo_safety}`);
      }

      queryState[normalizeQuery(query)] = {
        last_checked_at: new Date().toISOString(),
        last_run_status: 'ok',
        last_new_rows: addedForQuery,
        total_runs: Number(queryState[normalizeQuery(query)]?.total_runs || 0) + 1,
        total_new_rows: Number(queryState[normalizeQuery(query)]?.total_new_rows || 0) + addedForQuery,
        avg_new_rows:
          (Number(queryState[normalizeQuery(query)]?.total_new_rows || 0) + addedForQuery) /
          (Number(queryState[normalizeQuery(query)]?.total_runs || 0) + 1),
      };
    } catch (err) {
      if (err.reason === 'quotaBudgetExhausted') {
        stopReason = `daily budget of ${DAILY_QUOTA_BUDGET} units reached (used ${quotaTracker.used_today})`;
        console.warn(`\n⚠️  ${err.message}`);
        saveQueryState(queryState);
        break;
      }
      if (err.reason === 'quotaExceeded') {
        stopReason = 'YouTube API quota exceeded';
      }
      queryState[normalizeQuery(query)] = {
        last_checked_at: new Date().toISOString(),
        last_run_status: err.reason || 'error',
        last_new_rows: 0,
        total_runs: Number(queryState[normalizeQuery(query)]?.total_runs || 0) + 1,
        total_new_rows: Number(queryState[normalizeQuery(query)]?.total_new_rows || 0),
        avg_new_rows:
          Number(queryState[normalizeQuery(query)]?.total_runs || 0) + 1 > 0
            ? Number(queryState[normalizeQuery(query)]?.total_new_rows || 0) /
              (Number(queryState[normalizeQuery(query)]?.total_runs || 0) + 1)
            : 0,
      };
      console.error(`  ❌ Failed query "${query}":`, err.message);
    }
  }

  if (newRows.length > 0) {
    // Append to CSV
    const csvContent = newRows.map(r => r.join(',')).join('\n') + '\n';
    fs.appendFileSync(CSV_PATH, csvContent, 'utf8');
    console.log(`\n🎉 Successfully appended ${newRows.length} highly qualified video(s) to the CSV!`);
  } else {
    console.log(`\n🤷 No new videos found to append this run. (You've extracted all the recent good ones!)`);
  }

  saveQueryState(queryState);

  // Automate the Improvement Loop!
  if (processedTitles.length > 0) {
    const candidateKeywords = getTopPhrases(processedTitles);
    let addedCount = 0;
    
    candidateKeywords.forEach(phrase => {
      const normalizedPhrase = normalizeQuery(phrase);
      if (!seenNormalized.has(normalizedPhrase)) {
        QUERIES.push(phrase);
        seenNormalized.set(normalizedPhrase, phrase);
        addedCount++;
        console.log(`\n🤖 Auto-Learned Keyword: Added "${phrase}" to future searches!`);
      }
    });

    if (addedCount > 0) {
      fs.writeFileSync(QUERIES_PATH, JSON.stringify(QUERIES, null, 2));
      console.log(`Saved ${addedCount} new candidate phrases to youtube-queries.json for your next run.`);
    }
  }
}

run();
