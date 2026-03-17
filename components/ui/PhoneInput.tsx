import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface Country {
  code: string;
  flag: string;
  name: string;
  dial: string;
}

const PINNED: Country = { code: 'IN', flag: '🇮🇳', name: 'India', dial: '+91' };

const COUNTRIES: Country[] = [
  { code: 'AU', flag: '🇦🇺', name: 'Australia', dial: '+61' },
  { code: 'CA', flag: '🇨🇦', name: 'Canada', dial: '+1' },
  { code: 'FR', flag: '🇫🇷', name: 'France', dial: '+33' },
  { code: 'DE', flag: '🇩🇪', name: 'Germany', dial: '+49' },
  { code: 'ID', flag: '🇮🇩', name: 'Indonesia', dial: '+62' },
  { code: 'JP', flag: '🇯🇵', name: 'Japan', dial: '+81' },
  { code: 'MY', flag: '🇲🇾', name: 'Malaysia', dial: '+60' },
  { code: 'MX', flag: '🇲🇽', name: 'Mexico', dial: '+52' },
  { code: 'NP', flag: '🇳🇵', name: 'Nepal', dial: '+977' },
  { code: 'NZ', flag: '🇳🇿', name: 'New Zealand', dial: '+64' },
  { code: 'NG', flag: '🇳🇬', name: 'Nigeria', dial: '+234' },
  { code: 'PK', flag: '🇵🇰', name: 'Pakistan', dial: '+92' },
  { code: 'PH', flag: '🇵🇭', name: 'Philippines', dial: '+63' },
  { code: 'SG', flag: '🇸🇬', name: 'Singapore', dial: '+65' },
  { code: 'ZA', flag: '🇿🇦', name: 'South Africa', dial: '+27' },
  { code: 'LK', flag: '🇱🇰', name: 'Sri Lanka', dial: '+94' },
  { code: 'AE', flag: '🇦🇪', name: 'UAE', dial: '+971' },
  { code: 'GB', flag: '🇬🇧', name: 'UK', dial: '+44' },
  { code: 'US', flag: '🇺🇸', name: 'US', dial: '+1' },
];

const ALL_COUNTRIES: Country[] = [PINNED, ...COUNTRIES];
const PARSE_ORDER: Country[] = [...ALL_COUNTRIES].sort(
  (a, b) => b.dial.length - a.dial.length
);

interface FormatRule { pattern: number[]; max: number }

const FORMAT_RULES: Record<string, FormatRule> = {
  '+91':  { pattern: [5, 5],    max: 10 },
  '+1':   { pattern: [3, 3, 4], max: 10 },
  '+44':  { pattern: [5, 5],    max: 10 },
  '+971': { pattern: [2, 3, 4], max: 9  },
};

function formatDigits(digits: string, dial: string): string {
  const rule = FORMAT_RULES[dial];
  if (!rule) {
    const d = digits.slice(0, 12);
    return d.replace(/(.{4})(?=.)/g, '$1 ');
  }
  const d = digits.slice(0, rule.max);
  const parts: string[] = [];
  let idx = 0;
  for (const len of rule.pattern) {
    const chunk = d.slice(idx, idx + len);
    if (chunk) parts.push(chunk);
    idx += len;
    if (idx >= d.length) break;
  }
  return parts.join(' ');
}

function maxDigits(dial: string): number {
  return FORMAT_RULES[dial]?.max ?? 12;
}

function parseE164(e164: string): { country: Country; localDigits: string } {
  if (!e164) return { country: PINNED, localDigits: '' };
  const stripped = e164.startsWith('+') ? e164.slice(1) : e164;
  for (const c of PARSE_ORDER) {
    const dialDigits = c.dial.slice(1);
    if (stripped.startsWith(dialDigits)) {
      const country = c.dial === '+1'
        ? COUNTRIES.find(x => x.code === 'US')!
        : c;
      return { country, localDigits: stripped.slice(dialDigits.length) };
    }
  }
  return { country: PINNED, localDigits: stripped };
}

export interface PhoneInputProps {
  value: string;
  onChange: (e164: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

export default function PhoneInput({
  value,
  onChange,
  editable = true,
  autoFocus,
  testID,
}: PhoneInputProps) {
  const parsed = parseE164(value);
  const [country, setCountry] = useState<Country>(parsed.country);
  const [digits, setDigits] = useState<string>(parsed.localDigits);
  const [pickerVisible, setPickerVisible] = useState(false);
  const inputRef = useRef<{ focus(): void } | null>(null);

  useEffect(() => {
    const p = parseE164(value);
    setCountry(p.country);
    setDigits(p.localDigits);
  }, [value]);

  const handleDigitChange = useCallback((text: string) => {
    const raw = text.replace(/\D/g, '').slice(0, maxDigits(country.dial));
    setDigits(raw);
    onChange(raw ? country.dial + raw : '');
  }, [country, onChange]);

  const handleSelectCountry = useCallback((c: Country) => {
    setCountry(c);
    setDigits('');
    onChange('');
    setPickerVisible(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [onChange]);

  const displayValue = formatDigits(digits, country.dial);

  return (
    <View style={s.row}>
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [s.pill, pressed && editable && s.pillPressed]}
        onPress={() => { if (editable) setPickerVisible(true); }}
        testID="phone-pill"
      >
        <Text style={s.pillText} testID="phone-pill-text">
          {country.flag} {country.dial} ▾
        </Text>
      </Pressable>

      <View style={s.divider} />

      <TextInput
        ref={inputRef}
        style={s.input}
        value={displayValue}
        onChangeText={handleDigitChange}
        keyboardType="phone-pad"
        placeholder="98765 43210"
        placeholderTextColor="#64748b"
        editable={editable}
        autoFocus={autoFocus}
        testID={testID}
      />

      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
        testID="country-picker-modal"
      >
        <Pressable style={s.overlay} onPress={() => setPickerVisible(false)} testID="picker-overlay">
          <Pressable style={s.sheet} onPress={() => {}}>
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [s.countryRow, pressed && s.rowPressed]}
              onPress={() => handleSelectCountry(PINNED)}
              testID={`country-${PINNED.name.replace(/\s/g, '')}`}
            >
              <Text style={s.rowFlag}>{PINNED.flag}</Text>
              <Text style={s.rowName}>{PINNED.name}</Text>
              <Text style={s.rowDial}>{PINNED.dial}</Text>
            </Pressable>
            <View style={s.separator} />
            <ScrollView>
              {COUNTRIES.map(item => (
                <Pressable
                  key={item.code}
                  style={({ pressed }: { pressed: boolean }) => [s.countryRow, pressed && s.rowPressed]}
                  onPress={() => handleSelectCountry(item)}
                  testID={`country-${item.name.replace(/\s/g, '')}`}
                >
                  <Text style={s.rowFlag}>{item.flag}</Text>
                  <Text style={s.rowName}>{item.name}</Text>
                  <Text style={s.rowDial}>{item.dial}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const C = {
  surface:   '#1a3324',
  surfaceHL: '#244732',
  white:     '#ffffff',
  slate400:  '#94a3b8',
};

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderWidth: 1.5,
    borderColor: C.surfaceHL,
    borderRadius: 12,
    backgroundColor: C.surface,
    marginBottom: 16,
    overflow: 'hidden',
  },
  pill: {
    paddingHorizontal: 12,
    height: '100%',
    justifyContent: 'center',
  },
  pillPressed: { opacity: 0.7 },
  pillText: {
    color: C.white,
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: '60%',
    backgroundColor: C.surfaceHL,
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    fontSize: 16,
    color: C.white,
    height: '100%',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: 420,
    paddingBottom: 24,
  },
  separator: {
    height: 1,
    backgroundColor: C.surfaceHL,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  rowPressed: { backgroundColor: C.surfaceHL },
  rowFlag: { fontSize: 22 },
  rowName: { flex: 1, color: C.white, fontSize: 15 },
  rowDial: { color: C.slate400, fontSize: 14 },
});
