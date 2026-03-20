import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import { buildRagContext, buildSystemPrompt } from '@/lib/ai-context';
import { sendChatMessage, type GeminiMessage } from '@/lib/gemini';

// ── Types ────────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'action';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  /** Present when role === 'action' */
  actionType?: string;
  actionParams?: Record<string, unknown>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAiChat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  /** Convert internal messages to Gemini history (exclude action cards) */
  const toGeminiHistory = useCallback(
    (msgs: ChatMessage[]): GeminiMessage[] =>
      msgs
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        })),
    [],
  );

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  /** Handle a function call returned by Gemini */
  const handleAction = useCallback(
    (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case 'add_expense':
          router.push({
            pathname: '/add-expense',
            params: {
              groupId: String(args.groupId ?? ''),
              groupName: String(args.groupName ?? ''),
              ...(args.description ? { prefillDescription: String(args.description) } : {}),
              ...(args.amountCents ? { prefillAmountCents: String(args.amountCents) } : {}),
            },
          });
          break;

        case 'create_group':
          router.push('/create-group');
          break;

        case 'settle_up':
          router.push({
            pathname: '/settle-up',
            params: {
              groupId: String(args.groupId ?? ''),
              groupName: String(args.groupName ?? ''),
              friendMemberId: String(args.friendMemberId ?? ''),
              friendName: String(args.friendName ?? ''),
              amountCents: String(args.amountCents ?? '0'),
              ...(args.payerMemberId
                ? { payerMemberId: String(args.payerMemberId) }
                : {}),
            },
          });
          break;

        case 'view_group':
          router.push(`/group/${String(args.groupId ?? '')}`);
          break;

        default:
          break;
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!user || !text.trim()) return;

      const userMsg: ChatMessage = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => {
        const updated = [...prev, userMsg];
        return updated;
      });
      setLoading(true);

      try {
        // Build context from current app data
        const userName =
          (user.user_metadata?.full_name as string | undefined) ??
          user.email ??
          'User';
        const context = await buildRagContext(user.id, userName);
        const today = new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        const systemPrompt = buildSystemPrompt(context, today);

        // Get current history before this message for Gemini
        const historyBeforeThisMsg = toGeminiHistory(
          messages.filter((m) => m.role !== 'action'),
        );

        const response = await sendChatMessage(
          historyBeforeThisMsg,
          text.trim(),
          systemPrompt,
        );

        if (response.functionCall) {
          const { name, args } = response.functionCall;

          // Map function name to a readable label
          const actionLabels: Record<string, string> = {
            add_expense: 'Add Expense',
            create_group: 'Create Group',
            settle_up: 'Settle Up',
            view_group: 'View Group',
          };

          const actionMsg: ChatMessage = {
            id: `${Date.now()}-action`,
            role: 'action',
            content: actionLabels[name] ?? name,
            timestamp: new Date(),
            actionType: name,
            actionParams: args,
          };
          appendMessage(actionMsg);
          handleAction(name, args);
        } else {
          const assistantMsg: ChatMessage = {
            id: `${Date.now()}-assistant`,
            role: 'assistant',
            content: response.text ?? 'Sorry, I could not generate a response.',
            timestamp: new Date(),
          };
          appendMessage(assistantMsg);
        }
      } catch {
        const errMsg: ChatMessage = {
          id: `${Date.now()}-err`,
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
          timestamp: new Date(),
        };
        appendMessage(errMsg);
      } finally {
        setLoading(false);
      }
    },
    [user, messages, toGeminiHistory, appendMessage, handleAction],
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, sendMessage, loading, clearHistory };
}
