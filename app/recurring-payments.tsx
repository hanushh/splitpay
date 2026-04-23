import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatCentsWithCurrency } from '@/context/currency';
import { useToast } from '@/context/toast';
import {
  RecurringExpense,
  useRecurringPayments,
} from '@/hooks/use-recurring-payments';

const C = {
  primary: '#17e86b',
  orange: '#f97316',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
  red: '#ff5252',
};

function isDue(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr <= today;
}

function formatFrequency(
  frequency: RecurringExpense['frequency'],
  t: (key: string) => string,
): string {
  return t(`recurring.frequency_${frequency}`);
}

export default function RecurringPaymentsScreen() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const { groupId, groupName } = useLocalSearchParams<{
    groupId: string;
    groupName?: string;
  }>();

  const {
    recurringExpenses,
    loading,
    error,
    fetchRecurringExpenses,
    triggerNow,
    deleteRecurringExpense,
  } = useRecurringPayments(groupId);

  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchRecurringExpenses();
    }, [fetchRecurringExpenses]),
  );

  const handleTriggerNow = useCallback(
    async (item: RecurringExpense) => {
      setTriggeringId(item.id);
      const ok = await triggerNow(item);
      setTriggeringId(null);
      if (ok) {
        showToast('success', t('recurring.expenseAdded'));
      }
    },
    [triggerNow, showToast, t],
  );

  const handleDelete = useCallback(
    (item: RecurringExpense) => {
      Alert.alert(
        t('recurring.deleteTitle'),
        t('recurring.deleteMessage', { name: item.description }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              setDeletingId(item.id);
              const ok = await deleteRecurringExpense(item.id);
              setDeletingId(null);
              if (ok) {
                showToast('success', t('recurring.deleted'));
              }
            },
          },
        ],
      );
    },
    [deleteRecurringExpense, showToast, t],
  );

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle}>{t('recurring.title')}</Text>
          {groupName ? (
            <Text style={s.headerSub}>{groupName}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/create-recurring-payment',
              params: { groupId, groupName },
            })
          }
          hitSlop={12}
        >
          <MaterialIcons name="add" size={26} color={C.primary} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator
          color={C.primary}
          style={{ marginTop: 40 }}
          size="large"
        />
      ) : error ? (
        <View style={s.emptyWrap}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={fetchRecurringExpenses} style={s.retryBtn}>
            <Text style={s.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : recurringExpenses.length === 0 ? (
        <View style={s.emptyWrap}>
          <MaterialIcons
            name="repeat"
            size={48}
            color={C.slate500}
            style={{ marginBottom: 12 }}
          />
          <Text style={s.emptyTitle}>{t('recurring.emptyTitle')}</Text>
          <Text style={s.emptyBody}>{t('recurring.emptyBody')}</Text>
          <Pressable
            style={s.addBtn}
            onPress={() =>
              router.push({
                pathname: '/create-recurring-payment',
                params: { groupId, groupName },
              })
            }
          >
            <Text style={s.addBtnText}>{t('recurring.addFirst')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            s.list,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          {recurringExpenses.map((item) => {
            const due = isDue(item.next_occurrence_date);
            const isTriggering = triggeringId === item.id;
            const isDeleting = deletingId === item.id;
            return (
              <View key={item.id} style={[s.card, due && s.cardDue]}>
                <View style={s.cardLeft}>
                  <View style={s.cardTitleRow}>
                    <Text style={s.cardDesc}>{item.description}</Text>
                    {due && (
                      <View style={s.duePill}>
                        <Text style={s.duePillText}>{t('recurring.due')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.cardAmount}>
                    {formatCentsWithCurrency(
                      item.amount_cents,
                      item.currency_code,
                    )}
                  </Text>
                  <Text style={s.cardMeta}>
                    {formatFrequency(item.frequency, t)}
                    {' · '}
                    {t('recurring.nextOn', {
                      date: item.next_occurrence_date,
                    })}
                  </Text>
                </View>
                <View style={s.cardActions}>
                  <Pressable
                    style={[s.addNowBtn, isTriggering && { opacity: 0.6 }]}
                    onPress={() => handleTriggerNow(item)}
                    disabled={isTriggering || isDeleting}
                  >
                    {isTriggering ? (
                      <ActivityIndicator size="small" color={C.bg} />
                    ) : (
                      <Text style={s.addNowText}>{t('recurring.addNow')}</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[s.deleteBtn, isDeleting && { opacity: 0.4 }]}
                    onPress={() => handleDelete(item)}
                    disabled={isTriggering || isDeleting}
                    hitSlop={8}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color={C.red} />
                    ) : (
                      <MaterialIcons
                        name="delete-outline"
                        size={20}
                        color={C.red}
                      />
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 14,
  },
  headerTitle: {
    color: C.white,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    color: C.slate400,
    fontSize: 13,
    marginTop: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: C.white,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    color: C.slate400,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorText: {
    color: C.red,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderRadius: 8,
  },
  retryText: {
    color: C.primary,
    fontWeight: '600',
  },
  addBtn: {
    marginTop: 24,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  addBtnText: {
    color: C.bg,
    fontWeight: '700',
    fontSize: 15,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardDue: {
    borderColor: C.orange,
  },
  cardLeft: {
    flex: 1,
    marginRight: 8,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardDesc: {
    color: C.white,
    fontSize: 15,
    fontWeight: '600',
  },
  duePill: {
    backgroundColor: 'rgba(249,115,22,0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  duePillText: {
    color: C.orange,
    fontSize: 11,
    fontWeight: '700',
  },
  cardAmount: {
    color: C.primary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  cardMeta: {
    color: C.slate400,
    fontSize: 12,
    marginTop: 3,
  },
  cardActions: {
    alignItems: 'center',
    gap: 8,
  },
  addNowBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 76,
    alignItems: 'center',
  },
  addNowText: {
    color: C.bg,
    fontWeight: '700',
    fontSize: 13,
  },
  deleteBtn: {
    padding: 4,
  },
});
