# CLAUDE.md – Marketing Folder Guide

This file provides context for AI assistants working in the `marketing/` directory.

---

## Purpose

The `marketing/` folder contains outreach tooling and tracking data for promoting **PaySplit** on Reddit and YouTube. The goal is transparent, helpful founder outreach — not mass posting.

---

## Folder Structure

```
marketing/
├── reddit/
│   ├── reddit-outreach-plan.md         # Strategy, scoring model, comment rules
│   ├── reddit-marketing-review.js      # CLI: review drafted replies one by one
│   └── reddit-marketing-posts.csv      # Tracking sheet (one row per Reddit thread)
└── youtube/
    ├── youtube-outreach-plan.md        # Strategy, scoring model, comment rules
    ├── youtube-marketing-scrape.js     # CLI: fetch new videos via YouTube Data API
    ├── youtube-marketing-review.js     # CLI: review drafted comments one by one
    ├── youtube-marketing-posts.csv     # Tracking sheet (one row per YouTube video)
    └── youtube-queries.json            # Active search queries (edit here, not in scraper)
```

---

## Scripts

### Reddit

```bash
# Review unreviewed high-priority threads, open in browser, copy reply to clipboard
node marketing/reddit/reddit-marketing-review.js --priority high

# Dry run (no browser, no clipboard, no CSV writes)
node marketing/reddit/reddit-marketing-review.js --dry-run

# Include already-reviewed rows
node marketing/reddit/reddit-marketing-review.js --include-reviewed

# Jump to a specific row
node marketing/reddit/reddit-marketing-review.js --index 3
```

### YouTube

```bash
# Fetch new videos from the YouTube Data API and append to CSV
# Requires YOUTUBE_API_KEY in .env.development at the project root
node marketing/youtube/youtube-marketing-scrape.js

# Review unreviewed entries, open in browser, copy comment to clipboard
node marketing/youtube/youtube-marketing-review.js --priority high

# Dry run
node marketing/youtube/youtube-marketing-review.js --dry-run

# Include already-reviewed rows
node marketing/youtube/youtube-marketing-review.js --include-reviewed

# Jump to a specific row
node marketing/youtube/youtube-marketing-review.js --index 2
```

---

## Environment Variables

| Variable          | Where                | Used by                          |
| ----------------- | -------------------- | -------------------------------- |
| `YOUTUBE_API_KEY` | `.env.development`   | `youtube-marketing-scrape.js`    |

---

## CSV Schemas

### `reddit-marketing-posts.csv`

| Column            | Description                                      |
| ----------------- | ------------------------------------------------ |
| `subreddit`       | e.g. `r/personalfinance`                         |
| `post_title`      | Title of the Reddit thread                       |
| `post_url`        | Full URL — **unique key**, no duplicates allowed |
| `post_date`       | Published date (YYYY-MM-DD)                      |
| `priority`        | `high`, `medium`, or `low`                       |
| `why_it_fits`     | Why this thread was selected                     |
| `suggested_reply` | Draft reply ready for editing and posting        |
| `notes`           | Manual observations or rejection reasons         |
| `reviewed`        | `yes` once the review script processes the row   |
| `reviewed_at`     | ISO timestamp set automatically on review        |

Uniqueness rule: each row must be unique by `post_url`. Do not delete rejected rows.

Recommended additional columns (add when ready):
`intent_score`, `fit_score`, `freshness_score`, `promo_safety_score`, `android_score`, `total_score`, `status`, `posted_at`, `response_count`, `upvotes_after_24h`, `notes_after_post`, `keyword_source`, `keyword_tested`, `keyword_result`

### `youtube-marketing-posts.csv`

| Column             | Description                                       |
| ------------------ | ------------------------------------------------- |
| `channel_name`     | YouTube channel name                              |
| `video_title`      | Video title                                       |
| `video_url`        | Full YouTube URL — **unique key**                 |
| `upload_date`      | Published date (YYYY-MM-DD)                       |
| `priority`         | `high`, `medium`, or `low`                        |
| `intent_score`     | 1–5                                               |
| `fit_score`        | 1–5                                               |
| `freshness_score`  | 1–5                                               |
| `promo_safety_score` | 1–5                                             |
| `android_score`    | 1–5                                               |
| `total_score`      | Sum of the five scores                            |
| `status`           | `not_commented`, `commented`, or a reject status  |
| `why_it_fits`      | Why selected; includes transcript excerpt if any  |
| `suggested_comment`| Draft comment — filled in by AI at review time   |
| `notes`            | Detected language, manual observations            |
| `reviewed`         | `yes` once the review script processes the row    |
| `reviewed_at`      | ISO timestamp set automatically on review         |

Valid reject statuses: `rejected`, `too_old`, `comments_off`, `forced_fit`, `competitor_promo`, `false_positive`

Uniqueness rule: each row must be unique by `video_url`. Do not delete rejected rows.

---

## Scoring Model

Both channels use the same five-dimension scoring model (1–5 each):

| Dimension            | What it measures                                          |
| -------------------- | --------------------------------------------------------- |
| `intent_score`       | How clearly the audience wants a tool recommendation      |
| `fit_score`          | How closely the topic matches what PaySplit actually does |
| `freshness_score`    | How recent the content is                                 |
| `promo_safety_score` | How safe a transparent product mention feels here         |
| `android_score`      | How likely the audience would benefit from the Play Store link |

Priority thresholds:
- `high` — total 20–25
- `medium` — total 14–19
- `low` — total below 14

---

## Comment / Reply Strategy

Every comment or reply must:

1. **Respond to the actual content** — one useful sentence referencing the specific problem covered.
2. **Disclose affiliation** — always. Never pose as a regular user. Vary phrasing naturally.
3. **Connect PaySplit to the use case** — one sentence with the Android Play Store link.

Keep it short (3 sentences target). Match the tone of the platform and community.

Android Play Store link: `https://play.google.com/store/apps/details?id=com.hanushh.paysplit`

---

## Search Query Management (YouTube)

Edit `marketing/youtube/youtube-queries.json` to add, remove, or refine search queries. Do **not** hard-code search terms in `youtube-marketing-scrape.js`.

After each scraper run, the script auto-appends candidate n-gram phrases to `youtube-queries.json`. Review them before the next run:
- Keep phrases that describe a real shared-expense situation or audience.
- Remove phrases that are too broad, off-topic, or overlap heavily with existing queries.

---

## Key Rules

- **Transparency first** — always disclose being the builder. Never impersonate a regular user.
- **Quality over volume** — a few well-chosen posts beat mass commenting.
- **Never delete CSV rows** — rejected and skipped rows are signal for keyword and strategy review.
- **Uniqueness enforced** — both review scripts assert uniqueness by URL at startup and will exit with an error if duplicates exist.
- **No auto-posting** — neither script submits anything. Posting is always a manual decision.
- **YOUTUBE_API_KEY** must exist in `.env.development` before running the scraper.
