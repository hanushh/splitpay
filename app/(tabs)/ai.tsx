import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import ChatMessage from '@/components/ChatMessage';
import { useAiChat, type ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';
import { router } from 'expo-router';

const QUICK_ACTIONS = [
  { label: 'How much do I owe?', icon: 'account-balance-wallet' as const },
  { label: 'Add an expense', icon: 'receipt' as const },
  { label: 'Create a group', icon: 'group-add' as const },
  { label: 'Show my groups', icon: 'groups' as const },
];

export default function AiTab() {
  const { t } = useTranslation();
  const { messages, sendMessage, loading, clearHistory, promptsRemaining, dailyLimit } = useAiChat();
  const limitReached = promptsRemaining === 0;
  const [inputText, setInputText] = useState('');
  const insets = useSafeAreaInsets();
  const listRef = useRef<any>(null); // FlatList instance for scrollToEnd

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || loading || limitReached) return;
    setInputText('');
    await sendMessage(text);
  }, [inputText, loading, limitReached, sendMessage]);

  const handleActionPress = useCallback(
    (actionType: string, actionParams: Record<string, unknown>) => {
      switch (actionType) {
        case 'add_expense':
          router.push({
            pathname: '/add-expense',
            params: {
              groupId: String(actionParams.groupId ?? ''),
              groupName: String(actionParams.groupName ?? ''),
              ...(actionParams.prefillDescription
                ? { prefillDescription: String(actionParams.prefillDescription) }
                : {}),
              ...(actionParams.prefillAmountCents
                ? { prefillAmountCents: String(actionParams.prefillAmountCents) }
                : {}),
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
              groupId: String(actionParams.groupId ?? ''),
              groupName: String(actionParams.groupName ?? ''),
              friendMemberId: String(actionParams.friendMemberId ?? ''),
              friendName: String(actionParams.friendName ?? ''),
              amountCents: String(actionParams.amountCents ?? '0'),
              ...(actionParams.payerMemberId
                ? { payerMemberId: String(actionParams.payerMemberId) }
                : {}),
            },
          });
          break;
        case 'view_group':
          router.push(`/group/${String(actionParams.groupId ?? '')}`);
          break;
        default:
          break;
      }
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessageType }) => (
      <ChatMessage message={item} onActionPress={handleActionPress} />
    ),
    [handleActionPress],
  );

  const keyExtractor = useCallback((item: ChatMessageType) => item.id, []);

  const onContentSizeChange = useCallback(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  const isEmpty = messages.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="smart-toy" size={22} color={PRIMARY} />
          <Text style={styles.headerTitle}>{t('ai.title')}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.quotaBadge, limitReached && styles.quotaBadgeExhausted]}>
            <Text style={[styles.quotaText, limitReached && styles.quotaTextExhausted]}>
              {promptsRemaining}/{dailyLimit}
            </Text>
          </View>
          {messages.length > 0 && (
            <TouchableOpacity onPress={clearHistory} hitSlop={12}>
              <Text style={styles.clearBtn}>{t('ai.clearChat')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Message list */}
        {isEmpty ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="smart-toy" size={56} color={SURFACE_HL} />
            <Text style={styles.emptyGreeting}>{t('ai.emptyGreeting')}</Text>
            <View style={styles.quickActions}>
              {QUICK_ACTIONS.map((action) => (
                <TouchableOpacity
                  key={action.label}
                  style={[styles.quickChip, limitReached && styles.quickChipDisabled]}
                  onPress={() => !limitReached && sendMessage(action.label)}
                  activeOpacity={0.7}
                  disabled={limitReached}
                >
                  <MaterialIcons name={action.icon} size={16} color={PRIMARY} />
                  <Text style={styles.quickChipText}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={onContentSizeChange}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Typing indicator */}
        {loading && (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={PRIMARY} />
            <Text style={styles.typingText}>{t('ai.thinking')}</Text>
          </View>
        )}

        {/* Input bar */}
        {limitReached ? (
          <View style={styles.limitBanner}>
            <MaterialIcons name="block" size={16} color={DANGER} />
            <Text style={styles.limitBannerText}>
              Daily limit reached. Resets tomorrow.
            </Text>
          </View>
        ) : (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={t('ai.inputPlaceholder')}
              placeholderTextColor={SLATE_400}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || loading) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || loading}
              activeOpacity={0.8}
            >
              <MaterialIcons name="send" size={20} color="#112117" />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const PRIMARY = '#17e86b';
const BG = '#112117';
const SURFACE = '#1a3324';
const SURFACE_HL = '#244732';
const SLATE_400 = '#94a3b8';
const WHITE = '#ffffff';
const DANGER = '#ff5252';

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SURFACE_HL,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: WHITE,
    fontSize: 18,
    fontWeight: '700',
  },
  clearBtn: {
    color: SLATE_400,
    fontSize: 14,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quotaBadge: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: SURFACE_HL,
  },
  quotaBadgeExhausted: {
    borderColor: DANGER,
    backgroundColor: '#2a1a1a',
  },
  quotaText: {
    color: SLATE_400,
    fontSize: 12,
    fontWeight: '600',
  },
  quotaTextExhausted: {
    color: DANGER,
  },
  quickChipDisabled: {
    opacity: 0.4,
  },
  limitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: SURFACE_HL,
    backgroundColor: BG,
  },
  limitBannerText: {
    color: DANGER,
    fontSize: 14,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 20,
  },
  emptyGreeting: {
    color: WHITE,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  quickActions: {
    width: '100%',
    gap: 10,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: SURFACE_HL,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  quickChipText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '500',
  },
  // Message list
  listContent: {
    paddingVertical: 12,
    paddingBottom: 8,
  },
  // Typing indicator
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  typingText: {
    color: SLATE_400,
    fontSize: 13,
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: SURFACE_HL,
    backgroundColor: BG,
  },
  textInput: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: WHITE,
    fontSize: 15,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: SURFACE_HL,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
