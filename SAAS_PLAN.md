# Plan: Marketing Pipeline → Multi-Tenant B2B SaaS

## Context

The PaySplit project has a fully-working AI social media pipeline (`marketing/social/`) that:
1. Generates a weekly content calendar using Gemini + Google Search grounding
2. Generates branded 1080×1350 images via Google Imagen + `sharp` logo overlay
3. Posts to Instagram + Facebook via Meta Graph API
4. Tracks everything in a Google Spreadsheet

The pipeline is entirely tied to the PaySplit brand — hardcoded colors, app name, tagline, logo path, Play Store URL, and feature list. The goal is to extract this into a standalone B2B SaaS web app where any brand (tenant) can configure their own identity and run the same pipeline autonomously.

**User choices:** separate new repo, GitHub Actions as job runner (zero extra cost), all features in scope (IG/FB pipeline + approval workflow + YouTube + Reddit + paid ad boosts + ROI dashboard), basic Stripe billing from day one.

---

## Architecture Overview

```
Browser (Next.js 15 App Router)
    └─ /api/* (API Routes, Node.js runtime — NOT edge)
         ├─ Supabase (Postgres + Auth + Storage + RLS)
         └─ GitHub API → workflow_dispatch (on-demand triggers)

GitHub Actions Workers (Node.js, free minutes)
    ├─ marketing-populate-week.yml   — Monday 08:00 UTC cron → all brands
    └─ marketing-daily-post.yml      — Daily 08:00 UTC cron → approved posts
                                       also triggered on-demand via workflow_dispatch
```

**Stack:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + Supabase (Postgres, Auth, Storage) + GitHub Actions + Stripe

**Why GitHub Actions:**
- Zero additional infrastructure cost ($0 vs $5+/mo for managed job runners)
- Image generation loop (60–90s) runs comfortably within GitHub's 6-hour job limit
- The existing scripts already run as standalone Node.js processes — minimal adaptation needed
- On-demand triggering from the dashboard via GitHub's `workflow_dispatch` REST API
- Job logs visible in GitHub Actions UI (no separate dashboard needed)
- **Trade-off:** All tenants share the same fixed schedule (08:00 UTC). Per-tenant timezone scheduling is not MVP scope.

---

## Critical Constraint: No Edge Runtime for Image Work

The `overlayLogo()` function uses `sharp` (native Node.js binary). All API routes that touch image generation **must** use the Node.js runtime, not the Vercel edge runtime. Never add `export const runtime = 'edge'` to these routes.

---

## Multi-Tenancy Model

Row-Level Security (RLS) with `organization_id` on every tenant-owned table — the same pattern already used throughout the PaySplit app. Every table has:

```sql
CREATE POLICY "org_isolation" ON public.content_calendar
  USING (organization_id IN (
    SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()
  ));
```

Service-role calls from the GitHub Actions worker bypass RLS (existing pattern from edge functions).

---

## Database Schema (6 new tables)

| Table | Purpose |
|---|---|
| `organizations` | Top-level tenants (name, slug, plan: free/starter/growth) |
| `org_members` | User ↔ org with role: admin / editor / viewer |
| `brands` | Per-tenant brand config — colors, name, tagline, logo path, store links, features[], topics[], pipeline config |
| `social_accounts` | Connected Meta accounts per brand (platform, account_id, token_expires_at) |
| `api_credentials` | Encrypted secrets per brand (Gemini key, Meta tokens, Google SA JSON) via Supabase Vault |
| `content_calendar` | Replaces Google Sheets — one row per post, full status machine |
| `pipeline_jobs` | Durable job log mirroring Trigger.dev run state |
| `post_analytics` | Engagement metrics pulled from Meta Insights API |

**Key `content_calendar` status machine:**
```
draft → pending_approval → approved → scheduled → posted
                        ↘ rejected → draft
                                   → failed
```

**Key `brands` fields that replace every hardcoded value:**
- `color_background`, `color_primary`, `color_surface`, `color_accent`
- `logo_storage_path`, `badge_storage_path` (Supabase Storage)
- `name`, `tagline`, `play_store_url`, `app_store_url`
- `features jsonb`, `content_topics jsonb`, `voice_tone text`, `target_audience text`
- `image_style text`, `image_mood jsonb`, `image_avoid jsonb` (photography direction)
- `score_enabled`, `max_image_attempts`, `min_publish_score` (replaces Google Sheets Config tab)
- `gemini_image_model`, `canvas_width`, `canvas_height`

See **Brand Identity & Prompt System** section below for full detail on how these drive the pipeline.

---

## Pipeline Worker: What Gets Reused vs Rewritten

### Direct reuse (TypeScript port, minimal changes)

| Current file | New location | Change |
|---|---|---|
| `lib/utils.js` — `withRetry()`, date helpers, `validatePost()` | `worker/lib/utils.ts` | TypeScript only |
| `lib/utils.js` — `evaluateGeneratedImage()` | `worker/lib/utils.ts` | API key from DB credentials; brand name injected into eval prompt |
| `lib/image-pipeline.js` — `overlayLogo()` | `worker/lib/image-pipeline.ts` | Accept `BrandConfig` param; load logo/badge as buffers from Supabase Storage instead of local paths; all hardcoded strings → `brandConfig.*` |
| `lib/prompts.js` — `buildSystemPrompt()`, `buildUserPrompt()` | `worker/lib/prompts.ts` | `APP_FEATURES`, colors, voice → from `BrandConfig`; no hardcoded PaySplit references |
| `social-poster-script.js` — `postToInstagram()`, `postToFacebook()`, `uploadImageToSupabase()` | `worker/jobs/generate-and-post.ts` | Credentials from DB (decrypted via Vault), not env vars |

### Must be replaced

| Current | Replacement | Reason |
|---|---|---|
| Gemini CLI `execFileAsync('gemini', ...)` | Gemini REST API (`@google/generative-ai`) | CLI binary unavailable in hosted runner |
| Google Sheets as content calendar | `content_calendar` DB table | Multi-tenant requires proper DB isolation |
| OS lock files (`acquireLock`/`releaseLock`) | Trigger.dev idempotency key `{brand_id}:{scheduled_date}` | Lock files don't work in distributed workers |
| OS-level `cron` entries | pg_cron → pg_net → `/api/webhooks/cron` | Same pattern as existing push notification cron in `20260331000001_push_notification_cron_jobs.sql` |
| `fetchSheetConfig()` (Google Sheets Config tab) | `brands` table columns | Runtime overrides stored per-brand in DB |
| `.env` secrets | Supabase Vault + encrypted `api_credentials` table | Per-tenant secret isolation |

### Gemini CLI → REST API (highest priority)

`generatePostsWithGemini()` in `populate-weekly-calendar.js` and `rewritePrompt()` in `image-pipeline.js` both shell out to `gemini` CLI. Replace with:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'; // already in package.json
const model = genai.getGenerativeModel({
  model: 'gemini-2.5-flash',
  tools: [{ googleSearch: {} }],  // Google Search grounding — available in REST API
});
```

---

## UX Principles

**1. Inbox model, not a project manager**
The primary view is "what needs your attention right now" — not a complex grid you have to navigate. Posts bubble up to a review queue. When there's nothing to do, the screen says so clearly.

**2. One-click approvals**
Approve a post without opening a detail page. The most common action is a single button press.

**3. Visual-first**
This is a social media tool — every post shows its image prominently. No walls of text, no status-only table rows.

**4. Live image preview**
Changing the caption, hero text, or prompt updates the image preview in real-time (debounced, ~1.5s). Users see exactly what Instagram will see before approving.

**5. Smart defaults**
New brands get sensible defaults for all pipeline config. The weekly calendar generates automatically — users don't trigger anything manually unless they want to.

**6. Clear empty states**
An empty calendar shows a single CTA: "Generate this week's content →". No jargon, no ambiguity.

---

## Key Screen Designs

### Home Dashboard
The first screen after login. Answers: *what do I need to do today?*

```
┌─────────────────────────────────────────────────────────────┐
│  PaySplit Brand    ▾          [+ New Post]   [Generate Week] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TODAY — Thursday Apr 16                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [image thumbnail]  "Split bills on your group trip" │  │
│  │                     Caption: Ready to explore...     │  │
│  │                     Instagram + Facebook             │  │
│  │                     ● Scheduled — posts at 08:00     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  NEEDS REVIEW  (2)                                         │
│  ┌────────────────────┐  ┌────────────────────┐           │
│  │ [img]  Friday      │  │ [img]  Saturday    │           │
│  │ "Settle up before…"│  │ "Expense tracking" │           │
│  │  [Approve] [Edit]  │  │  [Approve] [Edit]  │           │
│  └────────────────────┘  └────────────────────┘           │
│                                                             │
│  THIS WEEK AT A GLANCE                                     │
│  Mon ✓  Tue ✓  Wed ✓  Thu 🔵  Fri ⏳  Sat ⏳  Sun —      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Calendar View
Week grid where each cell shows the post image thumbnail + status chip. Clicking a post opens a **side panel** (no full-page navigation).

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Week 16   Apr 14–20                              [+ Add Post] │
├────────┬────────┬────────┬────────┬────────┬────────┬────────────┤
│  MON   │  TUE   │  WED   │  THU   │  FRI   │  SAT   │  SUN       │
│ [img]  │ [img]  │ [img]  │ [img]  │ [img]  │ [img]  │    —       │
│ Posted │ Posted │ Posted │ Sched. │ Review │ Review │  + Add     │
└────────┴────────┴────────┴────────┴────────┴────────┴────────────┘
                                              ↓ click opens →
                                    ┌─────────────────────────┐
                                    │ Friday Apr 18           │
                                    │ [large image preview]   │
                                    │                         │
                                    │ Caption ___________     │
                                    │ Hero text __________    │
                                    │ Hashtags ___________    │
                                    │                         │
                                    │ [Regenerate Image]      │
                                    │                         │
                                    │ [✓ Approve]  [✗ Reject] │
                                    └─────────────────────────┘
```

### Brand Setup Wizard (onboarding)
Step-by-step, never more than one decision per screen. A live preview of the CTA strip updates as colors and logo are configured — users see their brand composited into a real post before finishing setup.

```
Step 1/5: Brand Identity          LIVE PREVIEW →
┌────────────────────┐            ┌──────────────────┐
│ App name           │            │   [post image]   │
│ [____________]     │            │                  │
│                    │            │ ┌──────────────┐ │
│ Tagline            │            │ │[logo] MyApp  │ │
│ [____________]     │            │ │ My tagline   │ │
│                    │            │ └──────────────┘ │
│ Primary color  🟢  │            └──────────────────┘
│ Background     ⬛  │
│                    │
│        [Next →]    │
└────────────────────┘
```

### Post Detail Panel
Slides in from the right over the calendar — no page navigation. Image preview on the left updates live as text fields change.

```
┌────────────────────────────────────────────────────────┐
│                                          [×] Close     │
├─────────────────────────┬──────────────────────────────┤
│                         │  Caption                     │
│   [1080×1350 preview]   │  [________________________________]  │
│   (updates as you type) │                              │
│                         │  Hero Text                   │
│   [Regenerate ↺]        │  [________________________________]  │
│                         │                              │
│                         │  Image Prompt                │
│                         │  [________________________________]  │
│                         │  AI score: ★★★★☆             │
│                         │                              │
│                         │  Platforms: [IG ✓] [FB ✓]   │
│                         │                              │
│                         │  ┌──────────┐ ┌──────────┐  │
│                         │  │ ✓ Approve│ │ ✗ Reject │  │
│                         │  └──────────┘ └──────────┘  │
└─────────────────────────┴──────────────────────────────┘
```

---

## New Repo Structure

```
saas-marketing-platform/
├── app/                          # Next.js App Router
│   ├── (auth)/login/             # Supabase Auth UI
│   ├── (auth)/signup/            # Org creation wizard
│   ├── [org]/
│   │   ├── layout.tsx            # Org-scoped layout + auth gate
│   │   ├── calendar/page.tsx     # Weekly grid calendar
│   │   ├── posts/[id]/page.tsx   # Post detail + approve/reject
│   │   ├── brands/[id]/page.tsx  # Brand config form
│   │   ├── accounts/page.tsx     # Social account OAuth connections
│   │   ├── analytics/page.tsx    # Engagement metrics charts
│   │   └── settings/page.tsx     # Team members, pipeline config, billing
│   └── api/
│       ├── image/preview/        # POST: live image preview (Node.js runtime)
│       ├── calendar/fill/        # POST: trigger workflow_dispatch for populate-week
│       ├── posts/[id]/approve/   # PATCH: approve post
│       ├── posts/[id]/reject/    # PATCH: reject post
│       ├── posts/[id]/publish/   # POST: trigger workflow_dispatch for single post
│       ├── jobs/[id]/            # GET: poll pipeline_jobs table status
│       └── webhooks/
│           ├── stripe/           # POST: Stripe events
│           └── meta/             # POST: Meta webhook (post status callbacks)
├── pipeline/                     # Shared Node.js pipeline library
│   ├── jobs/
│   │   ├── populate-week.ts      # Weekly content calendar fill logic
│   │   ├── generate-and-post.ts  # Single post: image gen + Meta publish logic
│   │   └── sync-analytics.ts     # Pull Meta Insights back to DB
│   └── lib/
│       ├── image-pipeline.ts     # overlayLogo(buffer, brandConfig)
│       ├── prompts.ts            # buildSystemPrompt/UserPrompt(brandConfig)
│       ├── utils.ts              # withRetry, evaluateGeneratedImage, validatePost
│       ├── brand-assets.ts       # Download logo/badge from Supabase Storage
│       ├── credentials.ts        # Decrypt api_credentials via Supabase Vault
│       └── db.ts                 # Service-role Supabase client
├── .github/workflows/
│   ├── marketing-populate-week.yml   # Cron Mon 08:00 + workflow_dispatch
│   └── marketing-daily-post.yml      # Cron daily 08:00 + workflow_dispatch
├── supabase/migrations/          # 001–008 new migrations
├── components/
│   ├── CalendarGrid.tsx          # 7-col week view
│   ├── ImagePreview.tsx          # Live image render component
│   ├── ColorPicker.tsx           # Hex color input with swatch
│   ├── LogoUpload.tsx            # Supabase Storage drag-and-drop
│   ├── FeaturesEditor.tsx        # Ordered string list editor
│   └── BrandPreviewCard.tsx      # Mini CTA strip preview
└── lib/
    └── supabase.ts               # Supabase SSR client (same pattern as existing app)
```

---

## Scheduling: GitHub Actions Workflows

Two workflow files in the new repo. Both run as Node.js scripts — the same pipeline code used by the worker lib.

**`.github/workflows/marketing-populate-week.yml`**
```yaml
on:
  schedule:
    - cron: '0 8 * * 1'   # Monday 08:00 UTC
  workflow_dispatch:
    inputs:
      brand_id: { description: 'Specific brand ID (blank = all)', required: false }
      week:     { description: 'next|this', default: 'next' }
```

**`.github/workflows/marketing-daily-post.yml`**
```yaml
on:
  schedule:
    - cron: '0 8 * * *'   # Daily 08:00 UTC
  workflow_dispatch:
    inputs:
      brand_id:          { description: 'Brand ID', required: true }
      calendar_entry_id: { description: 'Specific entry ID', required: false }
      dry_run:           { description: 'true|false', default: 'false' }
```

**On-demand triggering from the dashboard** (`/api/posts/[id]/publish`):
```typescript
await fetch(
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/marketing-daily-post.yml/dispatches`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${GITHUB_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { brand_id: brandId, calendar_entry_id: entryId } })
  }
)
// Write a pipeline_jobs row immediately with status='queued'
// The workflow writes back to pipeline_jobs via Supabase service role on completion
```

**GitHub secrets required in the new repo:**
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GITHUB_PAT` (for dispatch API)

---

## PaySplit → Tenant 1 Migration (non-breaking)

1. **Phase 0:** Create `paysplit` org + brand in DB, seed all hardcoded values from current `image-pipeline.js` and `prompts.js` into the `brands` row. Existing local cron remains active.
2. **Phase 1:** Run cloud worker in parallel (dry-run mode). Verify output matches.
3. **Phase 1 end:** Disable local cron. Cloud pipeline takes over. Existing Google Spreadsheet retained as read-only archive.
4. **Phase 2:** Import historical spreadsheet rows into `content_calendar` as `status='posted'` via a one-time migration script.

---

## Phased Roadmap

### Phase 0 — Foundation (2 weeks)
- Scaffold Next.js 15 + TypeScript + Tailwind + Supabase in new repo
- Supabase migrations 001–006 (all tables + RLS)
- Auth: email/password, org creation on first sign-up
- Org-scoped routing `/[org]/`
- Brand config CRUD + logo upload to Storage
- Seed PaySplit as Tenant 1

### Phase 1 — Cloud Pipeline (3 weeks)
- Port `utils.js` → `pipeline/lib/utils.ts`
- Port `image-pipeline.js` → `pipeline/lib/image-pipeline.ts` with `BrandConfig` injection
- Port `prompts.js` → `pipeline/lib/prompts.ts` with `BrandConfig` injection
- Replace all Gemini CLI calls with REST API (`@google/generative-ai`)
- Implement `populate-week` and `generate-and-post` pipeline jobs
- Wire up `.github/workflows/marketing-populate-week.yml` and `marketing-daily-post.yml`
- `/api/posts/[id]/publish` triggers `workflow_dispatch` via GitHub API
- Basic calendar view dashboard with job status polling against `pipeline_jobs`
- PaySplit running entirely in cloud via GitHub Actions

### Phase 2 — Full Dashboard + Approval (3 weeks)
- Content calendar week-grid (create/edit/delete posts)
- Live image preview (`/api/image/preview`) with brand config
- Post detail page with approve/reject workflow
- Status machine enforcement in API routes
- Team member invite flow + role-based UI

### Phase 3 — Multi-Tenant Self-Serve (3 weeks)
- Public sign-up → org wizard onboarding
- Meta OAuth flow: "Connect Instagram/Facebook" button
- Per-brand API key configuration (stored in Vault)
- Custom posting schedule per brand (timezone-aware)
- *(Billing / payment gateway deferred to future phase)*

### Phase 4 — Paid Ads: Boost + ROI (2 weeks)

**Design principle:** non-technical users. No ad industry jargon. The flow is 3 steps max.

**Boost Post flow (from post detail panel):**
```
Published post → [🚀 Boost this post]
     ↓
┌─────────────────────────────────────┐
│  Boost this post                    │
│                                     │
│  Budget      [$ 20  ] per day       │
│  Duration    [  5   ] days          │
│  Total spend           $100         │
│                                     │
│  Audience                           │
│  ○ People like your followers       │
│  ○ People interested in finance     │
│  ○ Custom (country + age range)     │
│                                     │
│         [🚀 Boost for $100]         │
└─────────────────────────────────────┘
     ↓
Meta Marketing API creates: campaign → ad set → ad (from existing post)
Stores boost record in DB
```

**ROI view (plain English, no jargon):**
```
┌─────────────────────────────────────────────────────────┐
│  This week you spent $100 and reached 8,400 people      │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ $100     │  │ 8,400    │  │ 312      │  │ $0.32  │ │
│  │ spent    │  │ reached  │  │ clicked  │  │ /click │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│                                                         │
│  Best performing post this week ↓                       │
│  ┌────────────────────────────────────────────────┐    │
│  │ [img]  "Split bills on your group trip"        │    │
│  │        $40 spent · 3,200 reached · 180 clicks  │    │
│  │        ████████████████░░░░ 58% of your budget │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**New DB table:** `ad_boosts`
- `id`, `organization_id`, `brand_id`, `calendar_entry_id`
- `meta_campaign_id`, `meta_adset_id`, `meta_ad_id`
- `budget_daily_cents`, `duration_days`, `total_budget_cents`
- `audience_type` (followers_lookalike | interest | custom)
- `audience_config jsonb` (country, age_min, age_max, interests[])
- `status` (active | paused | completed | failed)
- `spend_cents`, `reach`, `clicks`, `impressions` (synced daily)
- `started_at`, `ends_at`, `created_at`

**New Meta API permissions needed:** `ads_management`, `ads_read` (added to existing OAuth scope)
**New API routes:**
- `POST /api/ads/boost/[postId]` — create boost via Meta Marketing API
- `GET /api/ads/roi` — aggregate spend + reach + clicks per brand per week
- Extend `sync-analytics` GitHub Action to also pull `ad_boosts` metrics daily

### Phase 5 — Analytics + YouTube/Reddit Web UI (2 weeks)
- Full analytics dashboard combining organic (`post_analytics`) + paid (`ad_boosts`) metrics in one view
- YouTube outreach: web UI for scrape + review + comment drafting
- Reddit outreach: web UI for review + reply drafting

---

## Pricing (for reference — billing not in MVP)

Billing will be added post-launch. For now, all accounts get full access. Plan tiers are defined but not enforced.

### Intended INR Pricing (India primary, international secondary)

| Feature | Starter ₹999/mo | Growth ₹2,499/mo | Pro ₹4,999/mo | Agency ₹9,999/mo |
|---|---|---|---|---|
| Brands | 1 | 3 | 10 | Unlimited |
| Posts/month | 20 | 60 | Unlimited | Unlimited |
| Auto-posting | ✓ | ✓ | ✓ | ✓ |
| Boost posts | ✗ | ✓ | ✓ | ✓ |
| ROI dashboard | ✗ | ✓ | ✓ | ✓ |
| Team members | 1 | 3 | 10 | Unlimited |
| YouTube/Reddit | ✗ | ✗ | ✓ | ✓ |
| White-label | ✗ | ✗ | ✗ | ✓ |

International equivalent: Starter $12 / Growth $29 / Pro $59 / Agency $119 per month.

### When billing is added (future phase)

- **India:** Razorpay (UPI, Net Banking, EMI, Cards) + GST invoicing
- **International:** Stripe (Cards, PayPal)
- Route by billing country at checkout
- GST compliance (18%) required for Indian customers once revenue > ₹20L/year

---

## APIs Required

### Content Generation (platform-level — one key serves all tenants OR per-tenant key)

| API | Used For | Auth | Approx Cost |
|---|---|---|---|
| **Gemini REST API** `gemini-2.5-flash` | Weekly calendar generation, image quality scoring, prompt rewriting | `GEMINI_API_KEY` | ~$0.15/1M tokens — negligible |
| **Google Imagen API** `imagen-4.0-generate-001` | Generate 1080×1350 post image | Same Gemini API key | ~$0.04/image · max 3 attempts = $0.12/post |
| **Google Search Grounding** | Attaches real trending news to post ideas | Built into Gemini via `tools:[{googleSearch:{}}]` | Included in Gemini API |

> Per-tenant Gemini keys stored encrypted in Supabase Vault. Platform can optionally supply a fallback key for free-tier users.

---

### Social Publishing — Organic (per-tenant, connected via OAuth)

| API | Used For | OAuth Scope |
|---|---|---|
| **Meta Graph API v19** — Instagram | Create container → poll → publish post | `instagram_basic`, `instagram_content_publish` |
| **Meta Graph API v19** — Facebook | Publish photo post to Facebook Page | `pages_manage_posts`, `pages_read_engagement` |
| **Instagram Graph API Insights** | Pull organic metrics: impressions, reach, likes, saves | `instagram_manage_insights` |
| **Facebook Page Insights** | Pull organic metrics for Facebook posts | `read_insights` |

---

### Paid Ads — Boost (per-tenant, same OAuth connection + extra scopes)

| API | Used For | OAuth Scope |
|---|---|---|
| **Meta Marketing API** | Create campaign → ad set → ad from existing post | `ads_management` |
| **Meta Ad Insights API** | Pull daily: spend, reach, clicks, CPM | `ads_read` |

**Ad account:** Every Facebook user already has one automatically. Tenants only need to add a payment method to their Meta ad account once — your platform never handles ad spend money.

---

### Platform Infrastructure

| API | Used For | Auth | Cost |
|---|---|---|---|
| **Supabase Auth** | Sign-up, login, JWT sessions | Anon key + service role key | Free (50k MAU) |
| **Supabase Postgres** | All app data | Service role key (server only) | Free (500MB) |
| **Supabase Storage** | Tenant logos, generated post images | Service role key | Free (1GB) |
| **Supabase Vault** | Encrypted per-tenant secrets | Service role key | Included |
| **GitHub REST API** `workflow_dispatch` | Trigger on-demand post generation from dashboard | PAT with `actions:write` | Free |
| **GitHub Actions API** | Poll job run status | Same PAT | Free |

---

### Billing (platform subscription)

| API | Used For | Auth |
|---|---|---|
| **Stripe API** | Subscription creation, plan upgrades, payment processing | Stripe secret key |
| **Stripe Customer Portal** | Self-serve billing management (tenants update card, download invoices, cancel) | Secret key |
| **Stripe Webhooks** | `subscription.updated`, `subscription.deleted`, `invoice.payment_failed` | Webhook signing secret |

---

### Outreach (Phase 5)

| API | Used For | Auth | Cost |
|---|---|---|---|
| **YouTube Data API v3** | Search videos, fetch metadata + transcripts | Google API key | Free (10k units/day) |
| **Reddit OAuth2** | Read threads for review UI | Reddit app client ID + secret | Free |

---

### What Each Tenant Provides at Onboarding

```
1. Gemini API key        → AI image + content generation
2. Facebook login (OAuth) → Instagram + Facebook posting + ad boosts
   └─ grants: pages_manage_posts, instagram_content_publish,
              instagram_manage_insights, ads_management, ads_read
3. Payment method in Meta (once, in Meta's own settings) → enables Boost
```

Everything else (`SUPABASE_*`, `GITHUB_PAT`, `STRIPE_*`) is platform-level — managed by you only.

---

### AI Cost Per Tenant Per Month

Assuming 1 brand · 4 posts/week · 2 image attempts avg:

| Item | Calculation | Cost |
|---|---|---|
| Imagen image gen | 16 posts × 2 attempts × $0.04 | $0.32 |
| Gemini Vision eval | 32 evals × ~$0.0025 | $0.08 |
| Gemini content gen | 4 weekly runs | $0.10 |
| **Total** | | **~$0.50/tenant/mo** |

Strong margins even on the free tier.

---

## Meta OAuth Connection Flow

### One-time Platform Setup

Create a single Meta App at `developers.facebook.com` (App ID + App Secret). All tenants connect their pages through your app. Request these permissions on the app:
```
pages_manage_posts · pages_read_engagement · instagram_basic
instagram_content_publish · instagram_manage_insights
ads_management · ads_read
```

### Tenant Connects (OAuth dance)

```
1. Tenant clicks "Connect Facebook"
   → Redirect to:
     https://www.facebook.com/v19.0/dialog/oauth
       ?client_id={APP_ID}
       &redirect_uri=https://yourdomain.com/api/auth/meta/callback
       &scope=pages_manage_posts,instagram_content_publish,...
       &state={org_id}   ← ties callback back to the right tenant

2. User logs in, selects Pages to grant, clicks Allow

3. /api/auth/meta/callback receives ?code=ABC&state={org_id}
   Server:
   a. POST /oauth/access_token  →  short-lived user token (2 hrs)
   b. GET  /oauth/access_token?grant_type=fb_exchange_token
                               →  long-lived user token (60 days)
   c. GET  /me/accounts        →  list of Pages + Page Access Tokens
                                  (Page tokens never expire if from long-lived user token)
   d. GET  /{page-id}?fields=instagram_business_account
                               →  Instagram Business Account ID
   e. GET  /me/adaccounts      →  Ad Account(s) for boost feature

4. Store encrypted in Supabase Vault:
   { page_access_token, page_id, instagram_user_id,
     ad_account_id, user_token_expires_at }
```

**Gotcha:** Instagram account must be a Business/Creator account linked to the Facebook Page in Meta Business Settings. If `instagram_business_account` returns empty, show a setup guide linking to Meta's help docs.

### Token Refresh

Page Access Tokens **never expire** (generated from long-lived user token) — posting pipeline runs indefinitely. Only the user token (60 days) needs monitoring:

```
sync-analytics job (daily):
  → check user_token_expires_at for each social_account
  → if < 7 days: set social_accounts.needs_reauth = true
  → dashboard shows banner: "Reconnect Facebook to keep posting" + [Reconnect] button
```

### Accounts Page UX

```
┌──────────────────────────────────────────────────────┐
│  Connected Accounts                                  │
│                                                      │
│  [f] PaySplit Facebook Page        ● Connected       │
│  [📷] PaySplit Instagram            ● Connected       │
│      @paysplit · 2,400 followers                     │
│  [📢] Ad Account: PaySplit Ads      ● Connected       │
│      $0 spent this month                             │
│                                                      │
│  ⚠️  Facebook session expires in 6 days               │
│     [Reconnect]                                      │
│                                                      │
│  [+ Connect another account]                         │
└──────────────────────────────────────────────────────┘
```

---

## Ad Spend vs Platform Subscription (important distinction)

| Payment | For | Goes to |
|---|---|---|
| Platform subscription | Using your SaaS | You (billing deferred to future phase) |
| Ad spend | Boosting posts on Meta | Meta directly — tenant adds card in Meta's own settings |

Your app never touches ad spend money. You call the Meta Marketing API to create the boost; Meta charges the tenant's card on file with them directly.

---

## Brand Identity & Prompt System

This is the core mechanism that makes the pipeline multi-tenant. Every hardcoded PaySplit value in `prompts.js` and `image-pipeline.js` becomes a field on the `brands` table, loaded at runtime into a `BrandConfig` object and injected into all pipeline functions.

---

### The `BrandConfig` Interface

This is the single object passed through the entire pipeline at runtime:

```typescript
interface BrandConfig {
  // Identity
  id:             string
  name:           string          // "PaySplit"
  tagline:        string          // "Split bills. Settle up instantly."
  targetAudience: string          // "18-35 year olds who travel with friends"

  // Visual identity
  colors: {
    primary:    string            // "#17e86b"
    background: string            // "#112117"
    surface:    string            // "#1a3324"
    accent:     string            // "#f97316"
  }
  logoBuffer:  Buffer             // downloaded from Supabase Storage at job start
  badgeBuffer: Buffer | null      // Play Store / App Store badge PNG

  // Store / web links
  playStoreUrl: string | null
  appStoreUrl:  string | null
  websiteUrl:   string | null

  // Content identity (drives Gemini system prompt)
  features:       string[]        // ["Split bills equally", "Track shared expenses", ...]
  contentTopics:  string[]        // ["travel expenses", "roommate bills", "group dining"]
  voiceTone:      string          // "friendly, witty, empowering, modern"

  // Image generation style (drives Imagen prompt prefix)
  imageStyle:     string          // "authentic lifestyle photography"
  imageMood:      string[]        // ["vibrant", "warm", "social", "celebratory"]
  imageAvoid:     string[]        // ["no text overlay", "no phone screens", "no logos"]

  // Pipeline config (per-brand overrides)
  scoreEnabled:       boolean
  maxImageAttempts:   number
  minPublishScore:    number
  geminiImageModel:   string
  canvasWidth:        number
  canvasHeight:       number
}
```

---

### How Brand Values Inject Into the Pipeline

#### 1. Image Prompt Prefix (`BRAND_PROMPT_PREFIX`)

Currently hardcoded in `image-pipeline.js`:
```javascript
const BRAND_PROMPT_PREFIX =
  "authentic lifestyle photography, no text, no device frames, no logos visible, ..."
```

Becomes dynamically built from `BrandConfig`:
```typescript
function buildImagePromptPrefix(brand: BrandConfig): string {
  const mood    = brand.imageMood.join(', ')           // "vibrant, warm, social"
  const avoid   = brand.imageAvoid.join(', ')          // "no text overlay, no phone screens"
  const palette = `${brand.colors.primary} accent tones, ${brand.colors.background} backgrounds`
  return `${brand.imageStyle}, ${mood}, ${avoid}, ${palette}, editorial quality, natural lighting`
}
```

The full Imagen prompt becomes:
```
{buildImagePromptPrefix(brand)} — {post.prompt from content_calendar}
```

#### 2. Content Generation System Prompt (`buildSystemPrompt`)

Currently hardcoded in `prompts.js` with PaySplit features, colors, and voice. Becomes:

```typescript
function buildSystemPrompt(brand: BrandConfig, recentExamples: RecentPost[]): string {
  return `
You are a social media content strategist for ${brand.name}.

BRAND VOICE: ${brand.voiceTone}
TARGET AUDIENCE: ${brand.targetAudience}
TAGLINE: "${brand.tagline}"

APP FEATURES (use these as content hooks):
${brand.features.map((f, i) => `${i + 1}. ${f}`).join('\n')}

CONTENT TOPICS TO DRAW FROM:
${brand.contentTopics.join(', ')}

VISUAL STYLE GUIDELINES (for image prompts):
- Style: ${brand.imageStyle}
- Mood: ${brand.imageMood.join(', ')}
- Avoid: ${brand.imageAvoid.join(', ')}
- Brand colours: primary ${brand.colors.primary}, accent ${brand.colors.accent}

${recentExamples.length > 0 ? buildFewShotExamples(recentExamples) : ''}

Generate posts that feel authentic to ${brand.name}'s voice.
  `.trim()
}
```

#### 3. Few-Shot Feedback Loop (per-brand)

The existing pipeline reads the last 8 rows from Google Sheets (with `ai_image_score`) to build few-shot good/bad examples. In the multi-tenant system this becomes a per-brand query:

```typescript
// worker/lib/db.ts
async function getRecentPostExamples(brandId: string): Promise<RecentPost[]> {
  const { data } = await supabase
    .from('content_calendar')
    .select('prompt, caption, ai_image_score, ai_image_issues')
    .eq('brand_id', brandId)
    .eq('status', 'posted')
    .not('ai_image_score', 'is', null)
    .order('posted_at', { ascending: false })
    .limit(8)
  return data ?? []
}
```

Good examples (score ≥ 4) and poor examples (score ≤ 2) are injected into the system prompt as few-shot context — exactly as the current pipeline does, but isolated per brand.

#### 4. Logo Overlay (`overlayLogo`)

Currently reads from a hardcoded local path `assets/images/icon.png`. Becomes:

```typescript
// worker/lib/brand-assets.ts
async function loadBrandAssets(brand: BrandRow): Promise<{ logoBuffer: Buffer, badgeBuffer: Buffer | null }> {
  const logoBuffer  = await downloadFromStorage(brand.logo_storage_path)
  const badgeBuffer = brand.badge_storage_path
    ? await downloadFromStorage(brand.badge_storage_path)
    : null
  return { logoBuffer, badgeBuffer }
}

// worker/lib/image-pipeline.ts
async function overlayLogo(imageBuffer: Buffer, heroText: string, brand: BrandConfig): Promise<Buffer> {
  // CTA strip: brand.colors.background, brand.name, brand.tagline, brand.playStoreUrl
  // Logo pill: brand.colors.primary border, brand.logoBuffer
  // All SVG strings use brand.colors.* instead of hardcoded hex values
}
```

---

### Brand Configuration UI (Brand Wizard)

Tenants configure all of the above through a step-by-step wizard. Each step has a **live preview panel** that re-renders the CTA strip and a sample post as values change.

```
Step 1/6 — Identity
┌──────────────────────────┐   ┌────────────────────────────┐
│ App / Brand name         │   │   LIVE PREVIEW             │
│ [PaySplit          ]     │   │                            │
│                          │   │   ┌────────────────────┐   │
│ Tagline                  │   │   │  [sample image]    │   │
│ [Split bills. Settle up] │   │   │                    │   │
│                          │   │   │ ┌────────────────┐ │   │
│ Target audience          │   │   │ │[logo] PaySplit │ │   │
│ [18-35 year olds who...] │   │   │ │Split bills...  │ │   │
│                          │   │   │ └────────────────┘ │   │
│           [Next →]       │   │   └────────────────────┘   │
└──────────────────────────┘   └────────────────────────────┘

Step 2/6 — Brand Colors
  Primary   [🟢 #17e86b]   Background  [⬛ #112117]
  Surface   [🟫 #1a3324]   Accent      [🟠 #f97316]
  → CTA strip updates in real-time as colors change

Step 3/6 — Logo & Badge
  App icon (PNG/SVG, min 512×512)    [Upload ↑]
  Store badge (optional)             [Upload ↑]
  → Previewed composited into CTA strip immediately

Step 4/6 — App Features
  These become content hooks for the AI.
  [Split bills equally              ] [×]
  [Track shared group expenses      ] [×]
  [Settle up with one tap           ] [×]
  [+ Add feature]

Step 5/6 — Content & Voice
  Content topics (what to post about)
  [travel expenses] [roommate bills] [group dining] [+]

  Brand voice/tone
  [friendly, witty, modern, empowering]

  Image style
  ○ Authentic lifestyle photography  ← presets
  ○ Flat lay / product photography
  ○ Minimal / studio
  ○ Custom: [___________________________]

  Mood keywords
  [vibrant] [warm] [social] [+ Add]

  Avoid in images
  [no text overlay] [no phone screens] [no logos] [+ Add]

Step 6/6 — Store Links
  Google Play URL  [https://play.google.com/...]
  App Store URL    [https://apps.apple.com/...]  (optional)
  Website          [https://...]                 (optional)

  [✓ Finish setup — Generate first week's content]
```

---

### Multiple Brands per User / Org

One organisation can manage multiple brands (e.g. a founder with two apps, or an agency with multiple clients). Each brand is fully isolated — its own brand identity, social accounts, content calendar, credentials, and pipeline jobs.

#### Data isolation

Every tenant-owned table has `brand_id` as well as `organization_id`. This means:
- Brand A's calendar rows never appear in Brand B's calendar
- Brand A's Meta tokens cannot be used for Brand B's posts
- Brand A's Gemini API key is separate from Brand B's
- `content_calendar` has `UNIQUE(brand_id, scheduled_date)` — each brand can post on the same date

#### Brand switcher UI

The top navigation always shows the currently active brand. Switching brands is a single click — the entire dashboard (calendar, analytics, accounts, settings) re-renders for the selected brand.

```
┌──────────────────────────────────────────────────────────────┐
│  [🏠]  PaySplit  ▾               Calendar  Analytics  Settings│
│         ─────────────────                                     │
│         ✓ PaySplit                                            │
│           SplitEasy (2nd brand)                               │
│           + Add new brand                                     │
└──────────────────────────────────────────────────────────────┘
```

URL structure: `/[org-slug]/[brand-slug]/calendar` — bookmarkable, shareable within the team. Switching brand changes `brand-slug` in the URL.

#### All-brands overview (org home)

When a user has 2+ brands, the org home shows a cross-brand summary before they drill into a specific brand:

```
┌──────────────────────────────────────────────────────────────┐
│  Your Brands                              [+ Add brand]      │
│                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐   │
│  │ [logo] PaySplit         │  │ [logo] SplitEasy        │   │
│  │ 4 posts this week       │  │ 3 posts this week       │   │
│  │ 2 need review    ⏳     │  │ ✓ All approved          │   │
│  │ Instagram + Facebook    │  │ Instagram only          │   │
│  │ [Open →]                │  │ [Open →]                │   │
│  └─────────────────────────┘  └─────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

#### Adding a second brand

Same 6-step brand wizard as onboarding — nothing pre-populated. Each brand starts fresh with its own identity. The wizard is accessible from the brand switcher dropdown → "Add new brand".

Plan limits gate how many brands can be created (`brands` count vs `org.plan`). Attempting to add a 4th brand on the Growth plan (limit: 3) shows an upgrade prompt.

#### Pipeline behaviour with multiple brands

The GitHub Actions weekly fill and daily post workflows loop through **all active brands** in the DB for that run:

```typescript
// pipeline/jobs/populate-week.ts
const brands = await db
  .from('brands')
  .select('*')
  .eq('is_active', true)
  // if workflow_dispatch included a brand_id input, filter to just that brand
  // otherwise process all brands for this org

for (const brand of brands) {
  const config    = await assembleBrandConfig(brand)   // loads assets, decrypts creds
  const examples  = await getRecentPostExamples(brand.id)
  const posts     = await generatePostsForBrand(config, examples, weekDates)
  await insertCalendarRows(posts, brand.id)
}
```

Each brand generates independently — if Brand A's Gemini call fails, Brand B still processes. Failures are logged to `pipeline_jobs` per brand, not globally.

**Concurrency guard:** GitHub Actions concurrency groups are scoped per brand:
```yaml
concurrency:
  group: populate-week-${{ matrix.brand_id }}
  cancel-in-progress: false
```

#### Brand-level credentials

Each brand can have different API keys and social accounts:

| Brand | Gemini key | Instagram | Facebook page | Ad account |
|---|---|---|---|---|
| PaySplit | key_A | @paysplit | PaySplit Page | act_111 |
| SplitEasy | key_B | @spliteasy | SplitEasy Page | act_222 |

The `api_credentials` table has `UNIQUE(brand_id, service)` — each brand gets its own vault-encrypted credential row per service. If a brand doesn't have its own Gemini key, the pipeline falls back to the platform-level key (stored as an env var in GitHub Actions secrets).

---

### How Users Keep Prompts Relevant to Their Product

There are four layers — setup quality, guardrails in the prompt, a live feedback loop, and manual controls. Together they ensure the AI never goes off-brand.

---

#### Layer 1 — Brand Setup Quality (the foundation)

The better the brand wizard inputs, the better every generated post. The wizard actively guides users toward specificity:

**Features list** — users are asked to describe *what their product does*, not what it is. The UI shows a character counter and a hint:

```
App Features  (these become your content hooks — be specific)

[Split bills equally among friends          ] [×]   ✓ Good — specific action
[Track who owes what in real time           ] [×]   ✓ Good — describes outcome
[Settle up with one tap via UPI             ] [×]   ✓ Good — includes context
[Finance app                                ] [×]   ⚠ Too vague — AI will struggle

Tip: Describe what users actually do in your app, not what category it belongs to.
[+ Add feature]
```

**Content topics** — topics are the subjects the AI draws from each week. Prompt: *"What situations does your product help with?"*

```
Content Topics  (situations where people would use your app)

[splitting restaurant bills    ]   [group travel expenses    ]
[roommate rent and utilities   ]   [office lunch pools       ]
[weekend trip budgeting        ]   [birthday party costs     ]
[+ Add topic]

Tip: Think about real moments in your users' lives, not abstract categories.
```

**Voice + audience** — two free-text fields with example placeholders:
- Voice/tone: `"friendly, witty, no financial jargon, relatable to young adults"`
- Target audience: `"20-35 year olds who travel with friends or live with flatmates"`

---

#### Layer 2 — Prompt Guardrails (Gemini instruction)

The system prompt explicitly constraints Gemini to stay on-product. Key instructions injected from `BrandConfig`:

```
STRICT RULES:
- Every post must connect to at least one feature from the features list above
- Every post must reflect a real situation from the content topics list
- The image prompt must depict the TARGET AUDIENCE in a real-life moment, not abstract concepts
- Never mention competitor brands
- Never use financial jargon unless it's in the brand voice definition
- The news hook must be relevant to ${brand.targetAudience}, not just globally trending
```

Additionally, `buildUserPrompt()` injects the week's specific topic rotation:

```typescript
function buildUserPrompt(brand: BrandConfig, weekDates: WeekDate[]): string {
  // Rotate through contentTopics across the week so posts don't repeat the same subject
  const rotatedTopics = rotateCyclically(brand.contentTopics, getWeekNumber())
  return `
Generate ${weekDates.length} posts for the week of ${weekDates[0]} to ${weekDates[weekDates.length-1]}.

This week's topic rotation (assign one per post):
${rotatedTopics.slice(0, weekDates.length).map((t, i) => `Day ${i+1}: ${t}`).join('\n')}

Each post must tie to a real trending news story found via Google Search
that connects naturally to the assigned topic and ${brand.name}'s features.
  `
}
```

This topic rotation ensures variety across the week and prevents the AI from defaulting to the same angle repeatedly.

---

#### Layer 3 — Approval Workflow as Feedback Loop

Every post a user approves or rejects teaches the system what "on-brand" means for their specific product. This is the existing few-shot mechanism in the pipeline, now per-brand:

```
User rejects a post → clicks "Reject" → modal asks why:
  ○ Image not relevant to my product
  ○ Caption doesn't match our voice
  ○ Topic feels off-brand
  ○ Other: [________________]

→ rejection_note saved to content_calendar row
→ next week's system prompt includes this row as a "poor example":
  "AVOID posts like this: [caption] — reason: [rejection_note]"
```

Approved posts with high AI scores (≥ 4) become "good examples" in the system prompt:

```
GOOD EXAMPLES (use as style reference):
Post 1: [caption] — AI score 5/5 — topic: group travel
Post 2: [caption] — AI score 4/5 — topic: restaurant split
```

Over 2–3 weeks the model adapts to the brand's specific content preferences without any manual prompt engineering.

---

#### Layer 4 — Manual Controls (always available)

Users are never locked into AI output. Every post has escape hatches:

**Before approval — edit anything:**
```
Post Detail Panel:
  Caption       [editable text area — user can rewrite completely]
  Hero Text     [editable — the text overlaid on the image]
  Image Prompt  [editable — user can rewrite the Imagen prompt]
                [Regenerate ↺]  ← reruns Imagen with the edited prompt
  News Hook     [editable — the trending story the post ties to]
```

**Regenerate with guidance:**
When a user clicks Regenerate, an optional field appears:

```
[Regenerate ↺]
Tell the AI what to change (optional):
[Make it more about travel, less about money          ]
[Generate]
```

This input is appended to the image prompt before the next Imagen attempt.

**Topic management at any time:**
Brand settings → Content & Voice → add/remove/reorder topics. Takes effect on the very next weekly calendar generation — no pipeline restart needed.

**Manual post creation:**
Users can bypass AI generation entirely. "+ New Post" opens the same post panel pre-filled with blank fields. They write caption and image prompt manually → AI generates only the image → approval workflow applies as normal.

---

#### Summary: Relevance Control Flow

```
Brand Wizard (specific features + topics + voice)
    ↓
Gemini system prompt with guardrails + topic rotation
    ↓
Generated posts (weekly, 4 per brand)
    ↓
User reviews in dashboard
    ├─ Approve → becomes a "good example" for future weeks
    ├─ Edit + approve → corrected output, improves future weeks
    └─ Reject + reason → becomes a "poor example" for future weeks
    ↓
Next week: Gemini has brand-specific few-shot context
    → posts get progressively more on-brand over time
```

---

### Brand Identity Versioning

When a brand updates their config (e.g. changes colors or voice), existing `content_calendar` rows are unaffected — they already have their `prompt`, `caption`, and `image_url` saved. Only future pipeline runs use the new config.

The `brands` table has `updated_at` and the pipeline reads brand config fresh on every job run, so changes take effect on the very next post generation with zero manual action.

---

### How BrandConfig Flows Through the Pipeline (end to end)

```
GitHub Actions job starts
  │
  ├─ db.ts: SELECT * FROM brands WHERE id = $brand_id
  ├─ credentials.ts: decrypt api_credentials (Gemini key, Meta tokens)
  ├─ brand-assets.ts: download logo + badge from Supabase Storage → Buffers
  │
  └─ BrandConfig assembled ─────────────────────────────────────────────┐
                                                                         │
  populate-week job:                                                      │
    prompts.ts: buildSystemPrompt(brandConfig, recentExamples)  ←────────┤
    prompts.ts: buildUserPrompt(brandConfig, weekDates)         ←────────┤
    → Gemini API → JSON posts                                            │
    → INSERT content_calendar rows                                       │
                                                                         │
  generate-and-post job:                                                  │
    image-pipeline.ts: buildImagePromptPrefix(brandConfig)      ←────────┤
    → Imagen API → raw PNG buffer                                        │
    image-pipeline.ts: overlayLogo(buffer, heroText, brandConfig) ←──────┤
    → composited PNG (colors, logo, tagline, store link from brandConfig)│
    → Supabase Storage upload                                            │
    → Meta Graph API post                                               │
    → UPDATE content_calendar (posted, image_url, score)                │
```

Every function receives `BrandConfig` as a parameter. No function reads from environment variables or hardcoded constants for brand-specific values.

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `sharp` not available in Deno/edge | Worker stays in Node.js (Trigger.dev). API routes use Node.js runtime, never `export const runtime = 'edge'` |
| Gemini CLI unavailable in hosted runner | Replace with `@google/generative-ai` REST SDK (already in package.json) — Google Search grounding available via `tools: [{googleSearch:{}}]` |
| Meta access tokens expire (60 days) | `social_accounts.token_expires_at` checked on every job; dashboard surfaces "reconnect" prompt on expiry |
| Concurrent jobs for same brand/date | GitHub Actions concurrency groups `group: post-{brand_id}-{date}` + `UNIQUE(brand_id, scheduled_date)` DB constraint |
| Credential security | Supabase Vault for secrets — `api_credentials` stores only vault reference IDs; service-role-only access |
| Image gen cost at scale | Plan-gated `max_image_attempts`; early exit on first score ≥ `min_publish_score` |

---

## Verification Plan

After Phase 1 (cloud pipeline):
```bash
# Trigger populate-week job for PaySplit brand manually
curl -X POST /api/calendar/fill -d '{"brandId":"<paysplit-brand-id>", "week":"next"}'

# Verify rows appear in content_calendar table
# Trigger generate-and-post for a specific date (dry-run)
curl -X POST /api/posts/<id>/publish -d '{"dryRun":true}'

# Check pipeline_jobs table for status
# Verify image written to Supabase Storage
# Verify content_calendar row updated with image_url + ai_image_score
```

After Phase 2 (dashboard):
- Sign up as a new org, create a brand, fill in colors/logo
- Generate a post via the UI, see live image preview
- Approve the post, confirm it enters `approved` status
- Manually trigger publish, confirm Meta posting and status → `posted`
