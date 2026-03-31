/**
 * Analytics module — thin wrapper over PostHog React Native.
 *
 * Usage:
 *   import { analytics } from '@/lib/analytics';
 *   analytics.track('event_name', { prop: value });
 *
 * All tracking is silently no-op when EXPO_PUBLIC_POSTHOG_API_KEY is not set
 * (local dev without a PostHog project).
 */
import PostHog from 'posthog-react-native';

export { PostHog };
export { PostHogProvider } from 'posthog-react-native';

// Mirror of EventProperties from @posthog/core (JSON-serialisable values).
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type EventProperties = { [key: string]: JsonValue };

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
const HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let _client: PostHog | null = null;

/** Returns (and lazily initialises) the shared PostHog client. */
export function getPostHogClient(): PostHog | null {
  if (!API_KEY) return null;
  if (!_client) {
    _client = new PostHog(API_KEY, { host: HOST });
  }
  return _client;
}

// ── Event name constants ──────────────────────────────────────────────────────

export const AnalyticsEvents = {
  // Auth
  SIGN_UP: 'user_signed_up',
  SIGN_IN: 'user_signed_in',
  SIGN_OUT: 'user_signed_out',

  // Core actions
  GROUP_CREATED: 'group_created',
  EXPENSE_CREATED: 'expense_created',
  EXPENSE_EDITED: 'expense_edited',
  INVITE_SENT: 'invite_sent',
  INVITE_ACCEPTED: 'invite_accepted',
  SETTLEMENT_CREATED: 'settlement_created',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

type EventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

function track(event: EventName, properties?: EventProperties) {
  const client = getPostHogClient();
  if (!client) return;
  client.capture(event, properties);
}

function identify(userId: string, traits?: EventProperties) {
  const client = getPostHogClient();
  if (!client) return;
  client.identify(userId, traits);
}

function reset() {
  const client = getPostHogClient();
  if (!client) return;
  client.reset();
}

export const analytics = { track, identify, reset };
