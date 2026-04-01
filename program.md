# autoresearch — PaySplit ASO Keyword Research

This is an autonomous keyword research run for App Store Optimization (ASO) of the PaySplit app.

## Setup

To set up a new research run, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `mar31`). The branch `autoresearch/<tag>` must not already exist — this is a fresh run.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current master.
3. **Read the in-scope files**: Read these files for full context:
   - `program.md` — this file. Research objectives, keyword axes, rules.
   - `app.json` — app name, description, bundle ID, platform metadata.
   - `locales/en.json` — all user-facing feature strings. Use this to derive keyword angles.
4. **Initialize keywords.tsv**: Create `keywords.tsv` with just the header row (see Logging section). The first keyword batch will be recorded after the first search session.
5. **Confirm and go**: Confirm setup looks good.

Once you get confirmation, kick off the research loop.

---

## App Context

**App name**: PaySplit (published as "PaySplit")
**Package ID**: `com.hanushh.paysplit`
**Tagline**: "Settling expenses made simple"
**Category**: Finance / Utilities
**Platforms**: Google Play, Apple App Store, Web PWA
**Target users**: Friends, roommates, travel groups who share expenses

**Key features** (use these to generate keyword angles):
- Group creation and member management
- Add shared expenses with flexible split methods: equal, exact amounts, percentage
- Multi-currency support
- Real-time balance tracking (who owes whom)
- Settle up with payment method tracking (cash, Venmo, PayPal)
- AI assistant — natural language queries like "how much do I owe?"
- Receipt photo capture per expense
- Expense categories: Food & Drink, Transport, Accommodation, Entertainment, Shopping
- Contact integration — match phone contacts to app users
- Export expenses as CSV
- Group invite links
- Activity feed with filters
- Spending analytics by category

**Primary competitors**: Splitwise, Tricount, Settle Up, Spliddit, Honeydue, Tab, Billr

---

## Research Objective

Find high-value keywords for ASO on Google Play and the Apple App Store. For each keyword, estimate:

- **relevance** (1–5): how well PaySplit serves this search intent (5 = perfect fit)
- **competition** (low / medium / high): how many strong apps appear for this term
- **volume** (high / medium / low / niche): estimated monthly search frequency
- **category**: which research axis produced this keyword

**The goal is simple: fill `keywords.tsv` with as many high-quality, unique keyword entries as possible.** Breadth matters. Cover every plausible angle a potential user might search. Depth matters too — score honestly; don't mark everything `relevance=5`.

---

## Keyword Axes to Explore

Systematically work through all six axes. For each axis, explore at least 15 distinct keyword variations before moving on.

**Axis 1 — core_function**: What the app literally does.
Examples: split bill, split bills, bill splitter, expense splitter, shared expenses app, IOU tracker, money tracker, split calculator, group expense tracker

**Axis 2 — use_case**: Real-world scenarios where users need bill splitting.
Examples: trip expense tracker, vacation expense app, roommate expense tracker, shared rent, group dinner split, restaurant bill splitter, house expenses app, event expense split, couple expense tracker

**Axis 3 — competitor**: Terms users search when they know a competitor exists.
Examples: Splitwise alternative, app like Splitwise, free Splitwise, Tricount alternative, Settle Up alternative, better than Splitwise

**Axis 4 — ai_angle**: Terms capturing the AI assistant differentiator.
Examples: AI expense tracker, AI bill splitter, smart expense app, chatbot expense app, voice expense tracker

**Axis 5 — long_tail**: Conversational and question-form searches typed into app store search bars.
Examples: who owes me money app, track who paid what, app to split grocery bill, how to split bills with friends, group expense calculator, fair bill calculator

**Axis 6 — audience**: Terms targeting specific user segments.
Examples: roommates app, college roommate app, travel group expenses, backpacking expense tracker, couples money app, family expense splitter, friend group money app, work trip expenses

---

## Research Method

For each keyword candidate:

1. **Search** the web:
   - Search `"<keyword>" app store` — what comes up? Is Splitwise dominant, or are there gaps?
   - Search `"<keyword>" site:play.google.com` — how saturated is the Play Store for this term?
   - Check Google autocomplete / "People also search for" — note any new keyword variants to queue.
   - Check Google Trends if accessible — is this term trending, stable, or declining?

2. **Score** the keyword:
   - `relevance`: 1 if PaySplit barely fits, 5 if it's a perfect match to PaySplit's feature set
   - `competition`: `low` = weak or few apps rank; `medium` = some competition; `high` = Splitwise/major apps dominate
   - `volume`: `high` = broad everyday search; `medium` = regular but narrower; `low` = occasional; `niche` = very specific

3. **Log** a row to `keywords.tsv` immediately after scoring.

4. **Branch**: Any new keyword variants discovered (from autocomplete, related searches, competitor descriptions) go into the exploration queue. These count toward the 100-entry target.

---

## Output Format

Each search session produces lines like the following (tab-separated). The script output is your own search + scoring, so you summarize it yourself. There is no external script to run.

Example summary you record after a search batch:

```
Searched: "roommate expense tracker app"
Top results: Splitwise, Honeydue, custom small apps
Autocomplete variants found: roommate bills app, roommate money tracker, split rent app
Scores: relevance=5, competition=medium, volume=medium
```

The key metric to extract per session is whether you found **net new keywords** not already in `keywords.tsv`.

---

## Logging Results

Log every keyword to `keywords.tsv` (tab-separated, NOT comma-separated — commas break in notes).

Header row and columns:

```
keyword	relevance	competition	volume	category	notes
```

1. `keyword` — the exact search term (lowercase)
2. `relevance` — integer 1–5
3. `competition` — `low`, `medium`, or `high`
4. `volume` — `high`, `medium`, `low`, or `niche`
5. `category` — one of: `core_function`, `use_case`, `competitor`, `ai_angle`, `long_tail`, `audience`
6. `notes` — short rationale or discovery source (no tabs or commas)

Example:

```
keyword	relevance	competition	volume	category	notes
split bills with friends	5	high	high	core_function	primary use case; Splitwise dominates
roommate expense tracker	5	medium	medium	use_case	strong fit; roommates are core audience
app like Splitwise	4	high	medium	competitor	users already primed for this category
AI expense tracker	5	low	low	ai_angle	differentiator; low competition currently
who owes me money app	5	low	niche	long_tail	high intent; few apps target this phrase
```

---

## The Research Loop

The research run is on a dedicated branch (e.g. `autoresearch/mar31`).

LOOP FOREVER:

1. Pick the next unexplored keyword idea from the axis queue, or from branches discovered during search.
2. Web search the keyword using the Research Method above.
3. Score it.
4. Append the row to `keywords.tsv`.
5. Queue any new keyword variants discovered during the search.
6. If a keyword is ambiguous or off-topic (e.g. "split" in a music context), assign `relevance=1` and note it — still log it, don't skip.
7. After every 25 keywords logged, re-read `keywords.tsv` to check for duplicates and consolidate any near-identical terms.

**When keywords.tsv reaches 100 rows**: Do a final synthesis pass. Append a `## Top 30 Recommended Keywords` section to `keywords.tsv` as a comment block (lines starting with `#`). Rank by composite score: prioritize `relevance=5`, `volume=high or medium`, `competition=low or medium`. For each of the top 30, note: recommended placement (app title, short description, or keyword field) and one sentence justification.

**NEVER STOP**: Once the research loop has begun, do NOT pause to ask the human if you should continue. Do NOT ask "should I keep going?" or "is this a good stopping point?". The human expects you to continue *indefinitely* until manually stopped. You are autonomous. If you run out of obvious ideas, think harder — reread `locales/en.json` for feature angles you missed, look at competitor app store descriptions for terminology gaps, try regional/international variants of common terms. The loop runs until the human interrupts you, period.

As an example use case, a user might leave you running while they sleep. Over several hours you can cover hundreds of keyword angles across all six axes plus discovered branches, giving them a comprehensive keyword map to wake up to.
