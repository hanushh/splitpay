// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import { createClient } from 'npm:@supabase/supabase-js@2';
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import {
  GoogleGenerativeAI,
  SchemaType,
} from 'npm:@google/generative-ai@0.24.1';

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

// ── Tool declarations (same as client-side) ───────────────────────────────────

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

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── Auth: validate JWT ────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !anonKey) {
    return json(500, { error: 'Missing Supabase env vars' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const accessToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!accessToken) {
    return json(401, { error: 'Missing access token' });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData.user) {
    return json(401, { error: 'Invalid access token' });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
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

  // ── Call Gemini ───────────────────────────────────────────────────────────
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    return json(500, { error: 'Gemini API key not configured' });
  }

  const geminiModel = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash-lite';

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemPrompt,
      tools: appTools,
    });

    const chat = model.startChat({ history: history ?? [] });
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
    return json(502, { error: message });
  }
});
