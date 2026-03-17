import * as Contacts from 'expo-contacts';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import PhoneInput from '@/components/ui/PhoneInput';
import { normalizePhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  primary: '#17e86b',
  danger: '#ff5252',
  white: '#ffffff',
  slate400: '#94a3b8',
  slate500: '#64748b',
};

export default function SetupPhoneScreen() {
  const { user, refreshPhoneComplete } = useAuth();
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const normalized = normalizePhone(phone.trim());
    if (!normalized) {
      setError('Enter a valid phone number (e.g. +91 98765 43210).');
      return;
    }
    if (!user) return;

    setError(null);
    setSaving(true);
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ phone: normalized })
      .eq('id', user.id);
    setSaving(false);

    if (dbErr) {
      setError(dbErr.message);
      return;
    }

    await refreshPhoneComplete();
    const { status } = await Contacts.getPermissionsAsync();
    router.replace(
      status === Contacts.PermissionStatus.GRANTED ? '/(tabs)' : '/auth/setup-contacts'
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <View style={s.inner}>
        <View style={s.logoMark}>
          <Text style={s.logoText}>S</Text>
        </View>
        <Text style={s.title}>Add your phone number</Text>
        <Text style={s.subtitle}>
          Your phone number helps friends find you on PaySplit. This is required to continue.
        </Text>

        {error && <Text style={s.errorText}>{error}</Text>}

        <PhoneInput
          value={phone}
          onChange={setPhone}
          autoFocus
          testID="phone-input"
          editable={!saving}
        />

        <Pressable
          style={({ pressed }: { pressed: boolean }) => [s.saveBtn, (saving || pressed) && s.btnPressed]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <Text style={s.saveBtnText}>Continue</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    alignSelf: 'center',
  },
  logoText: {
    color: C.bg,
    fontSize: 32,
    fontWeight: '800',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: C.white,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: C.slate400,
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorText: {
    color: C.danger,
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  saveBtn: {
    height: 52,
    backgroundColor: C.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: C.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.75,
  },
});
