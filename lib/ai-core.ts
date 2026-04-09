import { Platform } from 'react-native';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface FunctionCallResult {
  name: string;
  args: Record<string, unknown>;
}

export interface AIResponse {
  text: string | null;
  functionCall: FunctionCallResult | null;
}

export type AiCoreAvailability =
  | 'available'
  | 'downloading'
  | 'unsupported_sdk'
  | 'insufficient_memory'
  | 'unavailable';

// ── Tool definitions injected into the system prompt ─────────────────────────
// Gemma 4 supports function calling via structured JSON output.
// When the model wants to trigger an action it responds with ONLY a JSON object:
//   { "tool": "<name>", "args": { ... } }

const TOOLS_SYSTEM_ADDENDUM = `
## In-App Actions
When the user asks you to perform an action (open a screen, navigate, etc.),
respond with ONLY a single JSON object in this exact format — no other text:

  {"tool":"<name>","args":{<key>:<value>,...}}

Available actions and their required args:

| tool            | required args                                                      | optional args                          |
|-----------------|---------------------------------------------------------------------|----------------------------------------|
| add_expense     | groupId (string), groupName (string)                                | description (string), amountCents (number) |
| create_group    | (none)                                                              |                                        |
| settle_up       | groupId, groupName, friendMemberId, friendName, amountCents (number)| payerMemberId (string)                 |
| view_group      | groupId (string)                                                    |                                        |
| view_balances   | groupId (string), groupName (string)                                |                                        |
| view_spending   | groupId (string), groupName (string)                                |                                        |
| view_activity   | (none)                                                              |                                        |
| view_friends    | (none)                                                              |                                        |
| invite_friend   | groupId (string), groupName (string)                                |                                        |

For all other responses (questions, explanations, summaries), reply with plain text.
Do NOT mix JSON and text in the same reply.`.trim();

// ── Model download URL ────────────────────────────────────────────────────────
// Gemma 3 1B INT4 from litert-community on Hugging Face.
// This model is gated — users must accept the Gemma license at:
//   https://huggingface.co/litert-community/Gemma3-1B-IT
// then supply a Hugging Face read token via EXPO_PUBLIC_HF_TOKEN
// (or host the .task file on your own CDN and update this URL).
export const GEMMA_MODEL_URL =
  'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4.task';

// Hugging Face token for downloading gated models.
// Set EXPO_PUBLIC_HF_TOKEN in your .env.development / .env.production
const HF_TOKEN = process.env.EXPO_PUBLIC_HF_TOKEN ?? '';

// ── Native module (Android only) ─────────────────────────────────────────────

let _native: import('android-ai-core').AndroidAiCoreModule | null = null;

function getNativeModule() {
  if (Platform.OS !== 'android') return null;
  if (_native) return _native;
  try {
    // Dynamic require so Metro doesn't attempt to bundle this on web/iOS
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _native = require('android-ai-core').default;
  } catch {
    _native = null;
  }
  return _native;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Checks whether on-device AI is supported on the current device.
 * Always resolves — never rejects.
 */
export async function checkAiCoreAvailability(): Promise<AiCoreAvailability> {
  const native = getNativeModule();
  if (!native) return 'unsupported_sdk';
  return native.checkAvailability();
}

/**
 * Enqueues a DownloadManager job to fetch the Gemma 4 model file onto the device.
 *
 * Returns 'downloading' on success, 'available' if the model is already present,
 * or 'unavailable' if the download could not be initiated.
 *
 * Only meaningful on Android; always returns 'unsupported_sdk' on other platforms.
 */
export async function requestModelDownload(): Promise<AiCoreAvailability> {
  const native = getNativeModule();
  if (!native) return 'unsupported_sdk';

  // If already available, nothing to do
  const current = await native.checkAvailability();
  if (current === 'available') return 'available';

  try {
    const jobId = await native.startModelDownload(GEMMA_MODEL_URL, HF_TOKEN);
    console.log('[AI] startModelDownload succeeded, jobId:', jobId);
    return 'downloading';
  } catch (e) {
    console.error('[AI] startModelDownload failed:', e);
    return 'unavailable';
  }
}

/**
 * Sends a chat message through Android AI Core (Gemma 4, on-device).
 *
 * Throws with code `'on_device_unavailable:<reason>'` when the device does not
 * meet the hardware / software requirements so callers can gate the UI
 * appropriately instead of showing a generic error.
 */
export async function sendChatMessage(
  history: AIMessage[],
  userMessage: string,
  systemPrompt: string,
): Promise<AIResponse> {
  const native = getNativeModule();

  if (!native) {
    throw new Error('on_device_unavailable:unsupported_sdk');
  }

  // Augment the system prompt with tool definitions
  const fullSystemPrompt = `${systemPrompt}\n\n${TOOLS_SYSTEM_ADDENDUM}`;

  const raw = await native.generateText(
    fullSystemPrompt,
    JSON.stringify(history),
    userMessage,
  );

  return parseModelOutput(raw);
}

// ── Response parsing ──────────────────────────────────────────────────────────

/**
 * Detects whether the model output is a tool-call JSON object or plain text.
 *
 * Tool calls look like: {"tool":"add_expense","args":{...}}
 * Everything else is treated as a plain text reply.
 */
function parseModelOutput(raw: string): AIResponse {
  const trimmed = raw.trim();

  // Quick pre-check to avoid JSON.parse on every text response
  if (trimmed.startsWith('{') && trimmed.includes('"tool"')) {
    try {
      const parsed = JSON.parse(trimmed) as { tool?: string; args?: Record<string, unknown> };
      if (typeof parsed.tool === 'string') {
        return {
          text: null,
          functionCall: {
            name: parsed.tool,
            args: parsed.args ?? {},
          },
        };
      }
    } catch {
      // Not valid JSON — fall through to plain text
    }
  }

  return { text: trimmed, functionCall: null };
}
