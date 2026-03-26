# YouTube Outreach SOP For PaySplit

## 🎯 Goal
Find YouTube videos where a transparent, helpful mention of PaySplit fits naturally. Prioritize the highest-intent opportunities and track performance metrics consistently.

## 🧠 Core Principles
Treat YouTube outreach like **lead qualification**, not mass commenting. The best opportunities have:
- Active intent around bill splitting, roommate costs, travel, or shared spending.
- An audience whose problem PaySplit actually solves.
- Enough freshness that comments are still highly visible.
- A creator/comment culture where transparent product mentions will not feel spammy.

**Behavioral and etiquette content is often a better surface than competitor comparisons.** Viewers searching "how to avoid money fights on a trip" are mid-problem — they haven't reached the "find an app" stage yet, so a helpful product mention lands more naturally and with less skepticism than it would on an app-comparison video. Viewers searching "Splitwise alternative" are already in comparison mode and are evaluating multiple options; they're worth targeting but are a smaller, more competitive audience.

Do not over-focus on direct `Splitwise alternative` searches. The best opportunities will come from adjacent audience pockets where shared-expense pain shows up naturally:
- roommate and shared-house videos
- moving-to-a-new-city and city-living content
- hostel, college, and student-budget content
- trip-planning and group-travel videos
- digital nomad or long-stay travel budgeting videos
- **money etiquette, conflict-avoidance, and shared-cost behavior advice videos** ← highest-value adjacency

---

## 🛠️ Automated Sourcing Workflow

Use automation for the first pass, then manually qualify edge cases the scraper will miss.

### 1. Run the Scraper Script
Run the script to fetch recent videos, score them, and build drafted comments.
`node marketing/youtube/youtube-marketing-scrape.js`

The scraper expects `YOUTUBE_API_KEY` to be available in `.env.development` at the project root.
Keep search strategy in `marketing/youtube/youtube-queries.json`. Do not hard-code evolving keyword lists into the scraper itself.

Treat this as the default sourcing pass, not the only sourcing path. After the automated run, manually look for older high-intent videos that may still be worth commenting on, especially:
- Splitwise alternative videos
- app comparison or review videos
- evergreen roommate or travel-expense videos with visible recent comments

Search across multiple source buckets, not just app-intent keywords:
- **behavioral & etiquette:** `how to handle money with roommates`, `asking roommates for money`, `roommate not paying their share`, `how to avoid money fights on a trip`, `group trip who pays for what`, `splitting costs on vacation`, `money etiquette with roommates`, `how to talk about bills with roommates`, `group trip etiquette money`
- **direct tool intent:** `Splitwise alternative`, `split bills app`, `expense sharing app`
- **roommate and household life:** `split rent with roommates`, `utilities with roommates`, `shared house expenses`
- **city and move-in content:** `moving to a new city roommates`, `moving in with roommates checklist`, `city life budget`
- **hostel and student living:** `hostel expenses`, `college hostel budget`, `student budget with roommates`
- **travel groups:** `group trip budget`, `friends trip expenses`, `travel budget with friends`
- **digital nomad and extended-stay travel:** `digital nomad budget`, `shared travel costs`

### 2. Auto-Learned Keywords
When the script runs, it performs natural language processing (N-gram analysis) on the titles of high-fit videos and proposes candidate phrases for future searches.

Do not blindly keep every generated phrase. Review new candidates before relying on them in future runs:
- keep phrases that map to a real PaySplit use case
- reject phrases that are broad, generic, or off-topic
- note which new phrases produced strong results versus noise
- prefer phrases that expose a live audience context, not just direct competitor comparison

### 3. Manual Qualification & Review
Open `marketing/youtube/youtube-marketing-posts.csv`. The script has done the heavy lifting, but human intuition is required to post the final comment:
- **Is this a competitor's own channel or promo video?** If yes → mark `competitor_promo` and skip.
- Check the drafted comment. Does it make sense in context?
- Is the comment section culturally safe for a product plug? (If not, lower the `promo_safety_score`).
- Check that comments are enabled and that recent comments are still coming in.
- Check whether links or product mentions already appear in the thread and how they are received.
- Check that the drafted comment reacts to the actual video, not just the search query.
- **Keep if:** The audience is actively asking about managing spending, or it's a direct app review.
- **Reject if:** Pushing the app feels forced or spammy. Do not delete the row. Mark it with a status like `rejected`, `too_old`, `comments_off`, `forced_fit`, `competitor_promo`, or `false_positive` so weekly review still captures what produced noise.

---

## ⚖️ Prioritization & Scoring

### Priority Tiers
1. **Pain-Point Behavioral:** Money etiquette with roommates, avoiding money fights on trips, who pays for what — audiences mid-problem and most receptive to a natural tool mention.
2. **Explicit App Intent:** App reviews, Splitwise alternatives, app comparisons — high intent but more competitive and skeptical.
3. **Situational Context:** Moving to a new city, shared-living advice, group travel planning, student/hostel living, digital nomad budgeting.
4. **Broad Lifestyle:** General adulting, budgeting, or moving-in advice.

### Scoring Model (1-5 per dimension)
Score each qualified video out of 25:
- `intent_score`: How clearly they want a tool recommendation.
- `fit_score`: How closely the topic matches PaySplit features.
- `freshness_score`: Upload age (≤30 days = 5, ≤60 days = 4, ≤90 days = 3).
- `promo_safety_score`: Safe environment for transparent promotion.
- `android_score`: Likelihood an Android Play Store link is useful.

**Total Score = Intent + Fit + Freshness + Promo Safety + Android**
- `High Priority`: 20-25
- `Medium Priority`: 14-19
- `Low Priority`: < 14

Execution rule:
- Review `high` priority videos first.
- Review `medium` priority videos when they are fresh or unusually strong on intent.
- Skip `low` priority videos unless they are direct Splitwise-alternative or app-comparison opportunities.

---

## 💬 Engagement Strategy

### The Comment Formula
1. **The Hook:** One sentence reacting specifically to the video's actual topic — not the search query.
2. **The Disclosure:** Transparently mention you are the creator, but vary the phrasing so it feels natural and not copy-pasted (e.g., "I actually built PaySplit for this exact problem", "I'm working on an app called PaySplit", "Developer of PaySplit here").
3. **The Pitch:** One sentence connecting PaySplit to their exact use case, including the Android link.

### Behavioral vs. App-Intent Comments
The hook and pitch differ depending on the video type:

**App-intent video** (Splitwise comparison, bill-splitting app review):
> "Great breakdown of these two. Full disclosure: I'm building PaySplit — a free Android app for the same use case with equal, exact, and percentage splits. Happy to hear what you'd actually want in an alternative: [link]"

**Behavioral/etiquette video** (money fights, roommate etiquette, group trip costs):
> "The 'I'll pay you back later' loop is exactly why tracking feels so awkward — no one wants to be the person who keeps score. Full disclosure: I built PaySplit so the whole group can see the balance without anyone having to ask. Might be worth a look if anyone in your situation is on Android: [link]"

For behavioral videos: skip feature-listing. Connect to the social friction, not the app's specs.

### Posting Rules & Account Quality
- **Pacing:** Comment lightly and consistently. Aim for a few high-quality comments daily. Do not paste the same wording across videos.
- **Tone:** Keep it short, native to YouTube, and mention only relevant features (e.g., equal splits, percentages, balances). Invite feedback instead of pushing hard for installs.
- **Account Authenticity:** Engage like a genuine, helpful builder account. Stay transparent about affiliation, mix in genuine engagement without links, and avoid anything that reads like a disguised user testimonial. If a creator deletes a comment, do not argue. If someone asks a question, answer it fully before posting elsewhere.

### Creator Outreach vs. Comments
- **Choose Creator Outreach when:** The creator covers finance/budgeting regularly, the audience aligns well but comments would look noisy, and the creator is small enough to plausibly respond.
- **Choose Comments when:** The audience is discussing tools or sharing a relatable situation, the video is recent, and the comment adds value even without a click.

---

## 📊 Tracking & Review

### The Tracking System
Use `marketing/youtube/youtube-marketing-posts.csv` to log activity. Ensure each row is unique by `video_url`.

**CSV columns (in order):**
`channel_name`, `video_title`, `video_url`, `upload_date`, `priority`, `intent_score`, `fit_score`, `freshness_score`, `promo_safety_score`, `android_score`, `total_score`, `status`, `why_it_fits`, `suggested_comment`, `notes`

**Valid `status` values:** `not_commented`, `commented`, `rejected`, `too_old`, `comments_off`, `forced_fit`, `competitor_promo`, `false_positive`

### Weekly Success Review
Evaluate the campaign weekly:
- Which channels/categories tolerate transparent founder comments?
- Which video topics lead to actual conversations and installs?
- Which comment styles perform best — app-intent hooks vs. behavioral hooks?
- Which keywords surface high-intent videos vs. noise?
*(End of week routine: Adjust video selection criteria based on these findings.)*
