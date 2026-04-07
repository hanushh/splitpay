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
 * Requests Android AI Core to begin downloading the Gemma 4 model.
 *
 * Re-runs the availability probe, which creates a new GenerativeModel and
 * registers a DownloadCallback — that registration is what instructs Android
 * AI Core to start the download if it hasn't begun already.
 *
 * Returns the resulting availability state:
 *   - 'downloading'  → download started successfully.
 *   - 'available'    → model was already on-device (no download needed).
 *   - 'unavailable'  → device is incompatible or download could not be initiated.
 *
 * Only meaningful on Android; always returns 'unsupported_sdk' on other platforms.
 */
export async function requestModelDownload(): Promise<AiCoreAvailability> {
  return checkAiCoreAvailability();
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
