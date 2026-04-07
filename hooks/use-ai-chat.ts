import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import { buildRagContext, buildSystemPrompt } from '@/lib/ai-context';
import {
  sendChatMessage,
  checkAiCoreAvailability,
  requestModelDownload,
  type AIMessage,
  type AiCoreAvailability,
} from '@/lib/ai-core';

// How often to re-check availability while a model download is in progress (ms)
const DOWNLOAD_POLL_INTERVAL_MS = 15_000;

// ── Types ─────────────────────────────────────────────────────────────────────

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
  const [availability, setAvailability] = useState<AiCoreAvailability | 'checking'>('checking');
  const [downloadRequested, setDownloadRequested] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check availability on mount, then re-poll while a download is in progress
  useEffect(() => {
    let cancelled = false;

    async function check() {
      const result = await checkAiCoreAvailability();
      if (cancelled) return;
      setAvailability(result);

      if (result === 'downloading') {
        // Keep polling until the model becomes available (or permanently fails)
        pollTimerRef.current = setTimeout(check, DOWNLOAD_POLL_INTERVAL_MS);
      }
    }

    check();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  /** Convert internal messages to the on-device model's history format.
   *  Action cards map to 'model' turns so history always alternates user/model. */
  const toAIHistory = useCallback(
    (msgs: ChatMessage[]): AIMessage[] =>
      msgs
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'action')
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.role === 'action' ? `[Performed action: ${m.content}]` : m.content }],
        })),
    [],
  );

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  /** Handle a function call returned by the on-device model */
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

      // Gate on device support
      if (availability !== 'available') {
        const reason =
          availability === 'downloading'
            ? 'The AI model is being downloaded in the background. Please try again in a few minutes.'
            : availability === 'unsupported_sdk'
              ? 'On-device AI requires Android 15 or higher.'
              : availability === 'insufficient_memory'
                ? 'On-device AI requires at least 6 GB of device RAM.'
                : 'On-device AI is not supported on this device.';

        appendMessage({
          id: `${Date.now()}-unavailable`,
          role: 'assistant',
          content: reason,
          timestamp: new Date(),
        });
        return;
      }

      const userMsg: ChatMessage = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
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

        const historyBeforeThisMsg = toAIHistory(messages);

        const response = await sendChatMessage(
          historyBeforeThisMsg,
          text.trim(),
          systemPrompt,
        );

        if (response.functionCall) {
          const { name, args } = response.functionCall;

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
          appendMessage({
            id: `${Date.now()}-assistant`,
            role: 'assistant',
            content: response.text ?? 'Sorry, I could not generate a response.',
            timestamp: new Date(),
          });
        }
      } catch (err) {
        console.error('[AI Chat] sendMessage error:', err);
        const errMsg =
          err instanceof Error && err.message.startsWith('on_device_unavailable:')
            ? 'On-device AI is not available on this device.'
            : 'Sorry, something went wrong. Please try again.';

        appendMessage({
          id: `${Date.now()}-err`,
          role: 'assistant',
          content: errMsg,
          timestamp: new Date(),
        });
      } finally {
        setLoading(false);
      }
    },
    [user, messages, availability, toAIHistory, appendMessage, handleAction],
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  /**
   * Requests Android AI Core to download the Gemma 4 model.
   * Once called, availability transitions to 'downloading' and the hook
   * polls automatically until the model becomes ready.
   */
  const retryDownload = useCallback(async () => {
    if (downloadRequested) return;
    setDownloadRequested(true);
    setAvailability('checking');

    const result = await requestModelDownload();
    setAvailability(result);

    if (result === 'downloading') {
      // Start polling — same mechanism as the initial mount check
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      const poll = async () => {
        const next = await checkAiCoreAvailability();
        setAvailability(next);
        if (next === 'downloading') {
          pollTimerRef.current = setTimeout(poll, DOWNLOAD_POLL_INTERVAL_MS);
        } else {
          setDownloadRequested(false);
        }
      };
      pollTimerRef.current = setTimeout(poll, DOWNLOAD_POLL_INTERVAL_MS);
    } else {
      setDownloadRequested(false);
    }
  }, [downloadRequested]);

  return {
    messages,
    sendMessage,
    loading,
    clearHistory,
    availability,
    retryDownload,
  };
}
