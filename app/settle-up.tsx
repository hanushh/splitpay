import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { settlementEvents } from '@/lib/settlement-events';
import { useSettlement } from '@/hooks/use-settlement';
import {
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

const C = {
  primary: '#17e86b',
  amber: '#f59e0b',
  danger: '#ff5252',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
};

type PaymentMethod = 'cash' | 'venmo' | 'other';

export default function SettleUpScreen() {
  const insets = useSafeAreaInsets();
  const { groupId, groupName, friendName, amountCents, friendMemberId, payerMemberId } =
    useLocalSearchParams<{
      groupId?: string;
      groupName?: string;
      friendName?: string;
      amountCents?: string;
      friendMemberId?: string;
      payerMemberId?: string;
    }>();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [amountInput, setAmountInput] = useState<string>(
    amountCents ? (Number(amountCents) / 100).toFixed(2) : ''
  );

  const { settle, error } = useSettlement();

  const parsedCents = Math.round(parseFloat(amountInput) * 100);
  const isValidAmount = !isNaN(parsedCents) && parsedCents > 0;
  const isOverpayment = amountCents ? parsedCents > Number(amountCents) : false;
  const canSave = isValidAmount && !!friendMemberId && !!groupId && !saving;

  const iThemPay = !!payerMemberId; // they are paying me
  const payeeName = friendName ?? groupName ?? 'your group';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const ok = await settle({
      groupId: groupId!,
      payeeMemberId: friendMemberId!,
      amountCents: parsedCents,
      paymentMethod,
      note: note.trim() || undefined,
      payerMemberId: payerMemberId || undefined,
    });
    setSaving(false);
    if (ok) { settlementEvents.emit(); router.back(); }
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <Text style={s.headerTitle}>Settle Up</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Error banner */}
      {error ? (
        <View style={s.errorBanner}>
          <MaterialIcons name="error-outline" size={16} color={C.white} />
          <Text style={s.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      {/* Missing friendMemberId guard */}
      {!friendMemberId ? (
        <View style={s.errorBanner}>
          <MaterialIcons name="error-outline" size={16} color={C.white} />
          <Text style={s.errorBannerText}>No payee selected. Go back and tap Settle up on a specific member.</Text>
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Amount card */}
        <View style={s.amountCard}>
          <View style={s.checkCircle}>
            <MaterialIcons name="check-circle" size={52} color={C.primary} />
          </View>
          <Text style={s.amountLabel}>{iThemPay ? `${payeeName} paid you` : `You paid ${payeeName}`}</Text>
          <TextInput
            style={s.amountValue}
            value={amountInput}
            onChangeText={setAmountInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={C.slate400}
            selectTextOnFocus
          />
          {isOverpayment && (
            <Text style={s.overpaymentWarning}>This exceeds the outstanding balance</Text>
          )}
          {groupName && (
            <View style={s.groupBadge}>
              <MaterialIcons name="group" size={14} color={C.primary} />
              <Text style={s.groupBadgeText}>{groupName}</Text>
            </View>
          )}
        </View>

        {/* Payment method */}
        <Text style={s.sectionTitle}>PAYMENT METHOD</Text>
        <View style={s.methodList}>
          {([
            { id: 'cash' as const, icon: 'payments', label: 'Record a cash payment', sub: 'No transfer needed' },
            { id: 'venmo' as const, icon: 'account-balance-wallet', label: 'Pay via Venmo/PayPal', sub: 'Open external app' },
          ] as const).map((m) => (
            <Pressable
              key={m.id}
              style={[s.methodCard, paymentMethod === m.id && s.methodCardActive]}
              onPress={() => setPaymentMethod(m.id)}
            >
              <View style={[s.methodIcon, paymentMethod === m.id && s.methodIconActive]}>
                <MaterialIcons name={m.icon} size={22} color={paymentMethod === m.id ? C.bg : C.primary} />
              </View>
              <View style={s.methodInfo}>
                <Text style={[s.methodLabel, paymentMethod === m.id && { color: C.white }]}>{m.label}</Text>
                <Text style={s.methodSub}>{m.sub}</Text>
              </View>
              <View style={[s.radio, paymentMethod === m.id && s.radioActive]}>
                {paymentMethod === m.id && <View style={s.radioDot} />}
              </View>
            </Pressable>
          ))}
        </View>

        {/* Date */}
        <Text style={s.sectionTitle}>DATE</Text>
        <Pressable style={s.infoRow}>
          <MaterialIcons name="calendar-today" size={20} color={C.slate400} />
          <Text style={s.infoText}>{today}</Text>
          <MaterialIcons name="chevron-right" size={20} color={C.slate400} />
        </Pressable>

        {/* Note */}
        <Text style={s.sectionTitle}>NOTE (OPTIONAL)</Text>
        <View style={s.noteRow}>
          <MaterialIcons name="edit-note" size={20} color={C.slate400} />
          <TextInput
            style={s.noteInput}
            placeholder="Add a note…"
            placeholderTextColor={C.slate400}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>

        {/* Receipt */}
        <Pressable style={s.receiptBtn}>
          <MaterialIcons name="add-a-photo" size={20} color={C.slate400} />
          <Text style={s.receiptText}>Add a receipt image</Text>
        </Pressable>
      </ScrollView>

      {/* Save */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.saveBtn,
            (!canSave || pressed) && { opacity: 0.5 },
          ]}
          onPress={handleSave}
          disabled={!canSave}
        >
          <MaterialIcons name="check" size={20} color={C.bg} />
          <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Payment'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 8 },
  backBtn: { padding: 10 },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 18 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#7f1d1d', marginHorizontal: 16, marginBottom: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  errorBannerText: { color: C.white, fontSize: 13, flex: 1 },
  scrollContent: { paddingBottom: 100 },
  amountCard: { alignItems: 'center', margin: 16, backgroundColor: C.surface, borderRadius: 20, padding: 28, gap: 8, borderWidth: 1, borderColor: C.surfaceHL },
  checkCircle: { marginBottom: 4 },
  amountLabel: { color: C.slate400, fontSize: 15 },
  amountValue: { color: C.white, fontSize: 36, fontWeight: '700', textAlign: 'center', minWidth: 120 },
  overpaymentWarning: { color: C.amber, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  groupBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(23,232,107,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 4 },
  groupBadgeText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  sectionTitle: { color: C.slate400, fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, marginTop: 20, marginBottom: 10 },
  methodList: { paddingHorizontal: 16, gap: 10 },
  methodCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: C.surfaceHL },
  methodCardActive: { borderColor: C.primary, backgroundColor: 'rgba(23,232,107,0.06)' },
  methodIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(23,232,107,0.1)', alignItems: 'center', justifyContent: 'center' },
  methodIconActive: { backgroundColor: C.primary },
  methodInfo: { flex: 1 },
  methodLabel: { color: C.slate400, fontWeight: '600', fontSize: 15 },
  methodSub: { color: C.slate500, fontSize: 12, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.slate400, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: C.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.surfaceHL },
  infoText: { flex: 1, color: C.white, fontSize: 15 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.surfaceHL, minHeight: 80 },
  noteInput: { flex: 1, color: C.white, fontSize: 15, textAlignVertical: 'top' },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, margin: 16, marginTop: 12, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: C.surfaceHL, borderStyle: 'dashed' },
  receiptText: { color: C.slate400, fontSize: 14, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.surfaceHL, backgroundColor: C.bg },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16 },
  saveBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
