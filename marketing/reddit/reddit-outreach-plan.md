# Reddit Outreach Plan For PaySplit

## Goal

Find Reddit threads where a transparent, helpful mention of PaySplit fits naturally, prioritize the highest-intent opportunities, and track what actually performs.

## Core Principle

Treat Reddit outreach like lead qualification, not mass posting.

The best threads are not just relevant. They have:

- active intent to try a tool
- a problem PaySplit actually solves
- enough freshness that a reply can still be seen
- a subreddit culture where transparent founder participation is acceptable

## Keyword Expansion

Every time this plan is run, do a keyword discovery pass before and after thread collection.

The goal is to keep improving discoverability instead of reusing the same fixed search terms forever.

Before searching:

- start with the current core keyword set
- include direct intent phrases like `Splitwise alternative`, `split bills app`, and `roommate expense tracker`
- include pain-point phrases like `who owes what`, `rent and utilities`, `shared house expenses`, and `paying full bill`

After searching:

- review the titles and wording from the strongest matching threads
- extract repeated user language that was not in the original query set
- note any new nouns, verbs, and problem phrases that show up naturally in real posts
- turn those into 3-10 candidate keywords for the next run

Good places to mine new keywords from:

- titles of high-scoring threads
- repeated phrases in post bodies
- comments where people describe what they dislike about current tools
- feature requests that map to PaySplit use cases
- adjacent wording such as `roommate ledger`, `shared costs`, `trip tab`, `settle up app`, or `expense tracker for friends`

Keep only keywords that meet at least one of these conditions:

- they describe a real user pain point
- they imply app/tool intent
- they map cleanly to PaySplit's actual feature set

Reject keywords that are too broad, too off-topic, or likely to attract the wrong audience.

## Browser Tool Workflow

1. Start each run with a keyword expansion pass:
   - review the current keyword set
   - identify missing phrases from recent relevant threads
   - add a short list of new candidate keywords to test in this run
2. Use `search_query` to find threads by pain-point cluster:
   - `site:reddit.com/r/* "Splitwise" alternative`
   - `site:reddit.com/r/* "split bills" app`
   - `site:reddit.com/r/* roommate split expenses`
   - `site:reddit.com/r/* travel shared expenses app`
   - `site:reddit.com/r/* "how do you split rent" roommates`
   - plus any newly discovered high-signal keywords from the keyword expansion pass
3. Use `open` on promising results to inspect:
   - the original post
   - the age of the thread
   - the tone of existing replies
   - whether product recommendations are already common in the thread
4. Use `find` for checks like:
   - `Archived post`
   - `locked`
   - `removed`
   - `Comment removed by moderator`
5. Keep a thread only if at least one of these is true:
   - The OP explicitly asks for an app, tool, or Splitwise alternative.
   - The OP describes a live shared-expense problem that PaySplit directly helps solve.
   - The discussion is recent enough that posting still has a reasonable chance of engagement.
6. Reject threads that are poor fits:
   - archived or locked threads
   - legal/financial conflict threads where a product mention would feel tone-deaf
   - posts where PaySplit does not clearly solve the actual issue
   - threads where self-promo would likely violate subreddit norms
7. End each run by writing down:
   - which new keywords produced good results
   - which new keywords produced noisy results
   - which new keywords should be kept, refined, or dropped next time

## Prioritization

Prioritize threads in this order:

1. Explicit intent
   - “What app should I use?”
   - “Splitwise alternative?”
   - “How do you track bills with roommates?”
2. Pain-point threads
   - recurring roommate friction
   - uneven rent split
   - shared travel expenses
   - group dinner or trip tracking
3. Broad discussion threads
   - general “how do you split bills?” posts

Use freshness as a multiplier:

- `high freshness`: posted within the last 7-30 days
- `medium freshness`: 1-6 months old
- `low freshness`: older than 6 months unless the thread still has visible activity

## Scoring Model

Score each thread from 1 to 5 across these dimensions:

- `intent_score`: how clearly the OP wants a tool recommendation
- `fit_score`: how closely the problem matches current PaySplit features
- `freshness_score`: how likely the comment is still discoverable and useful
- `promo_safety_score`: how safe transparent promotion feels in that subreddit/thread
- `android_score`: how likely an Android Play Store link is useful for that audience

Then compute a simple total:

- `total_score = intent + fit + freshness + promo_safety + android`

Use the total to classify:

- `high priority`: 20-25
- `medium priority`: 14-19
- `low priority`: 5-13

## Comment Strategy

Each comment should do three things in order:

1. Answer the user's problem.
2. Disclose affiliation.
3. Offer PaySplit as a relevant option.

Best structure:

1. One sentence of useful advice.
2. One sentence that says: `Full disclosure: I'm building PaySplit.`
3. One sentence connecting the product to the exact use case, with the Android link.

Rules for reply quality:

- keep it short
- match the tone of the subreddit
- mention only features that matter to that thread
- do not pretend to be an unrelated user
- invite feedback instead of pushing hard for installs

Relevant feature angles:

- shared expenses
- equal, exact, and percentage splits
- balances
- settle-ups

## Posting Cadence

Post lightly and consistently rather than in bursts.

- Aim for a few high-quality comments per day at most.
- Prefer replying to the original poster over dropping generic top-level comments everywhere.
- Do not post multiple nearly identical comments in the same subreddit on the same day.
- If a thread is weak, skip it instead of forcing a mention.

## Account Quality

Reddit outreach will perform better if the account also contributes non-promotional comments.

- Mix in normal helpful participation.
- Avoid making the account look like it exists only to drop links.
- If someone asks a follow-up question, answer it fully before sharing anything else.

## Thread Buckets

Maintain reply variants for these buckets:

- roommates
- uneven household splits
- travel groups
- group dinners and events
- general Splitwise alternative requests

This keeps replies specific without rewriting from scratch every time.

## Posting Rules

1. Manually check subreddit rules before posting.
2. Stay transparent that you are the builder.
3. Skip threads where the product mention feels forced.
4. Do not argue with moderators or users if a comment is removed.
5. Use the thread context to edit the drafted reply before posting.

## Tracking

Use [`reddit-marketing-posts.csv`](/Users/hnair/Documents/Projects/splitwise/marketing/reddit-marketing-posts.csv) to track:

- subreddit
- title
- URL
- date
- priority
- why the thread fits
- suggested reply
- posting notes

Recommended next tracking fields to add:

- `intent_score`
- `fit_score`
- `freshness_score`
- `promo_safety_score`
- `android_score`
- `total_score`
- `status`
- `posted_at`
- `response_count`
- `upvotes_after_24h`
- `notes_after_post`
- `keyword_source`
- `keyword_tested`
- `keyword_result`

Uniqueness rule:

- each CSV entry must be unique by `post_url`
- if the same Reddit thread appears twice, keep only one row

## Success Review

Review performance every week and look for patterns:

- Which subreddits tolerate transparent founder replies?
- Which pain-point buckets lead to actual conversations?
- Which reply style gets ignored versus answered?
- Which comments produce installs, feedback, or follow-up questions?
- Which keywords consistently surface high-intent threads?
- Which keywords create noise and should be removed?

The goal is to get better at thread selection first, then reply writing second.
