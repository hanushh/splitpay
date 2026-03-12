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
 * Custom-scheme URLs (paysplit://) are not rendered as clickable links in most
 * messaging apps. Setting this to a real HTTPS domain that redirects to the app
 * makes the shared link tappable.
 *
 * When empty the app falls back to the custom scheme (paysplit://invite).
 * To enable: set to your web redirect URL, e.g. "https://paysplit.app/invite",
 * and ensure the page redirects to `paysplit://invite?token=<token>`.
 */
export const INVITE_WEB_LINK_BASE = '';
