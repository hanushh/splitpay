# YouTube Outreach SOP For PaySplit

## Goal

Find YouTube videos where a transparent, helpful mention of PaySplit fits naturally, prioritize the best opportunities, and track what actually performs.

## Core Principle

Treat YouTube outreach like lead qualification, not mass commenting. The best opportunities have:
- a real shared-expense problem the audience is already feeling
- an audience PaySplit actually helps
- enough freshness that comments can still be seen
- a comment culture where transparent founder participation will not feel spammy

**Do not over-focus on `Splitwise alternative` searches.** Those are useful but they are only one lane, and the audience is already in comparison mode — they are evaluating multiple tools and may be skeptical of founder comments. Behavioral and etiquette videos are often a better surface: the audience is mid-problem and has not yet reached the "find an app" stage, so a helpful mention lands more naturally.

The best behavioral targets describe shared-expense friction in social terms:
- how to talk about bills with roommates
- how to avoid money fights on a trip
- what to do when a roommate is not paying their share
- who pays for what during a group trip

These viewers are not shopping for software yet. A comment that says "I built something for exactly this" reads as a useful discovery, not a pitch.

---

## Search Buckets

Use multiple search buckets, not just app-intent keywords. Keep the main family structure in [`marketing/youtube/youtube-query-families.json`](/Users/hnair/Documents/Projects/splitwise/marketing/youtube/youtube-query-families.json). Use [`marketing/youtube/youtube-queries.json`](/Users/hnair/Documents/Projects/splitwise/marketing/youtube/youtube-queries.json) only for manual override queries or short-lived experiments — not as the main brain of the system.

### 1. Behavioral and etiquette ← highest-value adjacency
- `how to handle money with roommates`
- `asking roommates for money`
- `roommate not paying their share`
- `how to talk about bills with roommates`
- `how to avoid money fights on a trip`
- `group trip who pays for what`
- `splitting costs on vacation`
- `how to split money with friends without awkwardness`
- `how to not be the one who tracks money`
- `friends trip money issues`

### 2. Direct tool intent
- `Splitwise alternative`
- `free splitwise alternative`
- `split bills app`
- `expense sharing app`
- `bill splitting app review`

### 3. Roommate and household life
- `split rent with roommates`
- `utilities with roommates`
- `shared house expenses`
- `roommate budget tips`
- `how we split bills at home`

### 4. City, move-in, hostel, and student living
- `moving to a new city roommates`
- `moving in with roommates checklist`
- `hostel expenses with friends`
- `college hostel budget`
- `student budget with roommates`
- `city life roommate expenses`

### 5. Travel groups and long-stay travel
- `group trip budget`
- `friends trip expenses`
- `travel etiquette with friends money`
- `digital nomad travel budget`
- `travel expense sharing`

---

## Workflow

### 1. Run the keyword researcher (optional, before scraper)

```bash
node marketing/youtube/youtube-keyword-researcher.js
```

The researcher discovers new search query candidates at **zero quota cost** using YouTube's public autocomplete endpoint. It scores each candidate with Claude Haiku and auto-promotes any query scoring ≥ 4/5 into `youtube-queries.json`. Run this before the scraper when you want to refresh the keyword pool. Use `--dry-run` to preview promotions without writing.

Scoring rubric Claude uses:
- `5` — almost certainly about shared-expense friction (roommates, group trips, friends owing money)
- `4` — likely surfaces videos about money tension with others
- `3` — mixed signal
- `2` — probably off-topic (solo finance, general budgeting)
- `1` — clearly unrelated

### 2. Run the scraper

```bash
node marketing/youtube/youtube-marketing-scrape.js
```

Then run:

```bash
node marketing/youtube/youtube-comment-drafter.js
```

Requirements:
- `YOUTUBE_API_KEY` must be set in `.env.development` at the project root
- query families must exist in [`marketing/youtube/youtube-query-families.json`](/Users/hnair/Documents/Projects/splitwise/marketing/youtube/youtube-query-families.json)
- optional manual overrides may exist in [`marketing/youtube/youtube-queries.json`](/Users/hnair/Documents/Projects/splitwise/marketing/youtube/youtube-queries.json)

The scraper rotates through a small set of prioritized query families each run instead of replaying the full keyword list daily. It fetches the top 5 most relevant videos per selected query published in the last 90 days, scores them, and appends new rows to [`marketing/youtube/youtube-marketing-posts.csv`](/Users/hnair/Documents/Projects/splitwise/marketing/youtube/youtube-marketing-posts.csv). It skips URLs already in the sheet.

**Quota management:** Each `search.list` call costs 100 units; each `videos.list` batch costs 1 unit. The scraper runs at most 5 queries per run (`MAX_QUERIES_PER_RUN = 5`) and enforces a daily budget of `DAILY_QUOTA_BUDGET = 8000` units (leaving a 2,000-unit buffer below the 10,000/day limit). Budget usage is persisted in `youtube-query-state.json` under `__quota__` and resets automatically at the start of each new calendar day. If the budget is reached mid-run, the scraper saves state and exits cleanly so the next run continues where it left off.

### 2. Generate and review AI-drafted comments

After the scraper finishes, run `node marketing/youtube/youtube-comment-drafter.js`. The drafter reads `marketing/youtube/youtube-marketing-posts.csv` and fills `suggested_comment` for rows that still have an empty comment cell.

For each row the drafter:
1. Fetches the full video transcript from YouTube's timedtext API (not part of the official API, no quota cost)
2. Sends it to Claude Haiku with a structured prompt to write a 3-sentence comment
3. Falls back to a template-based comment if no transcript is available or the AI call fails

The AI generates comments in the video's detected language automatically (Hindi, Tamil, Telugu, etc. are handled). You do not need to localize manually.

Use the generated draft as the starting point, not the final version. Review each draft to confirm it:
1. Opens with a specific reference to something the speaker actually said — not the title, not a generic hook
2. Discloses that you are building PaySplit — the phrasing is varied automatically but adjust if it sounds off
3. Connects PaySplit to the exact pain in the video and includes the Play Store link: `https://play.google.com/store/apps/details?id=com.hanushh.paysplit`

Keep it to 3 sentences. No emoji. Transparent and helpful — never pose as a regular user. Invite honest feedback rather than pushing hard for installs.

To regenerate all drafts (e.g. after prompt changes): `node marketing/youtube/youtube-comment-drafter.js --overwrite`

Save the updated CSV when done.

### 3. Add manual sourcing

After the scraper run, also manually look for videos it may have missed:
- older but still active videos with recent comments
- strong behavioral or etiquette videos where the title is broad but the comments show real shared-expense pain
- app comparison or review videos from the past year that still have active threads

### 4. Review auto-learned keywords

After each run, the scraper may append candidate phrases to [`marketing/youtube/youtube-queries.json`](/Users/hnair/Documents/Projects/splitwise/marketing/youtube/youtube-queries.json). Review these before the next run:
- Keep phrases that map to a real PaySplit use case or describe an audience in a shared-expense situation.
- Remove phrases that are too generic, off-topic, or overlap heavily with existing queries.
- Prefer phrases that describe a situation or behavior over pure competitor names.

### 5. Review candidate rows

Open [`marketing/youtube/youtube-marketing-posts.csv`](marketing/youtube/youtube-marketing-posts.csv) and review each unreviewed candidate.

Keep a row only if the video is a real fit and a comment would be useful even without a click.

Checklist before posting:
- **Is this a competitor's own channel or promo video?** If yes, mark `competitor_promo` and skip. Commenting on a competitor's promo is unlikely to survive moderation and looks bad.
- Are comments enabled?
- Is there still recent comment activity, or has the thread gone cold?
- Are product mentions or links already present, and how are they received by the community?
- Does the drafted comment react to the actual video topic, not just the search query that surfaced it?
- Would a transparent mention feel helpful here, or would it feel forced and spammy?

Reject poor fits by status. Do not delete rows — rejected rows are data on which keywords produce noise.

Valid reject statuses:
- `rejected` — poor fit or wrong audience
- `too_old` — thread has gone cold
- `comments_off` — comments disabled
- `forced_fit` — app mention would feel spammy
- `competitor_promo` — competitor's own promotional video
- `false_positive` — keyword matched but topic is unrelated

---

## Prioritization

### Priority tiers

1. **Behavioral pain videos** — audience is mid-problem; a helpful mention lands as discovery, not a pitch
   - money etiquette with roommates
   - awkward repayment situations
   - group-trip money friction
   - conflict avoidance around shared costs

2. **Explicit app-intent videos** — high intent, but audience is already in comparison mode
   - Splitwise alternatives
   - app reviews and comparisons
   - expense-sharing app recommendations

3. **Situational context videos** — audience has the PaySplit problem but is not yet thinking about tools
   - moving in with roommates
   - student or hostel budgeting
   - group travel planning
   - digital nomad shared-cost situations

4. **Broad lifestyle videos** — weakest signal; only worth targeting if the comment section is active and the fit is clear
   - general budgeting
   - moving-out or adulting advice

### Scoring model

Score each qualified video from 1 to 5 on each dimension:

| Dimension | What it measures |
|---|---|
| `intent_score` | How clearly the audience wants a tool recommendation |
| `fit_score` | How closely the topic matches what PaySplit actually does |
| `freshness_score` | How recent the upload is |
| `promo_safety_score` | How active the comment section is (computed from real `commentCount` via `videos.list`) |
| `android_score` | Likelihood that an Android Play Store link is relevant to the audience (default 4) |

Freshness guidelines:
- `5` — uploaded within 30 days
- `4` — uploaded within 60 days
- `3` — uploaded within 90 days

`promo_safety_score` is computed automatically from the video's real comment count:
- `5` — 100+ comments (active thread)
- `4` — 20–99 comments
- `3` — 5–19 comments
- `2` — 1–4 comments
- `1` — 0 comments (dead thread — skip)

Total score thresholds:
- `high` — 20–25
- `medium` — 14–19
- `low` — below 14

Execution rule:
- Review `high` first.
- Review `medium` when freshness or behavioral fit is strong.
- Skip `low` unless it is an unusually strong app-intent or behavioral-fit opportunity.

---

## Comment Strategy

### The formula

Every comment should do three things in this order:

1. **React to the actual video** — one sentence of useful observation or thought based on what the speaker actually says in the transcript. Not the search query. The video.
2. **Disclose affiliation** — vary the phrasing so it does not feel copy-pasted. Examples: "Full disclosure: I'm building PaySplit for this exact use case", "I actually built an app called PaySplit after running into this problem", "Developer of PaySplit here".
3. **Connect to the use case** — one sentence linking PaySplit to their specific situation, with the Android link.

Keep it short. Three sentences is the target. YouTube is not a blog.

### By video type

**Behavioral or etiquette videos:**

Focus on the social friction, not the feature list. The viewer is not looking for an app; they are looking for relief from an awkward situation. The comment should validate the frustration first, then offer the tool as a way to remove the awkwardness.

> "The 'I'll pay you back later' loop is exactly what makes this so awkward — no one wants to be the person keeping score out loud. Full disclosure: I built PaySplit so the whole group can see the balance without anyone having to ask. Might be worth a look if anyone in your situation is on Android: [link]"

Do not lead with features like "equal splits, percentage splits, and settle-ups." Lead with the emotional relief.

**App-intent videos (comparisons, reviews, alternatives):**

Acknowledge the comparison or review genuinely. Mention only the one or two PaySplit strengths most relevant to what the video actually covers. Invite honest feedback instead of hard-selling — these viewers are already skeptical.

> "Really useful breakdown of these two. Full disclosure: I'm building PaySplit — free, Android, no transaction cap. Happy to hear what would actually make you switch from Splitwise if you're evaluating options: [link]"

### Creator outreach vs. comments

Choose **creator outreach** when:
- The creator covers finance, budgeting, or shared-living regularly
- The audience aligns strongly but a comment would look noisy or promotional in that thread
- The channel is small enough that a DM has a realistic chance of a response

Choose **comments** when:
- The audience is actively discussing tools or venting about a shared-expense situation
- The video is recent and the thread is still live
- The comment adds genuine value even if nobody clicks the link

---

## Posting Rules

- **Stay transparent** — always disclose that you are the builder. Never pose as a satisfied user.
- **Keep it short** — native YouTube comments are concise. A three-sentence comment performs better than a paragraph.
- **Do not repeat the same wording** — vary hooks and phrasing across videos. Identical comments across threads look automated.
- **Mix in non-promotional engagement** — occasionally reply to comments, answer questions, or engage without linking anything. An account that only posts PaySplit links will be treated as spam.
- **If a creator deletes a comment**, do not argue or repost. Move on.
- **If someone replies with a question**, answer it fully before posting elsewhere that day.

---

## Tracking

Use [`marketing/youtube/youtube-marketing-posts.csv`](/Users/hnair/Documents/Projects/splitwise/marketing/youtube/youtube-marketing-posts.csv) as the system of record. Every sourced video — posted or not — should have a row.

### CSV columns

| Column | Description |
|---|---|
| `channel_name` | YouTube channel name |
| `video_title` | Video title |
| `video_url` | Full YouTube URL (unique key) |
| `upload_date` | Published date (YYYY-MM-DD) |
| `priority` | `high`, `medium`, or `low` |
| `intent_score` | 1–5 |
| `fit_score` | 1–5 |
| `freshness_score` | 1–5 |
| `promo_safety_score` | 1–5 |
| `android_score` | 1–5 |
| `total_score` | Sum of the five scores |
| `status` | Current state (see below) |
| `why_it_fits` | Why this video was selected |
| `suggested_comment` | Draft comment ready for review and editing |
| `notes` | Manual observations or reasons for rejection |
| `comment_result` | Outcome after posting: `reply`, `no_reply`, `deleted`, `click_reported` (fill manually) |

Valid status values: `not_commented`, `commented`, `rejected`, `too_old`, `comments_off`, `forced_fit`, `competitor_promo`, `false_positive`

### Rules
- Each row must be unique by `video_url`.
- Never delete rejected rows — they are data on what keywords and queries produce noise.
- Use `notes` to record why something was skipped, so the weekly review can surface patterns.

---

## Weekly Review

Review performance once a week:
- Update `comment_result` for any posted comments (check for replies, deletions, or reported clicks).
- Which channels or video categories tolerate transparent founder comments?
- Which video topics lead to replies, installs, or useful feedback?
- Which hook style performs better — behavioral or app-intent?
- Which keywords consistently surface good candidates, and which ones mostly generate noise or competitor promos?

Update [`marketing/youtube/youtube-queries.json`](marketing/youtube/youtube-queries.json) based on what you learn — not the scraper source code. Prune as well as add: a tighter, higher-signal list produces better candidates than a long one.
