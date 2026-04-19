'use strict';

/**
 * marketing/social/lib/prompts.js
 *
 * Prompt templates for Gemini content generation.
 * Edit this file to tune the LLM's output without touching script logic.
 */

const { DAYS_OF_WEEK } = require('./utils');

// ─── App features ─────────────────────────────────────────────────────────────

/**
 * App features surfaced to the LLM so it can write feature-specific hero text.
 * Add / remove / reword entries here to steer what gets highlighted.
 */
const APP_FEATURES = [
  'Completely free without limitations',
  'Integrated AI assistant for effortless expense management',
  'Instant bill splitting',
  'Real-time group balances',
  'Settle up in one tap',
  'Multi-currency support',
  'Per-person expense tracking',
  'Group invites via link',
  'Activity feed for every group',
  'Custom split amounts',
  'Cross-group friend balances',
  'Offline-first, always in sync',
];

// ─── System prompt ─────────────────────────────────────────────────────────────

/**
 * @param {Array<{ score: number, issues: string, prompt: string }>} recentExamples
 * @returns {string}
 */
function buildSystemPrompt(recentExamples = []) {
  const goodExamples = recentExamples.filter((e) => e.score >= 4);
  const badExamples  = recentExamples.filter((e) => e.score <= 2);

  let examplesBlock = '';
  if (goodExamples.length > 0 || badExamples.length > 0) {
    examplesBlock = '\n\nPast image prompt results — learn from these:\n';
    if (goodExamples.length > 0) {
      examplesBlock += '\nHigh-quality prompts (score 4–5, use as style reference):\n';
      goodExamples.forEach((e) => {
        examplesBlock += `  ✓ [Score ${e.score}] "${e.prompt.slice(0, 120)}"\n`;
      });
    }
    if (badExamples.length > 0) {
      examplesBlock += '\nPoor prompts (score 1–2, avoid these patterns):\n';
      badExamples.forEach((e) => {
        const issues = e.issues ? ` — issues: ${e.issues}` : '';
        examplesBlock += `  ✗ [Score ${e.score}] "${e.prompt.slice(0, 120)}"${issues}\n`;
      });
    }
  }

  const featureList = APP_FEATURES.map((f) => `  • ${f}`).join('\n');

  return `You are a social-media content strategist for PaySplit,
a mobile app that makes splitting bills, group expenses, and shared costs effortless.

Target audience: 18–35-year-olds who travel with friends, share flats, dine out in groups,
or manage any kind of shared expense.

Brand voice: friendly, witty, modern, empowering — never corporate or stuffy.
Brand palette:
  • Background:  deep dark green  #112117
  • Primary CTA: bright green     #17e86b
  • Surface/card: dark green      #1a3324
  • Accent:       orange          #f97316
  • Text:         white           #ffffff

App features — use these to inspire the hero_text when relevant to the post:
${featureList}

Your task is to create a week of Instagram/Facebook marketing posts.
Each post must:
  • Tie into a real, timely news story or trend you found via search
  • Naturally connect the trend to a pain point PaySplit solves
  • Feel native to Instagram — conversational, relatable, a little playful
  • Include a hero_text: a short, punchy headline (max 8 words) that will be
    printed in large bold white text at the top of the image. When the post
    highlights a specific app feature, use that feature as the hero_text theme
    (e.g. "Settle Up in One Tap", "Real-Time Balances"). Otherwise make it
    impactful and relevant to the post topic.
  • Include a vivid image-generation prompt (for an AI image model) that produces
    authentic lifestyle photography — real people, real environments, candid and natural.
    Do NOT include any text, labels, signs, hex codes, or brand overlays in the scene.
    If the prompt includes a phone screen or app UI, describe it as: deep dark green
    background, bright green accent elements, white text — no hex codes.
    Fill the entire frame; the bottom edge will be covered by a graphic overlay so
    keep that area free of important subjects. Describe lighting, mood, and composition clearly.
  • Include a caption (max 2 200 chars) with a clear call-to-action
  • Include 5–10 relevant hashtags${examplesBlock}`;
}

// ─── User prompt ──────────────────────────────────────────────────────────────

/**
 * @param {number}   weekNumber
 * @param {string}   weekStart   YYYY-MM-DD of Monday
 * @param {string[]} dates       Array of 7 YYYY-MM-DD strings (Mon–Sun)
 * @param {number}   postCount
 * @param {string[]} topics
 * @returns {string}
 */
function buildUserPrompt(weekNumber, weekStart, dates, postCount, topics) {
  const topicList = topics.map((t) => `  - ${t}`).join('\n');
  const dayList = DAYS_OF_WEEK.map((d, i) => `  ${d}: ${dates[i]}`).join('\n');

  return `Use Google Search to find the most recent and relevant news stories,
trends, or viral moments related to any of these topics:
${topicList}

Based on what you find, create exactly ${postCount} Instagram/Facebook posts
for Week ${weekNumber} (${weekStart}).

Available days and their dates:
${dayList}

Spread the posts across different days (avoid clustering them all on the same day).
Choose the days that make the most sense given the news angle.

Return ONLY valid JSON — no markdown, no commentary, no code fences.
The JSON must be an array of exactly ${postCount} objects, each with these fields:

{
  "day_of_week":     "Monday",
  "scheduled_date":  "YYYY-MM-DD",
  "hero_text":       "Short punchy headline, max 8 words, printed bold on the image",
  "prompt":          "...",
  "caption":         "...",
  "hashtags":        "#splitbills #...",
  "platforms":       "instagram,facebook",
  "news_hook":       "..."
}`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { DAYS_OF_WEEK, APP_FEATURES, buildSystemPrompt, buildUserPrompt };
