import { supabase } from '@/lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface FunctionCallResult {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiResponse {
  text: string | null;
  functionCall: FunctionCallResult | null;
}

// ── Main send function ───────────────────────────────────────────────────────

export async function sendChatMessage(
  history: GeminiMessage[],
  userMessage: string,
  systemPrompt: string,
): Promise<GeminiResponse> {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { history, userMessage, systemPrompt },
  });

  if (error) {
    throw new Error(error.message ?? 'AI chat request failed');
  }

  const result = data as { text?: string; functionCall?: FunctionCallResult; error?: string };

  if (result.error) {
    throw new Error(result.error);
  }

  return {
    text: result.text ?? null,
    functionCall: result.functionCall ?? null,
  };
}
