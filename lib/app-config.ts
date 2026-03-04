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
export const AUTH_CALLBACK_URL = `${APP_LINK_BASE}auth/${AUTH_CALLBACK_PATH}`;

/** Auth deep link prefix for handling callback (e.g. paysplit://auth) */
export const AUTH_LINK_PREFIX = `${APP_LINK_BASE}auth`;

/** Invite deep link prefix (e.g. paysplit://invite) */
export const INVITE_LINK_PREFIX = `${APP_LINK_BASE}invite`;
