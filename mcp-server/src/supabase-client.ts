import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _userId: string | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const userJwt = process.env.SUPABASE_USER_JWT;

  if (!url || !anonKey || !userJwt) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_USER_JWT'
    );
  }

  _client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${userJwt}` },
    },
  });

  return _client;
}

export async function getCurrentUserId(): Promise<string> {
  if (_userId) return _userId;

  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    throw new Error('Invalid or expired SUPABASE_USER_JWT — could not authenticate');
  }

  _userId = data.user.id;
  return _userId;
}
