// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Simple in-memory rate limiter: max 3 requests per IP per 10 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

async function getUserByEmail(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
) {
  // Use GoTrue admin search — avoids fetching all users
  const res = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=1`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const users: { id: string; email: string }[] = data.users ?? [];
  return (
    users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null
  );
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── DELETE ?token=xxx → confirm and execute deletion ─────────────────────
  if (req.method === 'DELETE' && token) {
    const { data: request, error } = await supabase
      .from('deletion_requests')
      .select('id, user_id, expires_at')
      .eq('token', token)
      .single();

    if (error || !request) {
      return json(400, {
        ok: false,
        error: 'Invalid or already-used deletion link.',
      });
    }

    if (new Date(request.expires_at) < new Date()) {
      return json(400, {
        ok: false,
        error: 'This link expired after 24 hours. Please submit a new request.',
      });
    }

    const { error: deleteErr } = await supabase.auth.admin.deleteUser(
      request.user_id,
    );

    if (deleteErr) {
      console.error('[account-deletion] deleteUser error:', deleteErr.message);
      return json(500, {
        ok: false,
        error: 'Failed to delete account. Please contact hanushh@gmail.com',
      });
    }

    await supabase.from('deletion_requests').delete().eq('id', request.id);
    return json(200, { ok: true });
  }

  // ── POST → request deletion email ────────────────────────────────────────
  if (req.method === 'POST') {
    if (isRateLimited(ip)) {
      return json(429, {
        ok: false,
        error: 'Too many requests. Please try again later.',
      });
    }

    const body = await req.json().catch(() => ({}));
    const email: string | null = body.email ?? null;

    if (!email || !email.includes('@')) {
      return json(400, {
        ok: false,
        error: 'A valid email address is required.',
      });
    }

    const user = await getUserByEmail(supabaseUrl, serviceKey, email);

    // Always return ok — don't reveal whether account exists
    if (!user) {
      return json(200, { ok: true });
    }

    // One active request per user
    await supabase.from('deletion_requests').delete().eq('user_id', user.id);

    const { data: request, error: insertErr } = await supabase
      .from('deletion_requests')
      .insert({ user_id: user.id })
      .select('token')
      .single();

    if (insertErr || !request) {
      console.error('[account-deletion] insert error:', insertErr?.message);
      return json(500, {
        ok: false,
        error: 'Server error. Please try again later.',
      });
    }

    const deletionPageUrl =
      Deno.env.get('DELETION_PAGE_URL') ?? `${url.origin}${url.pathname}`;
    const confirmUrl = `${deletionPageUrl}?token=${request.token}`;

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const FROM_ADDRESS =
      Deno.env.get('EMAIL_FROM') ?? 'PaySplit <no-reply@paysplit.app>';

    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: email,
          subject: 'Confirm your PaySplit account deletion',
          text: [
            'We received a request to permanently delete your PaySplit account.',
            '',
            'Click the link below to confirm. This link expires in 24 hours.',
            '',
            confirmUrl,
            '',
            'If you did not request this, you can safely ignore this email.',
          ].join('\n'),
          html: `
            <p>We received a request to permanently delete your PaySplit account.</p>
            <p>Click the button below to confirm. This link expires in 24 hours.</p>
            <p style="margin:24px 0;">
              <a href="${confirmUrl}" style="background:#ff5252;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">
                Delete My Account
              </a>
            </p>
            <p style="color:#94a3b8;font-size:13px;">If you did not request this, you can safely ignore this email.</p>
          `,
        }),
      }).catch((err) => console.error('[account-deletion] Resend error:', err));
    } else {
      console.warn(
        '[account-deletion] RESEND_API_KEY not set — confirm URL:',
        confirmUrl,
      );
    }

    return json(200, { ok: true });
  }

  return json(405, { ok: false, error: 'Method not allowed' });
});
