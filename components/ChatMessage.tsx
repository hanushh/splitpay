import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';

interface Props {
  message: ChatMessageType;
  onActionPress?: (actionType: string, actionParams: Record<string, unknown>) => void;
}

const ACTION_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  add_expense: 'receipt',
  create_group: 'group-add',
  settle_up: 'account-balance-wallet',
  view_group: 'groups',
};

const ACTION_LABEL_KEYS: Record<string, string> = {
  add_expense: 'ai.actionAddExpense',
  create_group: 'ai.actionCreateGroup',
  settle_up: 'ai.actionSettleUp',
  view_group: 'ai.actionViewGroup',
};

export default function ChatMessage({ message, onActionPress }: Props) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isAction = message.role === 'action';

  const timeStr = message.timestamp.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (isAction && message.actionType) {
    const icon = ACTION_ICONS[message.actionType] ?? 'open-in-new';
    const labelKey = ACTION_LABEL_KEYS[message.actionType];
    const label = labelKey ? t(labelKey) : message.content;

    return (
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() =>
            onActionPress?.(
              message.actionType!,
              message.actionParams ?? {},
            )
          }
          activeOpacity={0.7}
        >
          <MaterialIcons name={icon} size={22} color={PRIMARY} />
          <View style={styles.actionTextWrapper}>
            <Text style={styles.actionLabel}>{label}</Text>
            <Text style={styles.actionSub}>{t('ai.actionTapToOpen')}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={SLATE_400} />
        </TouchableOpacity>
        <Text style={[styles.timestamp, styles.centerTimestamp]}>{timeStr}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant,
          ]}
        >
          {message.content}
        </Text>
      </View>
      <Text style={[styles.timestamp, isUser ? styles.timestampRight : styles.timestampLeft]}>
        {timeStr}
      </Text>
    </View>
  );
}

const PRIMARY = '#17e86b';
const SURFACE = '#1a3324';
const SURFACE_HL = '#244732';
const SLATE_400 = '#94a3b8';
const WHITE = '#ffffff';
const TEXT_DIM = '#94a3b8';

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 16,
    marginVertical: 4,
    maxWidth: '80%',
  },
  rowUser: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowAssistant: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: PRIMARY,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: SURFACE_HL,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextUser: {
    color: '#112117',
    fontWeight: '500',
  },
  bubbleTextAssistant: {
    color: WHITE,
  },
  timestamp: {
    fontSize: 11,
    color: TEXT_DIM,
    marginTop: 3,
  },
  timestampRight: {
    textAlign: 'right',
  },
  timestampLeft: {
    textAlign: 'left',
  },
  // Action card
  actionContainer: {
    marginHorizontal: 16,
    marginVertical: 6,
    alignItems: 'center',
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: SURFACE_HL,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    alignSelf: 'stretch',
  },
  actionTextWrapper: {
    flex: 1,
  },
  actionLabel: {
    color: WHITE,
    fontSize: 15,
    fontWeight: '600',
  },
  actionSub: {
    color: SLATE_400,
    fontSize: 12,
    marginTop: 2,
  },
  centerTimestamp: {
    marginTop: 4,
  },
});
