# YouTube Outreach SOP For PaySplit

## 🎯 Goal
Find YouTube videos where a transparent, helpful mention of PaySplit fits naturally. Prioritize the highest-intent opportunities and track performance metrics consistently.

## 🧠 Core Principles
Treat YouTube outreach like **lead qualification**, not mass commenting. The best opportunities have:
- Active intent around bill splitting, roommate costs, travel, or shared spending.
- An audience whose problem PaySplit actually solves.
- Enough freshness that comments are still highly visible.
- A creator/comment culture where transparent product mentions will not feel spammy.

---

## 🛠️ Automated Sourcing Workflow

Your lead generation is fully automated! Instead of manually searching YouTube, trigger the data pipeline:

### 1. Run the Scraper Script
Run the script to automatically fetch videos from the last 90 days, score them, and build drafted comments.
`YOUTUBE_API_KEY="your_key" node marketing/youtube-marketing-scrape.js`

### 2. Auto-Learned Keywords
When the script runs, it performs natural language processing (N-gram analysis) on the titles of high-fit videos. It grabs the top new phrases it discovers and automatically appends them to `youtube-queries.json` so you are constantly exploring new user-generated vocabulary.

### 3. Manual Qualification & Review
Open `youtube-marketing-posts.csv`. The script has done the heavy lifting, but human intuition is required to post the final comment:
- Check the drafted comment. Does it make sense in context?
- Is the comment section culturally safe for a product plug? (If not, lower the `promo_safety_score`).
- **Keep if:** The audience is actively asking about managing spending, or it's a direct app review.
- **Reject if:** Pushing the app feels forced or spammy. Delete the row or leave it un-commented.

---

## ⚖️ Prioritization & Scoring

### Priority Tiers
1. **Explicit Intent:** App reviews, Splitwise alternatives, app recommendations.
2. **Pain-Point Videos:** Roommate routines, uneven rent splits, travel budgeting.
3. **Broad Lifestyle:** General adulting, budgeting, or moving-in advice.

### Scoring Model (1-5 per dimension)
Score each qualified video out of 25:
- `intent_score`: How clearly they want a tool recommendation.
- `fit_score`: How closely the topic matches PaySplit features.
- `freshness_score`: Upload age (`30-90 days` = High, `3-12 mos` = Med).
- `promo_safety_score`: Safe environment for transparent promotion.
- `android_score`: Likelihood an Android Play Store link is useful.

**Total Score = Intent + Fit + Freshness + Promo Safety + Android**
- `High Priority`: 20-25
- `Medium Priority`: 14-19
- `Low Priority`: < 14

---

## 💬 Engagement Strategy

### The Comment Formula
1. **The Hook:** One sentence reacting specifically to the video's actual topic.
2. **The Disclosure:** Transparently mention you are the creator, but vary the phrasing so it feels natural and not copy-pasted (e.g., "I actually built PaySplit for this exact problem", "I'm working on an app called PaySplit", "Developer of PaySplit here").
3. **The Pitch:** One sentence connecting PaySplit to their exact use case, including the Android link.

### Posting Rules & Account Quality
- **Pacing:** Comment lightly and consistently. Aim for a few high-quality comments daily. Do not paste the same wording across videos.
- **Tone:** Keep it short, native to YouTube, and mention only relevant features (e.g., equal splits, percentages, balances). Invite feedback instead of pushing hard for installs.
- **Account Authenticity:** Act like a real user. Mix in genuine engagement without links. If a creator deletes a comment, do not argue. If someone asks a question, answer it fully before posting elsewhere.

### Creator Outreach vs. Comments
- **Choose Creator Outreach when:** The creator covers finance/budgeting regularly, the audience aligns well but comments would look noisy, and the creator is small enough to plausibly respond.
- **Choose Comments when:** The audience is discussing tools, the video is recent, and the comment adds value even without a click.

---

## 📊 Tracking & Review

### The Tracking System
Use `youtube-marketing-posts.csv` to log activity. Ensure each row is unique by `video_url`.
**Core Fields:** `channel_name`, `video_title`, `video_url`, `upload_date`, `priority`, `why_it_fits`, `status`, `suggested_comment`.
**Metrics & Scoring Fields:** `total_score` (and individual score breakdown), `commented_at`, `response_count`, `likes_after_7d`, `keyword_source`, `keyword_tested`, `creator_outreach_candidate`.

### Weekly Success Review
Evaluate the campaign weekly:
- Which channels/categories tolerate transparent founder comments?
- Which video topics lead to actual conversations and installs?
- Which comment styles perform best?
- Which keywords surface high-intent videos vs. noise?
*(End of week routine: Adjust video selection criteria based on these findings.)*
