// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  push_attempts: number;
};

type PushTokenRow = {
  id: string;
  token: string;
};

type ExpoTicket = {
  status: 'ok' | 'error';
  message?: string;
  details?: {
    error?: string;
    [key: string]: unknown;
  };
};

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function markNotificationFailed(
  admin: ReturnType<typeof createClient>,
  notification: NotificationRow,
  errorMessage: string,
) {
  await admin
    .from('user_notifications')
    .update({
      push_attempts: notification.push_attempts + 1,
      push_last_error: errorMessage.slice(0, 500),
    })
    .eq('id', notification.id);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, {
      error:
        'Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY',
    });
  }

  const authHeader =
    req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
  const accessToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!accessToken) {
    return json(401, { error: 'Missing access token' });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData.user) {
    return json(401, { error: 'Invalid access token' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: notifications, error: notificationsError } = await admin
    .from('user_notifications')
    .select('id, user_id, title, body, metadata, push_attempts')
    .is('push_sent_at', null)
    .lt('push_attempts', 5)
    .order('created_at', { ascending: true })
    .limit(50);

  if (notificationsError) {
    return json(500, { error: notificationsError.message });
  }

  const rows = (notifications ?? []) as NotificationRow[];
  if (rows.length === 0) {
    return json(200, { processed: 0, sent: 0, failed: 0, skipped: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of rows) {
    const { data: tokenRows, error: tokenError } = await admin
      .from('user_push_tokens')
      .select('id, token')
      .eq('user_id', notification.user_id)
      .is('disabled_at', null);

    if (tokenError) {
      failed += 1;
      await markNotificationFailed(
        admin,
        notification,
        `Token lookup failed: ${tokenError.message}`,
      );
      continue;
    }

    const tokens = (tokenRows ?? []) as PushTokenRow[];
    if (tokens.length === 0) {
      skipped += 1;
      await markNotificationFailed(
        admin,
        notification,
        'No active push tokens',
      );
      continue;
    }

    const metadata = isObjectRecord(notification.metadata)
      ? notification.metadata
      : {};
    const messages = tokens.map((tokenRow) => ({
      to: tokenRow.token,
      title: notification.title,
      body: notification.body,
      data: {
        notificationId: notification.id,
        ...metadata,
      },
      sound: 'default',
      priority: 'high',
    }));

    try {
      const expoResponse = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });

      const body = (await expoResponse.json().catch(() => ({}))) as {
        data?: ExpoTicket[];
      };
      const tickets = Array.isArray(body.data) ? body.data : [];

      if (!expoResponse.ok || tickets.length === 0) {
        failed += 1;
        await markNotificationFailed(
          admin,
          notification,
          expoResponse.ok
            ? 'Expo push returned no tickets'
            : `Expo push HTTP ${expoResponse.status}`,
        );
        continue;
      }

      let successCount = 0;
      const errors: string[] = [];
      const invalidTokenIds: string[] = [];

      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          successCount += 1;
          return;
        }

        const code = ticket.details?.error ?? 'PushError';
        const message = ticket.message ?? 'Push delivery failed';
        errors.push(`${code}: ${message}`);

        if (code === 'DeviceNotRegistered') {
          const tokenRow = tokens[index];
          if (tokenRow) invalidTokenIds.push(tokenRow.id);
        }
      });

      if (invalidTokenIds.length > 0) {
        await admin
          .from('user_push_tokens')
          .update({ disabled_at: new Date().toISOString() })
          .in('id', invalidTokenIds);
      }

      if (successCount > 0) {
        sent += 1;
        await admin
          .from('user_notifications')
          .update({
            push_sent_at: new Date().toISOString(),
            push_attempts: notification.push_attempts + 1,
            push_last_error: null,
          })
          .eq('id', notification.id);
      } else {
        failed += 1;
        await markNotificationFailed(
          admin,
          notification,
          errors.length > 0 ? errors.join(' | ') : 'All push deliveries failed',
        );
      }
    } catch (error) {
      failed += 1;
      const message =
        error instanceof Error ? error.message : 'Unknown push dispatch error';
      await markNotificationFailed(admin, notification, message);
    }
  }

  return json(200, {
    processed: rows.length,
    sent,
    failed,
    skipped,
  });
});
