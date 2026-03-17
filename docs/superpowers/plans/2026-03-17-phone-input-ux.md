# Phone Input UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all plain phone `TextInput` fields in the app with a shared `PhoneInput` component that shows a tappable country-code pill (default 🇮🇳 +91), auto-formats digits, and delivers E.164 strings to the parent.

**Architecture:** One new component `components/ui/PhoneInput.tsx` holds all country/formatting logic. Three screens (`setup-phone`, `sign-up`, `account`) swap their `TextInput` for `<PhoneInput>`. No new npm dependencies. Country picker is a RN `Modal` + `FlatList`.

**Tech Stack:** React Native 0.81.5, Expo ~54, TypeScript strict, Jest 30 + @testing-library/react-native, pnpm.

**Spec:** `docs/superpowers/specs/2026-03-17-phone-input-ux-design.md`

---

## Chunk 1: PhoneInput Component

### Task 1: Write PhoneInput unit tests (red)

**Files:**
- Create: `__tests__/components/ui/PhoneInput.test.tsx`

- [ ] **Step 1: Create test file**

```tsx
// __tests__/components/ui/PhoneInput.test.tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PhoneInput from '@/components/ui/PhoneInput';

describe('PhoneInput', () => {
  it('calls onChange on every digit with dialCode prefix', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <PhoneInput value="" onChange={onChange} testID="phone-input" />
    );
    fireEvent.changeText(getByTestId('phone-input'), '9876543210');
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toBe('+919876543210');
  });

  it('formats +91 digits as XXXXX XXXXX', () => {
    const { getByTestId } = render(
      <PhoneInput value="+919876543210" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('98765 43210');
  });

  it('formats +1 digits as XXX XXX XXXX', () => {
    const { getByTestId } = render(
      <PhoneInput value="+14155551234" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('415 555 1234');
  });

  it('formats unknown dial code as space-every-4', () => {
    const { getByTestId } = render(
      <PhoneInput value="+6112345678" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('1234 5678');
  });

  it('enforces max digits for +91 (10)', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <PhoneInput value="" onChange={onChange} testID="phone-input" />
    );
    // Type 11 digits — only first 10 should be kept
    fireEvent.changeText(getByTestId('phone-input'), '98765432101');
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toBe('+919876543210'); // 10 local digits
  });

  it('calls onChange("") when country changes', async () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <PhoneInput value="+919876543210" onChange={onChange} testID="phone-input" />
    );
    // Open picker and select UAE (+971)
    fireEvent.press(getByTestId('phone-pill'));
    fireEvent.press(getByTestId('country-UAE'));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('parses E.164 value on mount — +91', () => {
    const { getByTestId } = render(
      <PhoneInput value="+919876543210" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-input').props.value).toBe('98765 43210');
    expect(getByTestId('phone-pill-text').props.children).toContain('+91');
  });

  it('parses E.164 value on mount — +1 shows US flag', () => {
    const { getByTestId } = render(
      <PhoneInput value="+14155551234" onChange={jest.fn()} testID="phone-input" />
    );
    expect(getByTestId('phone-pill-text').props.children).toContain('+1');
  });

  it('opens and closes country picker', () => {
    const { getByTestId, queryByTestId } = render(
      <PhoneInput value="" onChange={jest.fn()} testID="phone-input" />
    );
    expect(queryByTestId('country-picker-modal')).toBeNull();
    fireEvent.press(getByTestId('phone-pill'));
    expect(getByTestId('country-picker-modal')).toBeTruthy();
    fireEvent.press(getByTestId('country-India'));
    expect(queryByTestId('country-picker-modal')).toBeNull();
  });

  it('does not open picker when editable=false', () => {
    const { getByTestId, queryByTestId } = render(
      <PhoneInput value="" onChange={jest.fn()} editable={false} testID="phone-input" />
    );
    fireEvent.press(getByTestId('phone-pill'));
    expect(queryByTestId('country-picker-modal')).toBeNull();
  });

  it('overlay dismiss closes picker without changing country', () => {
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <PhoneInput value="+919876543210" onChange={onChange} testID="phone-input" />
    );
    fireEvent.press(getByTestId('phone-pill'));
    expect(getByTestId('country-picker-modal')).toBeTruthy();
    // Press the overlay (not the sheet)
    fireEvent.press(getByTestId('picker-overlay'));
    expect(queryByTestId('country-picker-modal')).toBeNull();
    // onChange was NOT called with '' — country unchanged
    expect(onChange).not.toHaveBeenCalledWith('');
  });

  it('testID is on the digit TextInput', () => {
    const { getByTestId } = render(
      <PhoneInput value="" onChange={jest.fn()} testID="my-phone" />
    );
    // getByTestId finds the TextInput directly
    expect(getByTestId('my-phone').type).toBe('TextInput');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test -- --testPathPattern="PhoneInput" --no-coverage
```
Expected: all tests FAIL with "Cannot find module '@/components/ui/PhoneInput'"

---

### Task 2: Implement PhoneInput component (green)

**Files:**
- Create: `components/ui/PhoneInput.tsx`

- [ ] **Step 3: Create the component**

```tsx
// components/ui/PhoneInput.tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

// ─── Country list ────────────────────────────────────────────────────────────

interface Country {
  code: string;   // ISO-2 used as test key
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

// Ordered by dial-code prefix length descending so we match the longest prefix first
const ALL_COUNTRIES: Country[] = [PINNED, ...COUNTRIES];
const PARSE_ORDER: Country[] = [...ALL_COUNTRIES].sort(
  (a, b) => b.dial.length - a.dial.length
);

// ─── Formatting ──────────────────────────────────────────────────────────────

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
    // Space every 4 digits, max 12
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

// ─── E.164 parsing ───────────────────────────────────────────────────────────

function parseE164(e164: string): { country: Country; localDigits: string } {
  if (!e164) return { country: PINNED, localDigits: '' };
  const stripped = e164.startsWith('+') ? e164.slice(1) : e164;
  for (const c of PARSE_ORDER) {
    const dialDigits = c.dial.slice(1); // remove '+'
    if (stripped.startsWith(dialDigits)) {
      // +1 collision — always show US
      const country = c.dial === '+1'
        ? COUNTRIES.find(x => x.code === 'US')!
        : c;
      return { country, localDigits: stripped.slice(dialDigits.length) };
    }
  }
  return { country: PINNED, localDigits: stripped };
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PhoneInputProps {
  value: string;
  onChange: (e164: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PhoneInput({
  value,
  onChange,
  editable = true,
  autoFocus,
  testID,
}: PhoneInputProps) {
  const parsed = useMemo(() => parseE164(value), [value]);
  const [country, setCountry] = useState<Country>(parsed.country);
  const [digits, setDigits] = useState<string>(parsed.localDigits);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Sync when value prop changes externally (e.g. account.tsx pre-populates)
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    const p = parseE164(value);
    setCountry(p.country);
    setDigits(p.localDigits);
    setPrevValue(value);
  }

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
  }, [onChange]);

  const displayValue = formatDigits(digits, country.dial);

  return (
    <View style={s.row}>
      {/* Country pill */}
      <Pressable
        style={({ pressed }) => [s.pill, pressed && editable && s.pillPressed]}
        onPress={() => editable && setPickerVisible(true)}
        testID="phone-pill"
      >
        <Text style={s.pillText} testID="phone-pill-text">
          {country.flag} {country.dial} ▾
        </Text>
      </Pressable>

      {/* Divider */}
      <View style={s.divider} />

      {/* Digit input */}
      <TextInput
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

      {/* Country picker modal */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
        testID="country-picker-modal"
      >
        <Pressable style={s.overlay} onPress={() => setPickerVisible(false)} testID="picker-overlay">
          <Pressable style={s.sheet} onPress={() => {}}>
            {/* Pinned India row */}
            <Pressable
              style={({ pressed }) => [s.countryRow, pressed && s.rowPressed]}
              onPress={() => handleSelectCountry(PINNED)}
              testID={`country-${PINNED.name.replace(/\s/g, '')}`}
            >
              <Text style={s.rowFlag}>{PINNED.flag}</Text>
              <Text style={s.rowName}>{PINNED.name}</Text>
              <Text style={s.rowDial}>{PINNED.dial}</Text>
            </Pressable>
            <View style={s.separator} />
            <FlatList
              data={COUNTRIES}
              keyExtractor={item => item.code}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [s.countryRow, pressed && s.rowPressed]}
                  onPress={() => handleSelectCountry(item)}
                  testID={`country-${item.name.replace(/\s/g, '')}`}
                >
                  <Text style={s.rowFlag}>{item.flag}</Text>
                  <Text style={s.rowName}>{item.name}</Text>
                  <Text style={s.rowDial}>{item.dial}</Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const C = {
  surface:   '#1a3324',
  surfaceHL: '#244732',
  white:     '#ffffff',
  slate400:  '#94a3b8',
  slate500:  '#64748b',
  primary:   '#17e86b',
  bg:        '#112117',
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
```

- [ ] **Step 4: Run tests — fix until all pass**

```bash
pnpm test -- --testPathPattern="PhoneInput" --no-coverage
```
Expected: all 12 tests PASS. (11 original + 1 overlay dismiss test)

- [ ] **Step 5: Commit**

```bash
git add components/ui/PhoneInput.tsx __tests__/components/ui/PhoneInput.test.tsx
git commit -m "feat: add PhoneInput component with country picker and auto-format"
```

---

## Chunk 2: Screen Integration

### Task 3: Update `app/auth/setup-phone.tsx`

**Files:**
- Modify: `app/auth/setup-phone.tsx`

- [ ] **Step 1: Replace TextInput with PhoneInput**

Remove `TextInput` from imports. Add `PhoneInput` import. Replace the `TextInput` block:

```tsx
// Remove from RN imports: TextInput
// Add import:
import PhoneInput from '@/components/ui/PhoneInput';

// Replace the TextInput element with:
<PhoneInput
  value={phone}
  onChange={setPhone}
  autoFocus
  testID="phone-input"
  editable={!saving}
/>
```

Also remove `marginBottom: 16` from the `input` style in `StyleSheet` (the component handles its own margin) and remove the `input` style entirely since it's no longer used. Remove `TextInput` from the RN import list.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/auth/setup-phone.tsx
git commit -m "feat: use PhoneInput in setup-phone screen"
```

---

### Task 4: Update `app/auth/sign-up.tsx`

**Files:**
- Modify: `app/auth/sign-up.tsx`

- [ ] **Step 1: Fix import and replace TextInput**

```tsx
// Change:
import { normalizePhone } from '@/hooks/use-friends';
// To:
import { normalizePhone } from '@/lib/phone';

// Add import:
import PhoneInput from '@/components/ui/PhoneInput';

// Remove TextInput from RN imports (only if no other TextInput remains — there are none)

// Replace the phone TextInput:
// OLD:
// <TextInput
//   style={s.input}
//   placeholder="Phone number (e.g. +1 555 000 1234)"
//   placeholderTextColor={C.slate500}
//   keyboardType="phone-pad"
//   value={phone}
//   onChangeText={setPhone}
//   testID="phone-input"
// />

// NEW:
<PhoneInput
  value={phone}
  onChange={setPhone}
  editable={!loading && !googleLoading}
  testID="phone-input"
/>
```

Note: `phone` state stays as `useState('')`. `handleSignUp` still calls `normalizePhone(phone)` — this is correct because `PhoneInput` outputs E.164.

Note on `editable` prop: the plan uses `editable={!loading && !googleLoading}` (also disabling during Google sign-in), which is intentionally more complete than the spec's `editable={!loading}`.

Note on `normalizePhone` import: `hooks/use-friends.ts` still imports and re-exports `normalizePhone` from `lib/phone.ts`, so existing test files that import from `@/hooks/use-friends` will continue to pass. No changes to test files are needed.

Also: `sign-up.tsx` has other `TextInput` elements (email, password, confirm password), so keep `TextInput` in the RN import list and keep the `s.input` style.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Run existing auth tests**

```bash
pnpm test -- --testPathPattern="auth" --no-coverage
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add app/auth/sign-up.tsx
git commit -m "feat: use PhoneInput in sign-up screen, fix normalizePhone import"
```

---

### Task 5: Update `app/(tabs)/account.tsx`

**Files:**
- Modify: `app/(tabs)/account.tsx`

- [ ] **Step 1: Replace TextInput in phone modal**

```tsx
// Add import:
import PhoneInput from '@/components/ui/PhoneInput';

// In the phone modal, replace the existing TextInput:
// OLD:
// <TextInput
//   style={s.phoneInput}
//   value={phoneInput}
//   onChangeText={setPhoneInput}
//   ...
// />

// NEW:
<PhoneInput
  value={phoneInput}
  onChange={setPhoneInput}
  autoFocus
  editable={!phoneSaving}
/>
```

`phoneInput` is already pre-populated with `savedPhone ?? ''` when the modal opens (existing `openPhoneModal` function). This means `PhoneInput` will parse the saved E.164 and pre-fill correctly.

Also remove the `<Text style={s.phoneHint}>` hint text element from the modal (the hint "Include country code (e.g. +1 555 000 1234)" is no longer needed since the pill shows the country code). Then remove the `s.phoneHint` style from `StyleSheet`. Also remove the `s.phoneInput` style (no longer used). Remove `TextInput` from the RN import list only if no other `TextInput` remains in the file.

- [ ] **Step 2: Run typecheck + lint**

```bash
pnpm typecheck 2>&1 | tail -5 && pnpm lint 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test --no-coverage
```
Expected: all PASS.

- [ ] **Step 4: Final commit**

```bash
git add app/\(tabs\)/account.tsx
git commit -m "feat: use PhoneInput in account phone modal"
```

---

## Final verification

- [ ] Run `pnpm typecheck && pnpm lint && pnpm test --no-coverage` — all must pass.
- [ ] Manual smoke test on device/emulator:
  1. Sign up → phone field shows 🇮🇳 +91 pill, digit-only input, formats as `XXXXX XXXXX`.
  2. Tap pill → picker opens, India pinned at top, 19 countries below.
  3. Select UAE → pill shows 🇦🇪 +971, field cleared.
  4. Setup-phone screen (new user) → same component, Continue button works.
  5. Account → phone modal shows existing number pre-parsed correctly.
