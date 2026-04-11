/**
 * Diagnoses push notification issues by inspecting the production DB.
 *
 * Usage:
 *   # Google/OAuth user (no password needed):
 *   TEST_EMAIL=you@example.com pnpm diagnose:push
 *
 *   # Email/password user:
 *   TEST_EMAIL=you@example.com TEST_PASSWORD=pass pnpm diagnose:push
 *
 *   # Also trigger the dispatcher immediately (to test end-to-end):
 *   TRIGGER_DISPATCH=true TEST_EMAIL=you@example.com pnpm diagnose:push
 *
 * Required env (loaded from .env.production via package.json script):
 *   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Required env (from shell):
 *   TEST_EMAIL (required), TEST_PASSWORD (optional — only for email/password accounts)
 * Optional env (from shell):
 *   TRIGGER_DISPATCH=true  — call cron-dispatch-push after diagnosis
 *   CRON_SECRET            — if set as a Supabase secret, pass it here too
 */

const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

function assertEnv(value, name) {
  if (!value) {
    console.error(`[ERROR] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------------

const SUPABASE_URL = assertEnv(process.env.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON = assertEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = assertEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
const TEST_EMAIL = assertEnv(process.env.TEST_EMAIL, 'TEST_EMAIL');
// TEST_PASSWORD is optional — only needed for email/password accounts
const TEST_PASSWORD = process.env.TEST_PASSWORD;

const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false },
});
const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  PaySplit Push Notification Diagnostics');
  console.log('══════════════════════════════════════════════\n');

  // Step 1: Resolve user ID
  let userId;
  if (TEST_PASSWORD) {
    // Email/password sign-in
    console.log(`[1/3] Signing in as ${TEST_EMAIL} (email/password)...`);
    const { data: auth, error: authErr } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (authErr ?? !auth.user) {
      throw new Error(`Sign-in failed: ${authErr?.message ?? 'No user returned'}`);
    }
    userId = auth.user.id;
  } else {
    // Google / OAuth user — look up by email via admin API
    console.log(`[1/3] Looking up ${TEST_EMAIL} via admin API (Google/OAuth user)...`);
    const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listErr) throw new Error(`Admin listUsers failed: ${listErr.message}`);
    const match = listData.users.find((u) => u.email === TEST_EMAIL);
    if (!match) throw new Error(`No user found with email: ${TEST_EMAIL}`);
    userId = match.id;
  }
  console.log(`      ✅ OK — user_id: ${userId}\n`);

  // Step 2: Check push tokens
  console.log('[2/3] Checking user_push_tokens table...');
  const { data: tokens, error: tokensErr } = await adminClient
    .from('user_push_tokens')
    .select('token, platform, device_name, disabled_at, last_seen_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (tokensErr) {
    console.error(`      ❌ Query failed: ${tokensErr.message}`);
  } else if (!tokens?.length) {
    console.error('      ❌ NO push tokens found. Device has never successfully registered.');
    console.error('         → Most likely cause: extra.eas.projectId missing from app.json.');
    console.error('         → Fix: register the project on expo.dev, then add the UUID to app.json.');
  } else {
    const active = tokens.filter((t) => !t.disabled_at);
    console.log(`      Total tokens : ${tokens.length}`);
    console.log(`      Active tokens: ${active.length}`);
    tokens.forEach((t, i) => {
      const status = t.disabled_at ? '🚫 disabled' : '✅ active';
      console.log(`\n      [${i + 1}] ${status}`);
      console.log(`           platform   : ${t.platform}`);
      console.log(`           device     : ${t.device_name ?? 'unknown'}`);
      console.log(`           last_seen  : ${t.last_seen_at ?? 'never'}`);
      console.log(`           registered : ${t.created_at}`);
      console.log(`           token      : ${t.token.slice(0, 55)}...`);
    });
  }

  // Step 3: Check recent notifications
  console.log('\n[3/3] Checking last 10 user_notifications...');
  const { data: notifs, error: notifsErr } = await adminClient
    .from('user_notifications')
    .select('type, title, push_sent_at, push_attempts, push_last_error, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (notifsErr) {
    console.error(`      ❌ Query failed: ${notifsErr.message}`);
  } else if (!notifs?.length) {
    console.log('      No notifications found for this user yet.');
  } else {
    notifs.forEach((n, i) => {
      const status = n.push_sent_at
        ? '✅ sent'
        : n.push_attempts >= 5
          ? '❌ exhausted (max 5 attempts reached)'
          : '⏳ pending';
      console.log(`\n      [${i + 1}] ${status}`);
      console.log(`           type     : ${n.type}`);
      console.log(`           title    : "${n.title}"`);
      console.log(`           attempts : ${n.push_attempts}`);
      console.log(`           sent_at  : ${n.push_sent_at ?? 'not sent'}`);
      console.log(`           created  : ${n.created_at}`);
      if (n.push_last_error) {
        console.log(`           error    : ${n.push_last_error}`);
      }
    });
  }

  // Step 4: Manually trigger the dispatcher (if TRIGGER_DISPATCH=true)
  if (process.env.TRIGGER_DISPATCH === 'true') {
    console.log('\n[4/4] Manually triggering cron-dispatch-push...');
    const cronSecret = process.env.CRON_SECRET ?? '';
    const dispatchUrl = `${SUPABASE_URL}/functions/v1/cron-dispatch-push`;
    try {
      const res = await fetch(dispatchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronSecret || SERVICE_KEY}`,
        },
        body: '{}',
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`      ✅ Dispatcher responded ${res.status}:`);
        console.log(`         processed : ${result.processed ?? '?'}`);
        console.log(`         sent      : ${result.sent ?? '?'}`);
        console.log(`         failed    : ${result.failed ?? '?'}`);
        console.log(`         skipped   : ${result.skipped ?? '?'}`);
      } else {
        console.error(`      ❌ Dispatcher returned ${res.status}: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.error(`      ❌ Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await userClient.auth.signOut();
  console.log('\n══════════════════════════════════════════════');
  console.log('  Diagnosis complete.');
  console.log('══════════════════════════════════════════════\n');
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`\n[FAILURE] ${message}`);
  process.exit(1);
});
