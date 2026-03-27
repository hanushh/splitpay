import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { CURRENCIES, Currency, useCurrency } from '@/context/currency';
import { useToast } from '@/context/toast';
import { useRecurringPayments, RecurringFrequency } from '@/hooks/use-recurring-payments';
import { supabase } from '@/lib/supabase';

const C = {
  primary: '#17e86b',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
  red: '#ef4444',
};

interface Member {
  id: string;
  display_name: string | null;
  user_id: string | null;
}

const FREQUENCIES: RecurringFrequency[] = ['weekly', 'monthly', 'yearly'];

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

export default function CreateRecurringPaymentScreen() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { currency: appCurrency } = useCurrency();

  const { groupId, groupName } = useLocalSearchParams<{
    groupId: string;
    groupName?: string;
  }>();

  const { createRecurringExpense } = useRecurringPayments(groupId);

  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(appCurrency);
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [members, setMembers] = useState<Member[]>([]);
  const [paidByMemberId, setPaidByMemberId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    if (!groupId) return;
    supabase
      .from('group_members')
      .select('id, display_name, user_id')
      .eq('group_id', groupId)
      .then(({ data }) => {
        const list = (data ?? []) as Member[];
        setMembers(list);
        const me = list.find((m) => m.user_id === user?.id);
        setPaidByMemberId(me?.id ?? list[0]?.id ?? null);
        setLoadingMembers(false);
      });
  }, [groupId, user?.id]);

  const handleSave = useCallback(async () => {
    const parsedCents = Math.round(parseFloat(amountInput) * 100);
    if (!description.trim()) {
      showToast('error', t('recurring.errorDescription'));
      return;
    }
    if (isNaN(parsedCents) || parsedCents <= 0) {
      showToast('error', t('recurring.errorAmount'));
      return;
    }
    if (!startDate) {
      showToast('error', t('recurring.errorDate'));
      return;
    }
    setSaving(true);
    const ok = await createRecurringExpense({
      groupId,
      description: description.trim(),
      amountCents: parsedCents,
      currencyCode: selectedCurrency.code,
      category: 'other',
      paidByMemberId,
      frequency,
      nextOccurrenceDate: startDate,
    });
    setSaving(false);
    if (ok) {
      showToast('success', t('recurring.created'));
      router.back();
    }
  }, [
    description,
    amountInput,
    selectedCurrency,
    frequency,
    startDate,
    paidByMemberId,
    groupId,
    createRecurringExpense,
    showToast,
    t,
  ]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="close" size={24} color={C.white} />
        </Pressable>
        <Text style={s.headerTitle}>{t('recurring.newTitle')}</Text>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          hitSlop={12}
        >
          {saving ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <Text style={s.headerSave}>{t('common.save')}</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {groupName ? (
          <Text style={s.groupLabel}>{groupName}</Text>
        ) : null}

        {/* Description */}
        <Text style={s.label}>{t('recurring.descriptionLabel')}</Text>
        <TextInput
          style={s.input}
          value={description}
          onChangeText={setDescription}
          placeholder={t('recurring.descriptionPlaceholder')}
          placeholderTextColor={C.slate500}
          returnKeyType="next"
        />

        {/* Amount + Currency */}
        <Text style={s.label}>{t('recurring.amountLabel')}</Text>
        <View style={s.row}>
          <TextInput
            style={[s.input, { flex: 1, marginRight: 8 }]}
            value={amountInput}
            onChangeText={setAmountInput}
            placeholder="0.00"
            placeholderTextColor={C.slate500}
            keyboardType="decimal-pad"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.currencyScroll}
          >
            {CURRENCIES.map((c) => (
              <Pressable
                key={c.code}
                style={[
                  s.chip,
                  selectedCurrency.code === c.code && s.chipActive,
                ]}
                onPress={() => setSelectedCurrency(c)}
              >
                <Text
                  style={[
                    s.chipText,
                    selectedCurrency.code === c.code && s.chipTextActive,
                  ]}
                >
                  {c.code}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Frequency */}
        <Text style={s.label}>{t('recurring.frequencyLabel')}</Text>
        <View style={s.row}>
          {FREQUENCIES.map((f) => (
            <Pressable
              key={f}
              style={[s.freqBtn, frequency === f && s.freqBtnActive]}
              onPress={() => setFrequency(f)}
            >
              <Text
                style={[
                  s.freqBtnText,
                  frequency === f && s.freqBtnTextActive,
                ]}
              >
                {t(`recurring.frequency_${f}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Start date (manual text input – YYYY-MM-DD) */}
        <Text style={s.label}>{t('recurring.startDateLabel')}</Text>
        <TextInput
          style={s.input}
          value={startDate}
          onChangeText={setStartDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={C.slate500}
          keyboardType="numbers-and-punctuation"
        />

        {/* Paid by */}
        <Text style={s.label}>{t('expense.paidBy')}</Text>
        {loadingMembers ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 8 }} />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.memberScroll}
          >
            {members.map((m) => (
              <Pressable
                key={m.id}
                style={[
                  s.memberChip,
                  paidByMemberId === m.id && s.memberChipActive,
                ]}
                onPress={() => setPaidByMemberId(m.id)}
              >
                <Text
                  style={[
                    s.memberChipText,
                    paidByMemberId === m.id && s.memberChipTextActive,
                  ]}
                >
                  {m.display_name ?? t('expense.unknown')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={s.splitHint}>{t('recurring.splitHint')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    color: C.white,
    fontSize: 17,
    fontWeight: '600',
  },
  headerSave: {
    color: C.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  groupLabel: {
    color: C.slate400,
    fontSize: 13,
    marginBottom: 16,
  },
  label: {
    color: C.slate400,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.surface,
    color: C.white,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencyScroll: {
    flexShrink: 1,
  },
  chip: {
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    borderColor: C.primary,
    backgroundColor: C.surfaceHL,
  },
  chipText: {
    color: C.slate400,
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: C.primary,
  },
  freqBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  freqBtnActive: {
    borderColor: C.primary,
    backgroundColor: C.surfaceHL,
  },
  freqBtnText: {
    color: C.slate400,
    fontSize: 13,
    fontWeight: '500',
  },
  freqBtnTextActive: {
    color: C.primary,
  },
  memberScroll: {
    flexShrink: 1,
  },
  memberChip: {
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  memberChipActive: {
    borderColor: C.primary,
    backgroundColor: C.surfaceHL,
  },
  memberChipText: {
    color: C.slate400,
    fontSize: 14,
  },
  memberChipTextActive: {
    color: C.primary,
  },
  splitHint: {
    color: C.slate500,
    fontSize: 12,
    marginTop: 12,
  },
});
