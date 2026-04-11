// @ts-nocheck
// Edge function that redirects invite links to the app.
// URL: https://<project>.supabase.co/functions/v1/invite-redirect?token=<token>
//
// When the recipient taps the HTTPS link (e.g. in WhatsApp), the function
// issues a 302 redirect to the paysplit:// deep link which opens the app.
// If the app is not installed, Android will show a "can't open link" prompt
// and the user can install from the Play Store.

const APP_SCHEME = 'paysplit';

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';

  // Build the custom-scheme deep link the app already handles.
  const deepLink = `${APP_SCHEME}://invite?token=${encodeURIComponent(token)}`;

  return new Response(null, {
    status: 302,
    headers: { Location: deepLink },
  });
});
