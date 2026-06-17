/**
 * Analytics module — thin wrapper over PostHog React Native.
 *
 * Usage:
 *   import { analytics } from '@/lib/analytics';
 *   analytics.track('event_name', { prop: value });
 *
 * All tracking is silently no-op until setAnalyticsClient() is called by
 * PostHogBridge (in app/_layout.tsx), which runs once the provider mounts.
 * When EXPO_PUBLIC_POSTHOG_API_KEY is not set the provider is disabled and
 * setAnalyticsClient is never called, so all helpers remain no-ops.
 */
import PostHog from 'posthog-react-native';

export { PostHog };
export { PostHogProvider, useFeatureFlag, usePostHog } from 'posthog-react-native';

// Mirror of EventProperties from @posthog/core (JSON-serialisable values).
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type EventProperties = { [key: string]: JsonValue };

export const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
export const POSTHOG_HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let _client: PostHog | null = null;

/** Called once by PostHogBridge after the provider mounts. */
export function setAnalyticsClient(client: PostHog): void {
  _client = client;
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

  // Onboarding
  ONBOARDING_COMPLETED: 'onboarding_completed',
  FIRST_SPLIT_STARTED: 'first_split_started',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

type EventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

function track(event: EventName, properties?: EventProperties) {
  if (!_client) return;
  _client.capture(event, properties);
}

function identify(userId: string, traits?: EventProperties) {
  if (!_client) return;
  _client.identify(userId, traits);
}

function reset() {
  if (!_client) return;
  _client.reset();
}

export const analytics = { track, identify, reset };
