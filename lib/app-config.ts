/**
 * App display name shown in headers, sign-in, invite messages, etc.
 * Change when you rebrand.
 */
export const APP_DISPLAY_NAME = 'PaySplit';

/**
 * Deep link URL scheme (no ://). When changing, also set the same value
 * for "scheme" in app.json so links like myapp://invite open this app.
 */
export const APP_SCHEME = 'paysplit';

/** Base URL for deep links, e.g. paysplit:// */
export const APP_LINK_BASE = `${APP_SCHEME}://`;

/** OAuth redirect URL for Supabase (e.g. paysplit://auth/callback) */
export const AUTH_CALLBACK_PATH = 'auth/callback';
export const AUTH_CALLBACK_URL = `${APP_LINK_BASE}${AUTH_CALLBACK_PATH}`;

/** Auth deep link prefix for handling callback (e.g. paysplit://auth) */
export const AUTH_LINK_PREFIX = `${APP_LINK_BASE}auth`;

/** Invite deep link prefix (e.g. paysplit://invite) */
export const INVITE_LINK_PREFIX = `${APP_LINK_BASE}invite`;

/**
 * HTTPS base URL used when sharing invite links externally (e.g. via WhatsApp).
 * Points to the `invite-redirect` Supabase Edge Function which serves a page
 * that opens the app via paysplit:// deep link, or falls back to the Play Store.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const INVITE_WEB_LINK_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/invite-redirect`
  : '';

/**
 * Google Play Store URL for the app. Included in all outbound share/invite
 * messages so recipients can tap a clickable link to download the app.
 */
export const APP_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.hanushh.paysplit';

/**
 * Default country code for phone normalization (E.164).
 * Used by the Friends tab contact matching pipeline.
 * Change this for non-US deployments.
 */
export const DEFAULT_COUNTRY_CODE = '+1';
