#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ASO_DIR = path.join(ROOT, 'marketing', 'aso');
const KEYWORDS_TSV_PATH = path.join(ASO_DIR, 'keywords.tsv');
const SEEDS_PATH = path.join(ASO_DIR, 'keyword-seeds.json');
const RESEARCH_CONFIG_PATH = path.join(ASO_DIR, 'research-config.json');
const APP_JSON_PATH = path.join(ROOT, 'app.json');
const LOCALE_EN_PATH = path.join(ROOT, 'locales', 'en.json');
const YOUTUBE_QUERIES_PATH = path.join(ROOT, 'marketing', 'youtube', 'youtube-queries.json');
const REDDIT_CSV_PATH = path.join(ROOT, 'marketing', 'reddit', 'reddit-marketing-posts.csv');
const YOUTUBE_CSV_PATH = path.join(ROOT, 'marketing', 'youtube', 'youtube-marketing-posts.csv');

const CATEGORY_ORDER = [
  'core_function',
  'use_case',
  'competitor',
  'ai_angle',
  'long_tail',
  'audience',
];

const DOMAIN_TERMS = [
  'split',
  'bill',
  'bills',
  'expense',
  'expenses',
  'shared',
  'share',
  'owe',
  'owed',
  'group',
  'settle',
  'payment',
  'payments',
  'rent',
  'roommate',
  'roommates',
  'trip',
  'travel',
  'vacation',
  'friend',
  'friends',
  'balance',
  'balances',
  'receipt',
  'iou',
  'utility',
  'utilities',
  'house',
  'grocery',
];

const COMPETITOR_TERMS = [
  'splitwise',
  'tricount',
  'settle up',
  'settleup',
  'splid',
  'honeydue',
  'billr',
  'tab',
];

const USE_CASE_TERMS = [
  'roommate',
  'roommates',
  'rent',
  'utilities',
  'trip',
  'travel',
  'vacation',
  'dinner',
  'restaurant',
  'house',
  'housemates',
  'flatmate',
  'grocery',
  'wedding',
  'coworker',
  'hostel',
  'college',
  'student',
  'family',
  'couple',
  'friends',
];

const AI_TERMS = ['ai', 'smart', 'voice', 'assistant', 'chatbot', 'chat'];
const FEATURE_TERMS = ['exact', 'percent', 'percentage', 'receipt', 'csv', 'export', 'multi currency'];
const SOCIAL_TERMS = [
  'awkward',
  'repayment',
  'who paid',
  'money fights',
  'arguments',
  'not paying',
  'their share',
  'without spreadsheets',
  'without reminders',
  'without awkwardness',
  'owe me',
];
const REGIONAL_TERMS = [
  'india',
  'indian',
  'uk',
  'usa',
  'us',
  'uae',
  'dubai',
  'singapore',
  'hostel',
  'flatmate',
  'housemates',
];

function parseArgs(argv) {
  const args = {
    limit: 25,
    dryRun: false,
    offline: false,
    social: true,
    regional: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit' && argv[i + 1]) {
      args.limit = Math.max(1, Number.parseInt(argv[i + 1], 10) || 25);
      i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--offline') {
      args.offline = true;
    } else if (arg === '--no-social') {
      args.social = false;
    } else if (arg === '--no-regional') {
      args.regional = false;
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
  node marketing/aso/keyword-autoresearch.js
  node marketing/aso/keyword-autoresearch.js --limit 40
  node marketing/aso/keyword-autoresearch.js --offline
  node marketing/aso/keyword-autoresearch.js --dry-run

What it does:
  - loads seed keywords from marketing/aso/keyword-seeds.json
  - mines repo metadata plus existing YouTube keyword inputs
  - mines social pain language from Reddit/YouTube research data
  - generates regional keyword variants from marketing/aso/research-config.json
  - expands terms with Google autocomplete when network is available
  - scores each keyword for relevance, competition, and volume
  - appends net-new rows to marketing/aso/keywords.tsv
`);
}

function ensureDir(filepath) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
}

function normalizeKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/["'`]+/g, '')
    .replace(/[^a-z0-9+&/\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeNote(value) {
  return String(value || '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/,+/g, ';')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const dataLines = lines.filter((line) => !line.startsWith('#'));
  if (dataLines.length === 0) {
    return { header: [], rows: [] };
  }

  const [headerLine, ...rowLines] = dataLines;
  const header = headerLine.split('\t');
  const rows = rowLines.map((line) => {
    const fields = line.split('\t');
    const row = {};
    header.forEach((column, index) => {
      row[column] = fields[index] ?? '';
    });
    return row;
  });

  return { header, rows };
}

function saveTsv(filepath, header, rows, recommendationLines = []) {
  const lines = [
    header.join('\t'),
    ...rows.map((row) =>
      header.map((column) => String(row[column] ?? '')).join('\t')
    ),
  ];

  if (recommendationLines.length > 0) {
    lines.push('');
    lines.push(...recommendationLines);
  }

  fs.writeFileSync(filepath, `${lines.join('\n')}\n`, 'utf8');
}

function loadJson(filepath, fallback) {
  if (!fs.existsSync(filepath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
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
  return {
    header,
    rows: dataRows.map((dataRow) => {
      const record = {};
      header.forEach((key, index) => {
        record[String(key || '').trim()] = dataRow[index] ?? '';
      });
      return record;
    }),
  };
}

function loadExistingRows() {
  ensureDir(KEYWORDS_TSV_PATH);

  if (!fs.existsSync(KEYWORDS_TSV_PATH)) {
    fs.writeFileSync(
      KEYWORDS_TSV_PATH,
      'keyword\trelevance\tcompetition\tvolume\tcategory\tnotes\n',
      'utf8'
    );
  }

  const parsed = parseTsv(fs.readFileSync(KEYWORDS_TSV_PATH, 'utf8'));
  const header =
    parsed.header.length > 0
      ? parsed.header
      : ['keyword', 'relevance', 'competition', 'volume', 'category', 'notes'];

  return { header, rows: parsed.rows };
}

function classifyCategory(keyword, fallback = 'core_function') {
  const value = normalizeKeyword(keyword);

  if (COMPETITOR_TERMS.some((term) => value.includes(term))) {
    return 'competitor';
  }
  if (containsWholeTerm(value, AI_TERMS)) {
    return 'ai_angle';
  }
  if (
    value.includes('how ') ||
    value.includes('app to ') ||
    value.includes('best app ') ||
    value.includes('who owes') ||
    value.includes('how much do i owe') ||
    containsAny(value, SOCIAL_TERMS)
  ) {
    return 'long_tail';
  }
  if (
    ['roommate', 'roommates', 'student', 'college', 'family', 'couple', 'friends', 'coworker', 'housemates', 'flatmate', 'hostel', 'backpacker', 'nomad'].some(
      (term) => value.includes(term)
    )
  ) {
    return 'audience';
  }
  if (USE_CASE_TERMS.some((term) => value.includes(term))) {
    return 'use_case';
  }

  return fallback;
}

function buildRepoDrivenCandidates() {
  const appJson = loadJson(APP_JSON_PATH, {});
  const localeEn = loadJson(LOCALE_EN_PATH, {});
  const candidates = [];

  const webDescription = normalizeKeyword(appJson?.expo?.web?.description || '');
  if (webDescription) {
    candidates.push({
      keyword: webDescription,
      category: 'core_function',
      source: 'app.json web description',
    });
  }

  const localeMappings = [
    ['ai.quickActionBalance', 'how much do i owe app', 'long_tail'],
    ['ai.title', 'ai expense assistant', 'ai_angle'],
    ['expense.exactAmounts', 'exact split bills app', 'core_function'],
    ['expense.percentPerPerson', 'percentage split bills app', 'core_function'],
    ['expense.addReceipt', 'receipt expense tracker', 'core_function'],
    ['group.exportCsv', 'expense csv export app', 'core_function'],
    ['group.spending', 'group spending tracker', 'use_case'],
    ['balances.youOweTotal', 'shared balance tracker', 'core_function'],
    ['friends.inviteToApp', 'expense app with friend invites', 'audience'],
    ['auth.joinApp', 'app to split expenses', 'core_function'],
  ];

  localeMappings.forEach(([key, keyword, category]) => {
    if (localeEn[key]) {
      candidates.push({
        keyword,
        category,
        source: `locales/en.json:${key}`,
      });
    }
  });

  return candidates;
}

function readSocialSourceRows(filepath) {
  if (!fs.existsSync(filepath)) {
    return [];
  }

  const parsed = parseCsv(fs.readFileSync(filepath, 'utf8'));
  return parsed.rows;
}

function buildSocialCandidates(config) {
  const candidates = [];
  const socialPhrases = Array.isArray(config.social_phrases) ? config.social_phrases : [];
  socialPhrases.forEach((keyword) => {
    candidates.push({
      keyword,
      category: classifyCategory(keyword, 'long_tail'),
      source: 'research config social phrase',
    });
  });

  const redditRows = readSocialSourceRows(REDDIT_CSV_PATH);
  const youtubeRows = readSocialSourceRows(YOUTUBE_CSV_PATH);
  const textPool = [
    ...redditRows.flatMap((row) => [row.title, row.why_it_fits, row.notes]),
    ...youtubeRows.flatMap((row) => [row.video_title, row.why_it_fits, row.notes]),
  ]
    .map((value) => normalizeKeyword(value))
    .filter(Boolean);

  const patternMap = [
    { match: ['awkward', 'money', 'roommate'], keyword: 'awkward roommate money app' },
    { match: ['not paying', 'share'], keyword: 'roommate not paying share app' },
    { match: ['splitwise', 'alternative'], keyword: 'splitwise alternative for roommates' },
    { match: ['trip', 'money'], keyword: 'group trip money app' },
    { match: ['who pays', 'what'], keyword: 'who paid what app' },
    { match: ['shared', 'expenses', 'friends'], keyword: 'friends shared expenses app' },
  ];

  patternMap.forEach((pattern) => {
    if (
      textPool.some((text) =>
        pattern.match.every((fragment) => text.includes(fragment))
      )
    ) {
      candidates.push({
        keyword: pattern.keyword,
        category: classifyCategory(pattern.keyword, 'long_tail'),
        source: 'reddit/youtube pain language',
      });
    }
  });

  return candidates;
}

function buildRegionalCandidates(config) {
  const candidates = [];
  const markets = Array.isArray(config.regional_markets) ? config.regional_markets : [];

  markets.forEach((marketConfig) => {
    const modifiers = Array.isArray(marketConfig.modifiers) ? marketConfig.modifiers : [];
    const bases = Array.isArray(marketConfig.keyword_bases) ? marketConfig.keyword_bases : [];
    const languages = Array.isArray(marketConfig.languages) ? marketConfig.languages.join('/') : 'en';

    bases.forEach((base) => {
      modifiers.forEach((modifier) => {
        candidates.push({
          keyword: `${base} ${modifier}`,
          category: classifyCategory(`${base} ${modifier}`, classifyCategory(base, 'use_case')),
          source: `regional market ${marketConfig.market} locales ${languages}`,
        });
      });
    });
  });

  return candidates;
}

function buildInitialQueue(args) {
  const queue = [];
  const seen = new Set();
  const seeds = loadJson(SEEDS_PATH, {});
  const researchConfig = loadJson(RESEARCH_CONFIG_PATH, {});
  const youtubeQueries = loadJson(YOUTUBE_QUERIES_PATH, []);
  const repoCandidates = buildRepoDrivenCandidates();

  function pushCandidate(keyword, category, source) {
    const normalized = normalizeKeyword(keyword);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    queue.push({
      keyword: normalized,
      category: classifyCategory(normalized, category),
      source,
    });
  }

  CATEGORY_ORDER.forEach((category) => {
    const values = Array.isArray(seeds[category]) ? seeds[category] : [];
    values.forEach((keyword) => pushCandidate(keyword, category, 'seed file'));
  });

  repoCandidates.forEach((candidate) =>
    pushCandidate(candidate.keyword, candidate.category, candidate.source)
  );

  youtubeQueries.forEach((keyword) =>
    pushCandidate(keyword, classifyCategory(keyword), 'youtube query list')
  );

  if (args.social) {
    buildSocialCandidates(researchConfig).forEach((candidate) =>
      pushCandidate(candidate.keyword, candidate.category, candidate.source)
    );
  }

  if (args.regional) {
    buildRegionalCandidates(researchConfig).forEach((candidate) =>
      pushCandidate(candidate.keyword, candidate.category, candidate.source)
    );
  }

  const sourcePriority = (source) => {
    const value = String(source || '').toLowerCase();
    if (value.includes('social') || value.includes('pain language')) return 0;
    if (value.includes('regional market')) return 1;
    if (value.includes('app.json') || value.includes('locales/en.json')) return 2;
    if (value.includes('seed file')) return 3;
    if (value.includes('youtube query')) return 4;
    return 5;
  };

  queue.sort((a, b) => {
    const sourceDiff = sourcePriority(a.source) - sourcePriority(b.source);
    if (sourceDiff !== 0) {
      return sourceDiff;
    }
    return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  });

  return queue;
}

function containsAny(keyword, terms) {
  return terms.some((term) => keyword.includes(term));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholeTerm(keyword, terms) {
  return terms.some((term) => {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`);
    return pattern.test(keyword);
  });
}

function hasCoreIntent(keyword) {
  return [
    'split bill',
    'split bills',
    'bill split',
    'bill splitting',
    'bill splitter',
    'shared expense',
    'shared expenses',
    'group expense',
    'group expenses',
    'expense split',
    'settle up',
    'who owes',
    'who paid',
    'pays for everyone',
    'iou',
    'track shared expenses',
    'money owed tracker',
  ].some((term) => keyword.includes(term));
}

function scoreRelevance(keyword, category) {
  const hasDomain =
    containsAny(keyword, DOMAIN_TERMS) ||
    containsAny(keyword, COMPETITOR_TERMS) ||
    containsAny(keyword, SOCIAL_TERMS) ||
    containsAny(keyword, REGIONAL_TERMS);
  if (!hasDomain) {
    return 1;
  }

  let score = 1;

  if (containsAny(keyword, COMPETITOR_TERMS)) {
    score += 3;
  }
  if (hasCoreIntent(keyword) || keyword.includes('expense tracker')) {
    score += 2;
  }
  if (containsAny(keyword, USE_CASE_TERMS)) {
    score += 1;
  }
  if (containsAny(keyword, FEATURE_TERMS)) {
    score += 1;
  }
  if (containsAny(keyword, SOCIAL_TERMS)) {
    score += 1;
  }
  if (containsAny(keyword, REGIONAL_TERMS)) {
    score += 1;
  }
  if (category === 'core_function' || category === 'use_case' || category === 'competitor') {
    score += 1;
  }
  if (category === 'ai_angle') {
    score -= containsAny(keyword, ['expense', 'bill', 'split']) ? 0 : 1;
  }
  if (keyword.includes('budget') || keyword.includes('personal finance')) {
    score -= 2;
  }

  return Math.max(1, Math.min(5, score));
}

function scoreCompetition(keyword, category) {
  if (
    containsAny(keyword, COMPETITOR_TERMS) ||
    keyword === 'split bills app' ||
    keyword === 'bill splitting app' ||
    keyword === 'shared expense tracker' ||
    keyword === 'expense tracker'
  ) {
    return 'high';
  }

  if (
    category === 'long_tail' ||
    containsAny(keyword, ['exact', 'percentage', 'receipt', 'csv export']) ||
    containsAny(keyword, REGIONAL_TERMS)
  ) {
    return 'low';
  }

  if (category === 'ai_angle') {
    return containsAny(keyword, ['expense', 'bill', 'split']) ? 'medium' : 'low';
  }

  return 'medium';
}

function scoreVolume(keyword, category) {
  const words = keyword.split(' ').filter(Boolean).length;

  if (
    keyword === 'split bills app' ||
    keyword === 'bill splitting app' ||
    keyword === 'splitwise alternative' ||
    keyword === 'roommate expense tracker'
  ) {
    return 'high';
  }

  if (category === 'long_tail') {
    return words >= 6 ? 'niche' : 'low';
  }

  if (containsAny(keyword, REGIONAL_TERMS)) {
    return words <= 4 ? 'medium' : 'low';
  }

  if (category === 'ai_angle') {
    return containsAny(keyword, ['expense', 'bill', 'split']) ? 'low' : 'niche';
  }

  if (words <= 3) {
    return 'high';
  }
  if (words <= 5) {
    return 'medium';
  }
  return category === 'audience' ? 'low' : 'medium';
}

async function fetchAutocomplete(keyword) {
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('q', keyword);

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`autocomplete request failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    return [];
  }

  return payload[1].map((item) => normalizeKeyword(item)).filter(Boolean);
}

function looksRelevant(keyword) {
  return (
    containsAny(keyword, DOMAIN_TERMS) ||
    containsAny(keyword, COMPETITOR_TERMS) ||
    containsWholeTerm(keyword, AI_TERMS) ||
    containsAny(keyword, SOCIAL_TERMS) ||
    containsAny(keyword, REGIONAL_TERMS)
  );
}

function scoreKeyword(candidate, suggestions) {
  const relevance = scoreRelevance(candidate.keyword, candidate.category);
  const competition = scoreCompetition(candidate.keyword, candidate.category);
  const volume = scoreVolume(candidate.keyword, candidate.category);

  const noteParts = [candidate.source];
  if (suggestions.length > 0) {
    noteParts.push(`autocomplete: ${suggestions.slice(0, 3).join(' | ')}`);
  } else {
    noteParts.push('autocomplete: none');
  }

  return {
    keyword: candidate.keyword,
    relevance: String(relevance),
    competition,
    volume,
    category: candidate.category,
    notes: sanitizeNote(noteParts.join('; ')),
  };
}

function enqueueSuggestion(queue, queuedKeywords, keyword, fallbackCategory, source) {
  const normalized = normalizeKeyword(keyword);
  if (!normalized || queuedKeywords.has(normalized) || !looksRelevant(normalized)) {
    return;
  }

  queuedKeywords.add(normalized);
  queue.push({
    keyword: normalized,
    category: classifyCategory(normalized, fallbackCategory),
    source,
  });
}

function compositeScore(row) {
  const relevance = Number.parseInt(row.relevance, 10) || 0;
  const volumeScore =
    row.volume === 'high' ? 3 : row.volume === 'medium' ? 2 : row.volume === 'low' ? 1 : 0;
  const competitionScore =
    row.competition === 'low' ? 2 : row.competition === 'medium' ? 1 : 0;
  return relevance * 3 + volumeScore + competitionScore;
}

function recommendPlacement(row) {
  if (
    row.category === 'core_function' &&
    row.relevance === '5' &&
    (row.volume === 'high' || row.volume === 'medium')
  ) {
    return 'title';
  }
  if (row.category === 'use_case' || row.category === 'competitor') {
    return 'short description';
  }
  return 'keyword field';
}

function buildRecommendationReason(row) {
  if (row.category === 'competitor') {
    return 'high-intent switcher query with clear category awareness';
  }
  if (row.category === 'use_case') {
    return 'maps directly to a concrete shared-expense job PaySplit already solves';
  }
  if (row.category === 'ai_angle') {
    return 'differentiator term worth testing but likely lower-volume than core shared-expense language';
  }
  if (row.category === 'long_tail') {
    return 'specific problem phrasing with likely lower competition';
  }
  return 'strong general-purpose category term for shared expenses';
}

function buildTopRecommendations(rows) {
  if (rows.length < 100) {
    return [];
  }

  const unique = new Map();
  rows.forEach((row) => {
    const key = normalizeKeyword(row.keyword);
    if (!unique.has(key) || compositeScore(row) > compositeScore(unique.get(key))) {
      unique.set(key, row);
    }
  });

  const topRows = [...unique.values()]
    .sort((a, b) => compositeScore(b) - compositeScore(a))
    .slice(0, 30);

  return [
    '# Top 30 Recommended Keywords',
    '# Ranked by relevance first, then volume, then competition.',
    ...topRows.map((row, index) => {
      const placement = recommendPlacement(row);
      const reason = buildRecommendationReason(row);
      return `# ${index + 1}. ${row.keyword} | placement=${placement} | reason=${reason}`;
    }),
  ];
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { header, rows } = loadExistingRows();
  const existingKeywords = new Set(rows.map((row) => normalizeKeyword(row.keyword)));
  const queuedKeywords = new Set(existingKeywords);
  const queue = buildInitialQueue(args);
  queue.forEach((candidate) => queuedKeywords.add(candidate.keyword));

  const newRows = [];
  let autocompleteFailures = 0;

  while (queue.length > 0 && newRows.length < args.limit) {
    const candidate = queue.shift();
    if (!candidate || existingKeywords.has(candidate.keyword)) {
      continue;
    }

    let suggestions = [];
    if (!args.offline) {
      try {
        suggestions = await fetchAutocomplete(candidate.keyword);
      } catch (error) {
        autocompleteFailures += 1;
        suggestions = [];
      }
    }

    const scored = scoreKeyword(candidate, suggestions);
    newRows.push(scored);
    existingKeywords.add(candidate.keyword);

    suggestions.slice(0, 5).forEach((suggestion) => {
      enqueueSuggestion(
        queue,
        queuedKeywords,
        suggestion,
        candidate.category,
        `autocomplete from ${candidate.keyword}`
      );
    });
  }

  const nextRows = [...rows, ...newRows];
  const recommendationLines = buildTopRecommendations(nextRows);

  if (!args.dryRun) {
    saveTsv(KEYWORDS_TSV_PATH, header, nextRows, recommendationLines);
  }

  console.log(`Generated ${newRows.length} net-new keyword rows.`);
  console.log(`keywords.tsv total rows: ${nextRows.length}`);
  console.log(
    args.offline
      ? 'Autocomplete was skipped (--offline).'
      : `Autocomplete failures: ${autocompleteFailures}`
  );

  if (newRows.length > 0) {
    console.log('\nSample rows:');
    newRows.slice(0, 10).forEach((row) => {
      console.log(
        `- ${row.keyword} | relevance=${row.relevance} | competition=${row.competition} | volume=${row.volume} | category=${row.category}`
      );
    });
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
