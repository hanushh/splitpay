// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

type InvitationRow = {
  id: string;
  invitee_email: string;
  token: string;
  group_id: string | null;
  groups: { name: string } | null;
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = (await req.json().catch(() => ({}))) as { tokens?: string[] };
    const tokens: string[] = Array.isArray(body.tokens) ? body.tokens : [];

    // Build query for pending, unexpired invitations that have an email address
    let query = supabase
      .from('invitations')
      .select('id, invitee_email, token, group_id, groups(name)')
      .eq('status', 'pending')
      .not('invitee_email', 'is', null)
      .gt('expires_at', new Date().toISOString());

    if (tokens.length > 0) {
      query = query.in('token', tokens);
    } else {
      // Without a token filter return early — this function is always called with
      // explicit tokens to avoid sending duplicate emails on a batch fetch.
      return json(200, { sent: 0, skipped: 'no tokens provided' });
    }

    const { data: invitations, error: fetchErr } = await query;

    if (fetchErr) {
      console.error('[send-invitation-email] fetch error:', fetchErr.message);
      return json(500, { error: fetchErr.message });
    }

    if (!invitations || invitations.length === 0) {
      return json(200, { sent: 0 });
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const FROM_ADDRESS =
      Deno.env.get('EMAIL_FROM') ?? 'PaySplit <no-reply@paysplit.app>';
    const INVITE_WEB_BASE =
      Deno.env.get('APP_INVITE_WEB_BASE') ?? 'paysplit://invite';

    if (!RESEND_API_KEY) {
      console.warn(
        '[send-invitation-email] RESEND_API_KEY not set — skipping sends',
      );
      return json(200, { sent: 0, warning: 'Email service not configured' });
    }

    let sentCount = 0;

    for (const inv of invitations as InvitationRow[]) {
      const inviteUrl = `${INVITE_WEB_BASE}?token=${encodeURIComponent(inv.token)}`;
      const groupName = (inv.groups as { name: string } | null)?.name ?? null;

      const subject = groupName
        ? `You've been invited to join "${groupName}" on PaySplit`
        : "You've been invited to PaySplit";

      const textBody = groupName
        ? [
            `You've been invited to split expenses in "${groupName}" on PaySplit.`,
            '',
            'Tap the link below to accept your invitation and join the group:',
            inviteUrl,
            '',
            'This invitation expires in 7 days.',
          ].join('\n')
        : [
            "You've been invited to use PaySplit — the easiest way to split expenses with friends.",
            '',
            'Tap the link below to get started:',
            inviteUrl,
            '',
            'This invitation expires in 7 days.',
          ].join('\n');

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: inv.invitee_email,
            subject,
            text: textBody,
          }),
        });

        if (res.ok) {
          sentCount++;
        } else {
          const errText = await res.text();
          console.error(
            `[send-invitation-email] Resend error for ${inv.invitee_email}:`,
            errText,
          );
        }
      } catch (sendErr) {
        console.error(
          `[send-invitation-email] Network error for ${inv.invitee_email}:`,
          sendErr,
        );
      }
    }

    return json(200, { sent: sentCount });
  } catch (err) {
    console.error('[send-invitation-email] Unhandled error:', err);
    return json(500, { error: String(err) });
  }
});
