/**
 * Sends a real test push notification to a user's registered device(s).
 *
 * Usage:
 *   # Google/OAuth user:
 *   TEST_EMAIL=you@example.com pnpm test:push
 *
 *   # Email/password user:
 *   TEST_EMAIL=you@example.com TEST_PASSWORD=pass pnpm test:push
 *
 * Required env (loaded from .env.production via package.json script):
 *   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Required env (from shell):
 *   TEST_EMAIL (required), TEST_PASSWORD (optional — only for email/password accounts)
 * Optional env (from shell):
 *   CRON_SECRET — if set as a Supabase secret, pass it here too
 */

const { createClient } = require('@supabase/supabase-js');

function assertEnv(value, name) {
  if (!value) {
    console.error(`[ERROR] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = assertEnv(process.env.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON = assertEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = assertEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
const TEST_EMAIL = assertEnv(process.env.TEST_EMAIL, 'TEST_EMAIL');
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const CRON_SECRET = process.env.CRON_SECRET ?? '';

const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function resolveUserId() {
  if (TEST_PASSWORD) {
    console.log(`Signing in as ${TEST_EMAIL} (email/password)...`);
    const { data, error } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (error || !data.user) throw new Error(`Sign-in failed: ${error?.message ?? 'no user'}`);
    return data.user.id;
  }

  console.log(`Looking up ${TEST_EMAIL} via admin API (Google/OAuth user)...`);
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Admin listUsers failed: ${error.message}`);
  const match = data.users.find((u) => u.email === TEST_EMAIL);
  if (!match) throw new Error(`No user found with email: ${TEST_EMAIL}`);
  return match.id;
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  PaySplit Push Notification Test');
  console.log('══════════════════════════════════════════════\n');

  // Step 1: Resolve user
  const userId = await resolveUserId();
  console.log(`✅ User: ${userId}\n`);

  // Step 2: Check active push tokens
  const { data: tokens, error: tokensErr } = await adminClient
    .from('user_push_tokens')
    .select('token, platform, device_name, disabled_at')
    .eq('user_id', userId)
    .is('disabled_at', null);

  if (tokensErr) throw new Error(`Token lookup failed: ${tokensErr.message}`);
  if (!tokens?.length) {
    console.error('❌ No active push tokens found for this user.');
    console.error('   Open the app on your device to register a token, then retry.');
    process.exit(1);
  }

  console.log(`📱 Found ${tokens.length} active token(s):`);
  tokens.forEach((t) => console.log(`   • ${t.platform} — ${t.device_name ?? 'unknown device'}`));
  console.log();

  // Step 3: Insert a test notification row
  const { data: notif, error: notifErr } = await adminClient
    .from('user_notifications')
    .insert({
      user_id: userId,
      type: 'test',
      title: '🔔 Test notification',
      body: 'Push notifications are working correctly.',
      metadata: { test: true, ts: new Date().toISOString() },
    })
    .select('id')
    .single();

  if (notifErr || !notif) throw new Error(`Failed to insert notification: ${notifErr?.message}`);
  console.log(`✅ Inserted test notification row: ${notif.id}\n`);

  // Step 4: Trigger the dispatcher
  console.log('Calling cron-dispatch-push...');
  const dispatchUrl = `${SUPABASE_URL}/functions/v1/cron-dispatch-push`;
  const res = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CRON_SECRET || SERVICE_KEY}`,
    },
    body: '{}',
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`❌ Dispatcher returned ${res.status}: ${JSON.stringify(result)}`);
    process.exit(1);
  }

  console.log(`✅ Dispatcher responded (${res.status}):`);
  console.log(`   processed : ${result.processed ?? '?'}`);
  console.log(`   sent      : ${result.sent ?? '?'}`);
  console.log(`   failed    : ${result.failed ?? '?'}`);
  console.log(`   skipped   : ${result.skipped ?? '?'}`);

  if (result.sent > 0) {
    console.log('\n🎉 Notification sent! Check your device.');
  } else if (result.skipped > 0) {
    console.log('\n⚠️  Skipped — no active push token found by the dispatcher.');
    console.log('   Make sure you have opened the app on a real device (not simulator).');
  } else {
    console.log('\n❌ Notification failed. Run pnpm diagnose:push for details.');
  }

  // Step 5: Clean up the test row if it wasn't sent (keep it if sent so DB is consistent)
  if (!result.sent) {
    await adminClient.from('user_notifications').delete().eq('id', notif.id);
    console.log('   (Test notification row cleaned up from DB)');
  }

  await userClient.auth.signOut();
  console.log('\n══════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error(`\n[FAILURE] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
