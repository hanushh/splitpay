import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import { buildRagContext, buildSystemPrompt } from '@/lib/ai-context';
import { sendChatMessage, type GeminiMessage } from '@/lib/gemini';
import { AI_DAILY_PROMPT_LIMIT } from '@/lib/app-config';

// ── Daily rate limit ──────────────────────────────────────────────────────────

const DAILY_LIMIT = AI_DAILY_PROMPT_LIMIT;
const STORAGE_KEY = 'ai_chat_daily_usage';

interface DailyUsage {
  date: string; // 'YYYY-MM-DD'
  count: number;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getDailyUsage(): Promise<DailyUsage> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DailyUsage;
      if (parsed.date === todayString()) return parsed;
    }
  } catch {
    // ignore
  }
  return { date: todayString(), count: 0 };
}

async function incrementDailyUsage(): Promise<number> {
  const usage = await getDailyUsage();
  const updated: DailyUsage = { date: todayString(), count: usage.count + 1 };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated.count;
}

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
  const [promptsUsed, setPromptsUsed] = useState(0);

  // Load today's usage on mount
  useEffect(() => {
    getDailyUsage().then((u) => setPromptsUsed(u.count));
  }, []);

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

        case 'view_balances':
          router.push({
            pathname: '/group/balances',
            params: {
              groupId: String(args.groupId ?? ''),
              groupName: String(args.groupName ?? ''),
            },
          });
          break;

        case 'view_spending':
          router.push({
            pathname: '/group/spending',
            params: {
              groupId: String(args.groupId ?? ''),
              groupName: String(args.groupName ?? ''),
            },
          });
          break;

        case 'view_activity':
          router.push('/(tabs)/activity');
          break;

        case 'view_friends':
          router.push('/(tabs)/friends');
          break;

        case 'invite_friend':
          router.push({
            pathname: '/invite-friend',
            params: {
              groupId: String(args.groupId ?? ''),
              groupName: String(args.groupName ?? ''),
            },
          });
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

      // Enforce daily limit
      const usage = await getDailyUsage();
      if (usage.count >= DAILY_LIMIT) {
        const limitMsg: ChatMessage = {
          id: `${Date.now()}-limit`,
          role: 'assistant',
          content: `You've reached your daily limit of ${DAILY_LIMIT} prompts. Come back tomorrow!`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, limitMsg]);
        return;
      }

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

        // Increment usage only on successful API response
        const newCount = await incrementDailyUsage();
        setPromptsUsed(newCount);

        if (response.functionCall) {
          const { name, args } = response.functionCall;

          // Map function name to a readable label
          const actionLabels: Record<string, string> = {
            add_expense: 'Add Expense',
            create_group: 'Create Group',
            settle_up: 'Settle Up',
            view_group: 'View Group',
            view_balances: 'View Balances',
            view_spending: 'View Spending',
            view_activity: 'View Activity',
            view_friends: 'View Friends',
            invite_friend: 'Invite Friend',
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
      } catch (err) {
        console.error('[AI Chat] sendMessage error:', err);
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

  return {
    messages,
    sendMessage,
    loading,
    clearHistory,
    promptsRemaining: Math.max(0, DAILY_LIMIT - promptsUsed),
    dailyLimit: DAILY_LIMIT,
  };
}
