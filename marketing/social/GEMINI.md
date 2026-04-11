# Gemini Integration — PaySplit Social Pipeline

This document describes how Gemini is used across the social media automation scripts.

---

## Two distinct integrations

| Use case | Method | Why |
|---|---|---|
| Content generation (captions, prompts, hero text) | **Gemini CLI** | Google Search grounding built-in; no API key needed |
| Prompt rewriting (after low-scoring image) | **Gemini CLI** | Text-only; CLI is fine |
| Image quality evaluation | **Gemini Vision REST API** | CLI does not support image input |

---

## Gemini CLI

Used in `populate-weekly-calendar.js` and `social-poster-script.js`.

### Authentication
Handled automatically by the CLI via Google credentials (`gcloud auth login` or ADC). No `GEMINI_API_KEY` required.

### Content generation
```bash
gemini -p "<full prompt>" -m gemini-2.5-flash -y
```
- `-y` (YOLO mode) auto-approves all tool use — required for non-interactive/headless runs
- Google Search grounding is automatic when the prompt requests current information
- Output may include prose before the JSON — always extract with regex: `stdout.match(/\[[\s\S]*\]/)`

### Prompt rewriting
```bash
gemini -p "<rewrite instruction>" -m gemini-2.5-flash -y
```
Called from `social-poster-script.js` when a generated image scores below `MIN_PUBLISH_SCORE`.
Returns only the rewritten prompt text.

### Known CLI limitations
- **No `--file` flag** — does not exist; will throw `Unknown argument: file`
- **`@{path}` syntax does not inject images** — passes the path as plain text; model receives no image data
- **stdin binary pipe does not work** — interactive image paste is handled by the terminal emulator, not the CLI; piping raw PNG bytes in headless mode produces no JSON output
- The CLI is **text-only in headless mode** — any vision/multimodal task must use the REST API

---

## Gemini Vision REST API

Used in `lib/utils.js` → `evaluateGeneratedImage()`.

### Why REST and not CLI
The Gemini CLI has no mechanism to send binary image data to the model. The REST API accepts images as base64 `inline_data`, which is the only reliable multimodal path from a Node.js script.

### Endpoint
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}
```

### Payload shape
```json
{
  "contents": [{
    "parts": [
      { "inline_data": { "mime_type": "image/png", "data": "<base64>" } },
      { "text": "<eval prompt>" }
    ]
  }],
  "generationConfig": { "temperature": 0 }
}
```

### Authentication
Requires `GEMINI_API_KEY` in the environment. The same key used for Imagen image generation.

---

## Models

| Constant | Value | Used for |
|---|---|---|
| `GEMINI_MODEL` (env) | `gemini-2.0-flash` (default) | Weekly calendar content generation |
| `GEMINI_REWRITE_MODEL` | `gemini-2.5-flash` | Prompt rewriting after low score |
| `GEMINI_VISION_MODEL` | `gemini-2.5-flash` | Image quality evaluation |
| `GEMINI_IMAGE_MODEL` (env) | `imagen-4.0-fast-generate-001` (default) | Image generation via Imagen |

---

## Image quality loop

Each image goes through up to `MAX_IMAGE_ATTEMPTS` (default: 3) generate→evaluate→rewrite cycles before publishing.

```
Imagen generates image
  └─ Gemini Vision scores it (1–5)
       ├─ score ≥ MIN_PUBLISH_SCORE (3) → publish
       └─ score < 3 and attempts remain
              └─ Gemini CLI rewrites the prompt
                    └─ Imagen generates again (repeat)

After MAX_IMAGE_ATTEMPTS → publish the best result regardless of score
```

Scores and issues are written back to the spreadsheet (`ai_image_score`, `ai_image_issues`) after every published post. The next week's `populate-weekly-calendar.js` run reads the last 8 scored rows and injects them as few-shot examples into the content generation prompt.

---

## Environment variables

| Variable | Required by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `test-image-gen.js`, `social-poster-script.js`, `lib/utils.js` | Imagen image generation + Gemini Vision evaluation |
| `GEMINI_MODEL` | `populate-weekly-calendar.js` | Content generation model override |
| `GEMINI_IMAGE_MODEL` | `social-poster-script.js`, `test-image-gen.js` | Imagen model override |
