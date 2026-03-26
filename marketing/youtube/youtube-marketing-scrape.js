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

const STOP_WORDS = new Set(["a","about","after","again","all","am","an","and","any","are","as","at","be","because","been","before","being","below","between","both","but","by","can","cannot","could","did","do","does","doing","down","during","each","few","for","from","further","had","has","have","having","he","her","here","hers","herself","him","himself","his","how","i","if","in","into","is","it","its","itself","me","more","most","my","myself","no","nor","not","of","off","on","once","only","or","other","our","ours","ourselves","out","over","own","same","she","should","so","some","such","than","that","the","their","theirs","them","themselves","then","there","these","they","this","those","through","to","too","under","until","up","very","was","we","were","what","when","where","which","while","who","whom","why","with","would","you","your","yours","yourself","yourselves","app","video","review","tutorial","guide","best","top"]);

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
    .filter(s => s[1] > 1 && s[0].length > 4)
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

// Get already tracked URLs so we don't duplicate
function getExistingUrls() {
  if (!fs.existsSync(CSV_PATH)) return new Set();
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  // Simple regex extraction for the URL column (assuming it's column 3, but this grabs any youtube link)
  const matches = text.match(/https:\/\/www\.youtube\.com\/watch\?v=[\w-]+/g) || [];
  return new Set(matches);
}

async function fetchYouTube(endpoint, params) {
  params.key = API_KEY;
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    console.error("❌ YouTube API Error Response:", JSON.stringify(data, null, 2));
    throw new Error(`YouTube API Error: ${data.error?.message || res.statusText}`);
  }
  return data;
}

function calculateScore(video, query) {
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
  else freshness = 3; // Max 90 days thanks to our API filter

  const promo_safety = 4; // Default assumption, manual review needed
  const android = 4;      // Default assumption

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

  for (const query of QUERIES) {
    console.log(`\n🔍 Searching: ${query}`);
    try {
      // 1. Search for videos
      const searchData = await fetchYouTube('search', {
        part: 'snippet',
        q: query,
        type: 'video',
        publishedAfter: PUBLISHED_AFTER,
        maxResults: 5, // Top 5 per query to keep quality high
        order: 'relevance'
      });

      if (!searchData.items || searchData.items.length === 0) {
        console.log(`  No recent videos found.`);
        continue;
      }

      for (const item of searchData.items) {
        const videoId = item.id.videoId;
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        if (existingUrls.has(url)) {
          console.log(`  ⏭️  Skipping existing: ${url}`);
          continue;
        }

        const snippet = item.snippet;
        const uploadDate = snippet.publishedAt.split('T')[0];
        const scores = calculateScore(item, query);

        // Save title to mine text for keyword expansion later
        processedTitles.push(snippet.title.replace(/&amp;/g, '&'));

        // Standardized pitch layout matching the SOP
        const hook = `Great video on ${query.replace(/"/g, '')}!`;
        const disclosure = `Full disclosure: I'm building PaySplit.`;
        const pitch = `If you're on Android and want a modern app for tracking shared expenses with equal, exact, and percentage splits, feel free to try it: https://play.google.com/store/apps/details?id=com.hanushh.paysplit`;
        const suggestedComment = `${hook} ${disclosure} ${pitch}`;

        const row = [
          escapeCsvField(snippet.channelTitle),
          escapeCsvField(snippet.title.replace(/&amp;/g, '&')),
          url,
          uploadDate,
          scores.priority,
          scores.intent,
          scores.fit,
          scores.freshness,
          scores.promo_safety,
          scores.android,
          scores.total,
          'not_commented', // status
          escapeCsvField(`Matched keyword search: [${query}]. Explicitly pulled via recent API run.`), // why_it_fits
          escapeCsvField(suggestedComment), // suggested_comment
          escapeCsvField(`Automated API pull.`) // notes
        ];

        newRows.push(row);
        existingUrls.add(url);
        console.log(`  ✅ Added [${scores.priority.toUpperCase()}]: ${snippet.title} (${uploadDate})`);
      }
    } catch (err) {
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

  // Automate the Improvement Loop!
  if (processedTitles.length > 0) {
    const candidateKeywords = getTopPhrases(processedTitles);
    let addedCount = 0;
    
    candidateKeywords.forEach(phrase => {
      // Avoid adding if it's already in the search pool or substring of existing
      if (!QUERIES.some(q => q.toLowerCase().includes(phrase))) {
        QUERIES.push(phrase);
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
