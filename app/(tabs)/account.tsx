import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { CURRENCIES, Currency, useCurrency } from '@/context/currency';
import PhoneInput from '@/components/ui/PhoneInput';
import { normalizePhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

const C = {
  primary: '#17e86b',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  white: '#ffffff',
  overlay: 'rgba(0,0,0,0.6)',
};

function SettingRow({
  icon,
  label,
  value,
  onPress,
  isDestructive = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  isDestructive?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }: { pressed: boolean }) => [s.row, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <View style={s.rowLeft}>
        <View style={[s.rowIcon, isDestructive && s.rowIconDestructive]}>
          <MaterialIcons name={icon} size={20} color={isDestructive ? '#ff5252' : C.primary} />
        </View>
        <Text style={[s.rowLabel, isDestructive && s.rowLabelDestructive]}>{label}</Text>
      </View>
      {value !== undefined ? (
        <View style={s.rowRight}>
          <Text style={s.rowValue}>{value}</Text>
          <MaterialIcons name="chevron-right" size={20} color={C.slate500} />
        </View>
      ) : (
        <MaterialIcons name="chevron-right" size={20} color={C.slate500} />
      )}
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { currency, setCurrency } = useCurrency();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [phoneModalVisible, setPhoneModalVisible] = useState(false);
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'User';
  const email = user?.email ?? '';
  const avatarLetter = displayName[0]?.toUpperCase() ?? 'U';

  const loadPhone = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('phone')
      .eq('id', user.id)
      .single();
    setSavedPhone(data?.phone ?? null);
  }, [user]);

  useEffect(() => {
    loadPhone();
  }, [loadPhone]);

  const openPhoneModal = () => {
    setPhoneInput(savedPhone ?? '');
    setPhoneError(null);
    setPhoneModalVisible(true);
  };

  const handleSavePhone = async () => {
    if (!user) return;
    const trimmed = phoneInput.trim();
    let normalized: string | null = null;
    if (trimmed) {
      normalized = normalizePhone(trimmed);
      if (!normalized) {
        setPhoneError('Enter a valid phone number (e.g. +1 555 000 1234)');
        return;
      }
    }
    setPhoneSaving(true);
    setPhoneError(null);
    const { error } = await supabase
      .from('profiles')
      .update({ phone: normalized })
      .eq('id', user.id);
    setPhoneSaving(false);
    if (error) {
      setPhoneError(error.message);
    } else {
      setSavedPhone(normalized);
      setPhoneModalVisible(false);
    }
  };

  const handleSelectCurrency = (c: Currency) => {
    setCurrency(c);
    setPickerVisible(false);
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Profile card */}
        <View style={s.profileCard}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarLetter}>{avatarLetter}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.displayName}>{displayName}</Text>
            <Text style={s.emailText}>{email}</Text>
          </View>
        </View>

        {/* Profile */}
        <SectionHeader title="PROFILE" />
        <View style={s.section}>
          <SettingRow
            icon="phone"
            label="Phone Number"
            value={savedPhone ?? 'Add phone number'}
            onPress={openPhoneModal}
          />
        </View>

        {/* Preferences */}
        <SectionHeader title="PREFERENCES" />
        <View style={s.section}>
          <SettingRow
            icon="payments"
            label="Currency"
            value={`${currency.flag} ${currency.code} (${currency.symbol.trim()})`}
            onPress={() => setPickerVisible(true)}
          />
        </View>

        {/* Account */}
        <SectionHeader title="ACCOUNT" />
        <View style={s.section}>
          <SettingRow
            icon="logout"
            label="Sign Out"
            isDestructive
            onPress={signOut}
          />
        </View>
      </ScrollView>

      {/* Phone Number Modal */}
      <Modal
        visible={phoneModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPhoneModalVisible(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setPhoneModalVisible(false)}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Phone Number</Text>
            <PhoneInput
              value={phoneInput}
              onChange={setPhoneInput}
              autoFocus
              editable={!phoneSaving}
            />
            {phoneError ? <Text style={s.phoneErrorText}>{phoneError}</Text> : null}
            <TouchableOpacity
              style={[s.saveButton, phoneSaving && { opacity: 0.6 }]}
              onPress={handleSavePhone}
              disabled={phoneSaving}
              activeOpacity={0.8}
            >
              {phoneSaving ? (
                <ActivityIndicator color={C.bg} size="small" />
              ) : (
                <Text style={s.saveButtonText}>Save</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Currency Picker Modal */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setPickerVisible(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Select Currency</Text>
            <FlatList
              data={CURRENCIES}
              keyExtractor={(item: Currency) => item.code}
              renderItem={({ item }: { item: Currency }) => {
                const isSelected = item.code === currency.code;
                return (
                  <TouchableOpacity
                    style={[s.currencyRow, isSelected && s.currencyRowSelected]}
                    onPress={() => handleSelectCurrency(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.currencyFlag}>{item.flag}</Text>
                    <View style={s.currencyInfo}>
                      <Text style={[s.currencyCode, isSelected && s.currencyCodeSelected]}>
                        {item.code}
                      </Text>
                      <Text style={s.currencyName}>{item.name}</Text>
                    </View>
                    <Text style={[s.currencySymbol, isSelected && s.currencySymbolSelected]}>
                      {item.symbol.trim()}
                    </Text>
                    {isSelected && (
                      <MaterialIcons name="check" size={20} color={C.primary} style={{ marginLeft: 8 }} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={s.separator} />}
              scrollEnabled={false}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    paddingHorizontal: 20,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 24,
    marginBottom: 32,
    backgroundColor: '#1a3324',
    borderRadius: 16,
    padding: 20,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#244732',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.primary,
  },
  avatarLetter: {
    color: C.primary,
    fontSize: 26,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
    gap: 4,
  },
  displayName: {
    color: C.white,
    fontSize: 18,
    fontWeight: '700',
  },
  emailText: {
    color: C.slate400,
    fontSize: 13,
  },
  sectionHeader: {
    color: C.slate500,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 4,
    paddingLeft: 4,
  },
  section: {
    backgroundColor: '#1a3324',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#244732',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDestructive: {
    backgroundColor: 'rgba(255,82,82,0.12)',
  },
  rowLabel: {
    color: C.white,
    fontSize: 15,
    fontWeight: '500',
  },
  rowLabelDestructive: {
    color: '#ff5252',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowValue: {
    color: C.slate400,
    fontSize: 14,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a3324',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surfaceHL,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: C.white,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  currencyRowSelected: {
    backgroundColor: 'rgba(23,232,107,0.08)',
  },
  currencyFlag: {
    fontSize: 26,
    marginRight: 14,
  },
  currencyInfo: {
    flex: 1,
  },
  currencyCode: {
    color: C.white,
    fontSize: 15,
    fontWeight: '600',
  },
  currencyCodeSelected: {
    color: C.primary,
  },
  currencyName: {
    color: C.slate400,
    fontSize: 12,
    marginTop: 1,
  },
  currencySymbol: {
    color: C.slate400,
    fontSize: 14,
    fontWeight: '500',
  },
  currencySymbolSelected: {
    color: C.primary,
  },
  separator: {
    height: 1,
    backgroundColor: '#244732',
    marginHorizontal: 4,
  },
  phoneErrorText: {
    color: '#ff5252',
    fontSize: 13,
    marginBottom: 8,
  },
  saveButton: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: C.bg,
    fontSize: 16,
    fontWeight: '700',
  },
});
