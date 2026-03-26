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

Use multiple search buckets, not just app-intent keywords. Keep the active list in [`marketing/youtube/youtube-queries.json`](marketing/youtube/youtube-queries.json) — do not hard-code evolving search strategy into the scraper.

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

### 1. Run the scraper

```bash
node marketing/youtube/youtube-marketing-scrape.js
```

Requirements:
- `YOUTUBE_API_KEY` must be set in `.env.development` at the project root
- search terms must exist in `marketing/youtube/youtube-queries.json`

The scraper fetches the top 5 most relevant videos per query published in the last 90 days, scores them, and appends new rows to `marketing/youtube/youtube-marketing-posts.csv`. It skips URLs already in the sheet.

Use this as the default first pass, not the only pass.

### 2. Add manual sourcing

After the scraper run, manually look for videos the automated pass may miss:
- older but still active videos with recent comments (especially evergreen Splitwise-alternative or roommate content)
- strong behavioral or etiquette videos where the title is broad but the comment section shows real shared-expense pain
- app comparison or review videos from the past year that still have active threads

### 3. Review auto-learned keywords

After each run, the scraper performs N-gram analysis on surfaced video titles and appends candidate phrases to `youtube-queries.json`. These are starting points, not final decisions.

Review new entries before the next run:
- Keep phrases that map to a real PaySplit use case or describe an audience in a shared-expense situation.
- Remove phrases that are too generic, off-topic, or heavily overlap with existing queries.
- Prefer phrases that describe a situation or behavior ("roommate won't pay rent") over pure competitor names.
- Note which new phrases consistently surface good leads versus noise, and prune accordingly.

### 4. Review candidate rows

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
| `promo_safety_score` | How safe the comment section is for a transparent product mention |
| `android_score` | Likelihood that an Android Play Store link is relevant to the audience |

Freshness guidelines:
- `5` — uploaded within 30 days
- `4` — uploaded within 60 days
- `3` — uploaded within 90 days

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

1. **React to the actual video** — one sentence of useful observation or acknowledgment of the specific pain the video covers. Not the search query. The video.
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

Use [`marketing/youtube/youtube-marketing-posts.csv`](marketing/youtube/youtube-marketing-posts.csv) as the system of record. Every sourced video — posted or not — should have a row.

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

Valid status values: `not_commented`, `commented`, `rejected`, `too_old`, `comments_off`, `forced_fit`, `competitor_promo`, `false_positive`

### Rules
- Each row must be unique by `video_url`.
- Never delete rejected rows — they are data on what keywords and queries produce noise.
- Use `notes` to record why something was skipped, so the weekly review can surface patterns.

---

## Weekly Review

Review performance once a week:
- Which channels or video categories tolerate transparent founder comments?
- Which video topics lead to replies, installs, or useful feedback?
- Which hook style performs better — behavioral or app-intent?
- Which keywords consistently surface good candidates, and which ones mostly generate noise or competitor promos?

Update [`marketing/youtube/youtube-queries.json`](marketing/youtube/youtube-queries.json) based on what you learn — not the scraper source code. Prune as well as add: a tighter, higher-signal list produces better candidates than a long one.
