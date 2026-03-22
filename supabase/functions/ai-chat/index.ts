// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import { createClient } from 'npm:@supabase/supabase-js@2';
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import {
  GoogleGenerativeAI,
  SchemaType,
} from 'npm:@google/generative-ai@0.24.1';

// ── Constants ─────────────────────────────────────────────────────────────────

const DAILY_LIMIT = 50; // per user per day
const MAX_USER_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_ITEMS = 40;
const MAX_SYSTEM_PROMPT_LENGTH = 8000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface RequestBody {
  history: GeminiMessage[];
  userMessage: string;
  systemPrompt: string;
}

// ── Tool declarations ─────────────────────────────────────────────────────────

const appTools = [
  {
    functionDeclarations: [
      {
        name: 'add_expense',
        description:
          'Open the Add Expense screen, optionally pre-filling group, description, and amount.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            groupId: { type: SchemaType.STRING, description: 'ID of the group.' },
            groupName: { type: SchemaType.STRING, description: 'Display name of the group.' },
            description: { type: SchemaType.STRING, description: 'Short description of the expense.' },
            amountCents: { type: SchemaType.NUMBER, description: 'Amount in cents.' },
          },
          required: ['groupId', 'groupName'],
        },
      },
      {
        name: 'create_group',
        description: 'Open the Create Group screen.',
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'settle_up',
        description: 'Open the Settle Up screen for a specific member balance.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            groupId: { type: SchemaType.STRING, description: 'ID of the group.' },
            groupName: { type: SchemaType.STRING, description: 'Display name of the group.' },
            friendMemberId: { type: SchemaType.STRING, description: 'group_members.id of the friend.' },
            friendName: { type: SchemaType.STRING, description: 'Display name of the friend.' },
            amountCents: { type: SchemaType.NUMBER, description: 'Settlement amount in cents.' },
            payerMemberId: { type: SchemaType.STRING, description: 'Member ID if friend is paying.' },
          },
          required: ['groupId', 'groupName', 'friendMemberId', 'friendName', 'amountCents'],
        },
      },
      {
        name: 'view_group',
        description: 'Navigate to a specific group detail screen.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            groupId: { type: SchemaType.STRING, description: 'ID of the group to open.' },
          },
          required: ['groupId'],
        },
      },
      {
        name: 'view_balances',
        description: 'Open the Balances screen for a group, showing who owes what.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            groupId: { type: SchemaType.STRING, description: 'ID of the group.' },
            groupName: { type: SchemaType.STRING, description: 'Display name of the group.' },
          },
          required: ['groupId', 'groupName'],
        },
      },
      {
        name: 'view_spending',
        description: 'Open the Spending breakdown screen for a group, showing expenses by category.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            groupId: { type: SchemaType.STRING, description: 'ID of the group.' },
            groupName: { type: SchemaType.STRING, description: 'Display name of the group.' },
          },
          required: ['groupId', 'groupName'],
        },
      },
      {
        name: 'view_activity',
        description: 'Navigate to the activity feed showing recent expense events across all groups.',
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'view_friends',
        description: 'Navigate to the Friends tab showing cross-group balances with each friend.',
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'invite_friend',
        description: 'Open the Invite Friend screen to add someone new to a group.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            groupId: { type: SchemaType.STRING, description: 'ID of the group.' },
            groupName: { type: SchemaType.STRING, description: 'Display name of the group.' },
          },
          required: ['groupId', 'groupName'],
        },
      },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── Env vars ──────────────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !geminiKey) {
    return json(500, { error: 'Server misconfiguration' });
  }

  // ── Auth: validate JWT ────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const accessToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!accessToken) {
    return json(401, { error: 'Missing access token' });
  }

  // Use anon client with explicit token to validate the user session
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !userData.user) {
    return json(401, { error: 'Invalid or expired access token' });
  }

  const userId = userData.user.id;

  // ── Server-side rate limiting ─────────────────────────────────────────────
  // Use service role to bypass RLS for usage tracking
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // ── Per-user daily limit ──────────────────────────────────────────────────
  const { data: newCount, error: rateError } = await adminClient.rpc('increment_ai_usage', {
    p_user_id: userId,
    p_date: today,
  });

  if (rateError) {
    // Fail open — don't block valid users if the rate limit table is unavailable
    console.error('[ai-chat] rate limit error:', rateError.message);
  } else if (newCount > DAILY_LIMIT) {
    return json(429, { error: 'Daily limit reached', limit: DAILY_LIMIT });
  }

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { history, userMessage, systemPrompt } = body;

  if (!userMessage || typeof userMessage !== 'string') {
    return json(400, { error: 'userMessage is required' });
  }
  if (userMessage.length > MAX_USER_MESSAGE_LENGTH) {
    return json(400, { error: `userMessage exceeds ${MAX_USER_MESSAGE_LENGTH} character limit` });
  }
  if (systemPrompt && systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return json(400, { error: `systemPrompt exceeds ${MAX_SYSTEM_PROMPT_LENGTH} character limit` });
  }

  // Sanitize history: cap items and enforce per-message length
  const safeHistory: GeminiMessage[] = Array.isArray(history)
    ? history.slice(-MAX_HISTORY_ITEMS).map((msg) => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(msg.parts?.[0]?.text ?? '').slice(0, MAX_USER_MESSAGE_LENGTH) }],
      }))
    : [];

  // ── Call Gemini ───────────────────────────────────────────────────────────
  const geminiModel = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemPrompt,
      tools: appTools,
    });

    const chat = model.startChat({ history: safeHistory });
    const result = await chat.sendMessage(userMessage);
    const response = result.response;

    // Check for function call
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.functionCall) {
          return json(200, {
            functionCall: {
              name: part.functionCall.name,
              args: part.functionCall.args ?? {},
            },
          });
        }
      }
    }

    return json(200, { text: response.text() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemini request failed';
    console.error('[ai-chat] Gemini error:', message);
    return json(502, { error: 'AI service unavailable. Please try again.' });
  }
});
