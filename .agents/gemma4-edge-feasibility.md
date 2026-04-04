# Feasibility Study: Replace Gemini with Gemma 4 at Edge

**Date:** 2026-04-04  
**Scope:** `supabase/functions/ai-chat/index.ts`  
**Current model:** `gemini-2.5-flash-lite` (via `@google/generative-ai@0.24.1`)

---

## 1. Current Architecture

The `ai-chat` Supabase Edge Function (Deno) calls the Google Generative Language API
using the `@google/generative-ai` npm package. It uses three capabilities:

| Capability | Code location |
|---|---|
| Multi-turn chat with history | `model.startChat({ history })` |
| System instruction | `systemInstruction` in `getGenerativeModel()` |
| Function calling (9 tools) | `tools: appTools` with `SchemaType` declarations |

Function calling is the most critical capability — it drives all navigation actions
(open expense, settle up, view balances, etc.) from natural-language user messages.

---

## 2. Gemma 4 Availability at the Edge

"At edge" here means Supabase Edge Functions (Deno). Edge functions call an external
AI API; they cannot run a model locally. Three practical hosting options exist:

### Option A — Google AI Studio (same API, free tier) ✅ Recommended
- Model IDs: `gemma-4-27b-it` / `gemma-4-31b-it` (dense) or `gemma-4-26b-a4b-it` (MoE, 3.8B active params)
- Endpoint: same `generativelanguage.googleapis.com`
- Auth: same `GEMINI_API_KEY`
- SDK: same `@google/generative-ai` (or upgrade to `@google/genai`)
- **Code change required: zero** — change the `GEMINI_MODEL` secret only

### Option B — Vertex AI
- Requires service-account credentials + different SDK
- More control (SLA, private networking) but significant refactor

### Option C — Self-hosted (Ollama / vLLM / HF Inference)
- Not viable for Supabase Edge Functions — cold-start latency and network hops
  would exceed edge function timeout; no GPU attached to edge runtime

**Conclusion: Option A is the only viable path without rewriting the function.**

---

## 3. Cost Comparison

| Model | Input ($/1M tok) | Output ($/1M tok) | Notes |
|---|---|---|---|
| `gemini-2.5-flash-lite` | $0.075 | $0.30 | Current |
| Gemma 4 (Google AI Studio) | **$0** | **$0** | Free tier; rate-limited |
| Gemma 4 (Vertex AI) | TBD | TBD | Pay-as-you-go, region-dependent |

At 50 requests/user/day × active users the savings are real but depend on scale.
At low volume, the free tier completely eliminates AI inference cost.

**Risk:** Google AI Studio free tier has rate limits (requests-per-minute and
requests-per-day). These are undisclosed for Gemma 4 specifically and can change
without notice. If the app ever exceeds free-tier limits there is no paid Gemma 4
tier on the Developer API — you would need to migrate to Vertex AI at that point.

---

## 4. Technical Compatibility

### 4.1 SDK and API surface

`@google/generative-ai@0.24.1` already supports Gemma 4 models via the same
`GoogleGenerativeAI` constructor — only the model name differs. The newer
`@google/genai` package is now recommended by Google and would need a small
refactor but supports identical features.

### 4.2 System instructions

Supported natively by Gemma 4. No changes required.

### 4.3 Multi-turn history

The `user / model` alternating-role format is identical. No changes required.

### 4.4 Function calling — critical path

Gemma 4 **does** support function calling via the Google Generative Language API.
The server-side parsing (Google's infrastructure) handles tool-call formatting, so
the SDK-level issues reported for self-hosted deployments (mlx-lm, vLLM) **do not
apply** when using the hosted API.

The existing `SchemaType`-based `functionDeclarations` array (`index.ts` lines 34–129)
should work without changes.

**Caveat:** Gemma 4's function-calling reliability for multi-tool, complex-intent
queries has not been independently benchmarked against `gemini-2.5-flash-lite`.
Early community reports suggest it is capable but may require prompt tuning for
edge cases. The app uses 9 tools with moderate complexity — this is well within
Gemma 4's demonstrated range.

### 4.5 Response structure

`response.candidates[0].content.parts` function-call detection (`index.ts` lines 256–268)
is API-level and model-agnostic. No changes required.

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Function calling regression on complex queries | Medium | High | A/B test; keep `gemini-2.5-flash-lite` as fallback via env var |
| Free-tier rate limits in production | Medium | Medium | Monitor 429 errors; migrate to Vertex AI if needed |
| API model name changes / deprecation | Low | Low | Google gives advance notice on Gemma model IDs |
| SDK breaking change (legacy package) | Low | Low | Upgrade to `@google/genai` proactively |

---

## 6. Migration Plan

Because the entire model selection is env-var driven (`GEMINI_MODEL` secret), the
migration is zero-code and fully reversible:

### Step 1 — Staging validation (zero code change)

```bash
# Staging project (gfmbrytpmmbtpumxwile)
source .env.development
supabase secrets set GEMINI_MODEL="gemma-4-27b-it" --project-ref gfmbrytpmmbtpumxwile
```

Run through all 9 tool-call scenarios manually and verify:
- `add_expense` with pre-fill
- `settle_up` with member context
- `view_balances` / `view_spending`
- Free-form Q&A about balances (no tool call)

### Step 2 — Quantify quality gap

Compare 20–30 representative prompts across both models. Score on:
- Tool selected correctly (yes/no)
- Required args populated correctly (yes/no)
- Free-text answer quality (1–3)

If Gemma 4 scores ≥ 90% on tool accuracy, proceed.

### Step 3 — Production rollout

```bash
source .env.production
supabase secrets set GEMINI_MODEL="gemma-4-27b-it" --project-ref yapfqffhgcncqxovjcsr
```

No deployment required — the next function invocation picks up the new secret.

### Step 4 — Rollback (if needed)

```bash
supabase secrets set GEMINI_MODEL="gemini-2.5-flash-lite" --project-ref yapfqffhgcncqxovjcsr
```

Instant, zero-downtime.

### Optional Step 5 — SDK upgrade

Migrate from deprecated `@google/generative-ai` to `@google/genai` in a separate PR.
The API surface is slightly different but well-documented.

---

## 7. Recommendation

| | |
|---|---|
| **Verdict** | Feasible — proceed with staged validation |
| **Effort** | Minimal (env-var change for initial test) |
| **Expected cost saving** | 100% on AI inference at current scale (free tier) |
| **Confidence** | Medium-high; pending function-calling quality validation on staging |

The model swap is low-risk because it is fully env-var driven and instantly
reversible. The main unknown is real-world function-calling accuracy for this
app's specific tool set — validate on staging before promoting to production.

Consider also whether the MoE variant (`gemma-4-26b-a4b-it`, 3.8B active params)
offers an acceptable quality/latency trade-off compared to the denser 27B/31B
models — it will be faster and consume fewer compute resources on Google's side,
which may matter for free-tier rate limits.
