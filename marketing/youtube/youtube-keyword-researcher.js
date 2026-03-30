#!/usr/bin/env node
/**
 * YouTube Keyword Researcher
 *
 * Discovers new search query candidates using YouTube autocomplete (free, no quota),
 * scores them with Claude Haiku, and auto-promotes high-scoring candidates to
 * youtube-queries.json. Designed to run before the scraper to keep the keyword
 * pool fresh without spending YouTube API quota on unproven queries.
 *
 * Usage:
 *   node marketing/youtube/youtube-keyword-researcher.js
 *   node marketing/youtube/youtube-keyword-researcher.js --dry-run   (preview only, no writes)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const QUERIES_PATH = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-queries.json');
const QUERY_FAMILIES_PATH = path.join(process.cwd(), 'marketing', 'youtube', 'youtube-query-families.json');

const SCORE_THRESHOLD = 4;   // auto-promote if Claude scores >= this
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// Short intent anchors — kept broad so autocomplete returns diverse completions
const SEED_TOPICS = [
  'how to split bills',
  'how to split rent',
  'roommate money',
  'roommate not paying',
  'friends owe me money',
  'group trip expenses',
  'travel expenses friends',
  'shared expenses',
  'how to handle money with friends',
  'awkward money situation',
  'bill splitting',
  'asking for money back',
  'splitting costs',
  'how to track shared expenses',
  'who pays on a trip',
];

// --- helpers ---

function loadEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return;
  fs.readFileSync(filepath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const sep = trimmed.indexOf('=');
    if (sep === -1) return;
    const key = trimmed.slice(0, sep).trim();
    if (!key || process.env[key] !== undefined) return;
    let value = trimmed.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function normalizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadExistingNormalized() {
  const seen = new Set();

  const queries = fs.existsSync(QUERIES_PATH)
    ? JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf8'))
    : [];
  for (const q of queries) seen.add(normalizeQuery(q));

  const families = fs.existsSync(QUERY_FAMILIES_PATH)
    ? JSON.parse(fs.readFileSync(QUERY_FAMILIES_PATH, 'utf8'))
    : [];
  for (const family of families) {
    for (const q of family.queries || []) seen.add(normalizeQuery(q));
  }

  return seen;
}

// Fetch YouTube autocomplete suggestions for a seed query (zero quota cost).
async function fetchAutocompleteSuggestions(seed) {
  try {
    const encoded = encodeURIComponent(seed);
    // client=firefox returns plain JSON; ds=yt scopes to YouTube
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encoded}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    // Response shape: ["seed query", ["suggestion1", "suggestion2", ...]]
    return Array.isArray(data[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

// Score a batch of candidate queries with Claude Haiku.
// Returns an array of { query, score } objects.
function scoreCandidatesWithClaude(candidates) {
  const numbered = candidates.map((q, i) => `${i + 1}. "${q}"`).join('\n');

  const prompt = `You are evaluating YouTube search queries for a bill-splitting app called PaySplit (Android).

Score each query 1–5 based on how likely it is to surface YouTube videos where the viewer is experiencing a shared-expense problem that PaySplit could solve:

5 = Almost certainly about shared-expense friction (roommates, group trips, friends owing money, awkward bill situations)
4 = Likely surfaces relevant videos about money tension with others
3 = Mixed signal — might surface relevant content, unclear
2 = Probably off-topic (solo personal finance, general budgeting, unrelated money topics)
1 = Clearly unrelated

Queries to score:
${numbered}

Return ONLY a valid JSON array with no extra text, markdown, or explanation:
[{"query": "exact query text", "score": 5}, ...]`;

  const result = spawnSync('claude', ['-p', prompt, '--model', CLAUDE_MODEL], {
    encoding: 'utf8',
    timeout: 90000,
  });

  if (result.status !== 0 || result.error || !result.stdout.trim()) {
    console.warn('  ⚠️  Claude scoring failed:', result.stderr?.trim() || result.error?.message);
    return [];
  }

  try {
    // Strip any accidental markdown fences Claude might add
    const raw = result.stdout.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => typeof item.query === 'string' && typeof item.score === 'number');
  } catch (err) {
    console.warn('  ⚠️  Could not parse Claude response:', err.message);
    return [];
  }
}

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  loadEnvFile(path.join(process.cwd(), '.env.development'));

  console.log(`\n🔬 YouTube Keyword Researcher${isDryRun ? ' [DRY RUN]' : ''}`);
  console.log(`Score threshold for auto-promotion: ≥ ${SCORE_THRESHOLD}/5\n`);

  const existingNormalized = loadExistingNormalized();
  console.log(`Existing query pool: ${existingNormalized.size} unique queries\n`);

  // 1. Collect autocomplete suggestions for all seeds
  const candidateSet = new Set();
  for (const seed of SEED_TOPICS) {
    process.stdout.write(`  Autocomplete: "${seed}" → `);
    const suggestions = await fetchAutocompleteSuggestions(seed);
    let newCount = 0;
    for (const suggestion of suggestions) {
      const normalized = normalizeQuery(suggestion);
      if (!existingNormalized.has(normalized) && !candidateSet.has(normalized)) {
        candidateSet.add(normalized);
        newCount++;
      }
    }
    console.log(`${suggestions.length} suggestions, ${newCount} new`);
    // Small delay to avoid hammering the autocomplete endpoint
    await new Promise(r => setTimeout(r, 200));
  }

  const candidates = Array.from(candidateSet);
  console.log(`\n📋 Total new candidates to score: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log('No new candidates found. Query pool is already comprehensive.');
    return;
  }

  // 2. Score in batches of 20 (keeps prompt size manageable for Haiku)
  const BATCH_SIZE = 20;
  const scored = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    console.log(`\n🤖 Scoring batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(candidates.length / BATCH_SIZE)} (${batch.length} queries)...`);
    const results = scoreCandidatesWithClaude(batch);
    scored.push(...results);
  }

  // 3. Filter to promotable candidates
  const toPromote = scored
    .filter(item => item.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const tooLow = scored.filter(item => item.score < SCORE_THRESHOLD);

  console.log(`\n✅ Promoting (score ≥ ${SCORE_THRESHOLD}): ${toPromote.length} queries`);
  for (const item of toPromote) {
    console.log(`   [${item.score}/5] ${item.query}`);
  }

  if (tooLow.length > 0) {
    console.log(`\n❌ Skipped (score < ${SCORE_THRESHOLD}): ${tooLow.length} queries`);
    for (const item of tooLow.sort((a, b) => b.score - a.score)) {
      console.log(`   [${item.score}/5] ${item.query}`);
    }
  }

  if (toPromote.length === 0) {
    console.log('\nNo candidates met the threshold. Nothing written.');
    return;
  }

  if (isDryRun) {
    console.log('\n[DRY RUN] No changes written.');
    return;
  }

  // 4. Merge into youtube-queries.json (append, dedupe)
  const existing = fs.existsSync(QUERIES_PATH)
    ? JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf8'))
    : [];

  const existingNorm = new Set(existing.map(normalizeQuery));
  const newEntries = toPromote
    .map(item => item.query)
    .filter(q => !existingNorm.has(normalizeQuery(q)));

  if (newEntries.length === 0) {
    console.log('\nAll promoted candidates already exist in queries.json. Nothing written.');
    return;
  }

  const updated = [...existing, ...newEntries];
  fs.writeFileSync(QUERIES_PATH, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log(`\n🎉 Added ${newEntries.length} new queries to youtube-queries.json`);
}

run().catch(err => {
  console.error('❌ Researcher failed:', err.message);
  process.exit(1);
});
