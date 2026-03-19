# Phone Input UX — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Problem

All phone inputs in the app are plain `TextInput` fields. Users must manually type the full E.164 number (e.g. `+91 98765 43210`), which is error-prone and unfriendly. The app is primarily used in India but has some international users.

---

## Solution

Replace every phone `TextInput` with a new shared `PhoneInput` component. It renders an inline country-code pill and a digit-only field side by side, auto-formats as the user types, and always delivers a raw E.164 string to the parent.

---

## Component: `components/ui/PhoneInput.tsx`

### Props

```ts
interface PhoneInputProps {
  value: string; // E.164 (e.g. "+919876543210") or empty string
  onChange: (e164: string) => void; // called on EVERY digit change, even partial
  editable?: boolean; // default true; false disables both pill and input
  autoFocus?: boolean;
  testID?: string; // forwarded to the digit TextInput only
}
```

**`onChange` firing rule:** called unconditionally on every digit change (including deletion, including partial/invalid numbers). The parent decides what to do with the value at submission time. `onChange` is never suppressed.

**`value` on mount / prop update:** When `value` is a non-empty E.164 string, parse it into country-code and local-digit parts and pre-populate the pill and digit field:

1. Strip the leading `+`.
2. Try to match `+971`, `+977`, `+234`, `+64` (4-digit codes) first, then `+91`, `+61`, `+81`, `+60`, `+52`, `+92`, `+63`, `+65`, `+27`, `+94`, `+44`, `+49`, `+33`, `+62` (2–3-digit codes), then `+1` last (shortest).
3. Remainder after the dial code prefix = local digits.
4. If no match, default to `+91` pill and show the raw digits.
5. **`+1` (US / CA) collision:** when a `+1` number is parsed, always display the **US** 🇺🇸 flag in the pill. Canada is available to select in the picker but `+1` numbers are always displayed as US on load. This is a known simplification.

### Layout

```
┌─────────────────────────────────────────────┐
│  🇮🇳 +91  ▾  │  98765 43210                │
└─────────────────────────────────────────────┘
```

- **Left pill** (`Pressable`): flag emoji + dial code + `▾` chevron. Tapping opens the country bottom sheet. When `editable={false}`, the pill is not pressable.
- **Vertical divider** (1 px, `surfaceHL` colour).
- **Right field** (`TextInput`): `keyboardType="phone-pad"`, shows only the local digits, formatted. Receives the `testID` prop. When `editable={false}`, `editable={false}` is passed to the TextInput.

### Default country

India (`🇮🇳 +91`) is the default when `value` is empty.

### Auto-formatting rules

The formatting switch keys on the **dial code string** (e.g. `'+91'`), regardless of which country was selected. Canada and US both use dial code `'+1'` and therefore both use the `+1` format.

| Dial code string                                          | Local format pattern | Max local digits |
| --------------------------------------------------------- | -------------------- | ---------------- |
| `'+91'` (India)                                           | `XXXXX XXXXX`        | 10               |
| `'+1'` (US and Canada)                                    | `XXX XXX XXXX`       | 10               |
| `'+44'` (UK)                                              | `XXXXX XXXXX`        | 10               |
| `'+971'` (UAE)                                            | `XX XXX XXXX`        | 9                |
| All others (incl. `'+977'` Nepal, `'+234'` Nigeria, etc.) | space every 4 digits | 12               |

Nepal (`+977`) and all other countries not in the table intentionally fall through to the "space every 4 digits / max 12" fallback. This is acceptable.

On every digit change: strip non-digits from input, truncate to max digits for the active dial code, apply the pattern, display the formatted string, call `onChange(dialCode + strippedDigits)`.

### Country change behaviour

When the user selects a new country from the picker:

1. Update the pill to the new country.
2. Clear the digit field to empty.
3. Call `onChange('')`.
4. Close the bottom sheet.
5. Focus the digit `TextInput`.

### Country picker bottom sheet

- Renders using RN `Modal` (transparent) + `FlatList`. No external dependency.
- Semi-transparent overlay (`rgba(0,0,0,0.5)`) fills the screen; the sheet itself is a bottom-anchored `View`.
- **Dismissal:** tapping the overlay outside the sheet OR pressing the Android hardware back button closes the sheet without making any change (country and digits are unchanged).
- **Pinned row** at the very top (above a hairline separator): India 🇮🇳 +91.
- 19 additional countries listed alphabetically below:
  Australia 🇦🇺 +61, Canada 🇨🇦 +1, France 🇫🇷 +33, Germany 🇩🇪 +49, Indonesia 🇮🇩 +62, Japan 🇯🇵 +81, Malaysia 🇲🇾 +60, Mexico 🇲🇽 +52, Nepal 🇳🇵 +977, New Zealand 🇳🇿 +64, Nigeria 🇳🇬 +234, Pakistan 🇵🇰 +92, Philippines 🇵🇭 +63, Singapore 🇸🇬 +65, South Africa 🇿🇦 +27, Sri Lanka 🇱🇰 +94, UAE 🇦🇪 +971, UK 🇬🇧 +44, US 🇺🇸 +1.
- Each row: `flag  Country name  +dialCode` (right-aligned dial code).
- Tap a row → triggers country change behaviour above.
- Styled with app theme (`surface` bg, white text, `primary` highlight on press).

---

## Integration Points

### `app/auth/setup-phone.tsx`

Replace the existing `TextInput` with:

```tsx
<PhoneInput
  value={phone}
  onChange={setPhone}
  autoFocus
  testID="phone-input"
  editable={!saving}
/>
```

`phone` state remains `useState('')`. At submission `normalizePhone(phone)` is called for validation.

### `app/auth/sign-up.tsx`

Same pattern. Also update the `normalizePhone` import from `@/hooks/use-friends` → `@/lib/phone`:

```tsx
import { normalizePhone } from '@/lib/phone';
// ...
<PhoneInput
  value={phone}
  onChange={setPhone}
  autoFocus
  testID="phone-input"
  editable={!loading}
/>;
```

### `app/(tabs)/account.tsx`

Replace the `TextInput` inside the phone edit modal:

```tsx
<PhoneInput
  value={phoneInput}
  onChange={setPhoneInput}
  editable={!phoneSaving}
/>
```

`phoneInput` is the existing `useState('')` state (pre-populated with `savedPhone ?? ''` when the modal opens, as already implemented). At submission `normalizePhone(phoneInput)` is called.

---

## `normalizePhone` compatibility

`normalizePhone` in `lib/phone.ts` accepts any string, strips non-digits, and validates based on length. **No change to `normalizePhone` is required.** Here is why:

`PhoneInput.onChange` always produces either `''` (empty, when the digit field is blank) or a full E.164 string of the form `dialCode + localDigits` (e.g. `+919876543210`, `+14155551234`). It **never** produces a bare 10-digit string without a country prefix. This is the key guarantee.

The only risky branch in `normalizePhone` is the 10-digit-with-leading-`1` branch, which prepends `DEFAULT_COUNTRY_CODE` (`+1`). That branch can only be reached when the input string contains exactly 10 digits and the first digit is `1`. Since `PhoneInput` always prepends the dial code, the minimum digit count in `onChange` output is `dialCode-digits + 1` (at least 8 total) — and a full valid number is 11+ digits. The 10-digit bare path is **unreachable** from `PhoneInput`-controlled state. `DEFAULT_COUNTRY_CODE = '+1'` therefore has no effect on any screen that uses `PhoneInput`.

---

## Styling

- Outer container border: `surfaceHL` (#244732), 1.5 px, radius 12
- Background: `surface` (#1a3324)
- Pill text / digit text: white (#ffffff)
- Placeholder digit text: `slate500` (#64748b)
- Chevron icon: `slate400` (#94a3b8)
- Height: 52 px (matches existing inputs)
- When `editable={false}`: `opacity: 0.5` on the entire row container

---

## Testing (`__tests__/components/ui/PhoneInput.test.tsx`)

1. **onChange fires on every digit** — type `9876543210` with +91 active; assert `onChange` was called 10 times total; assert the final call was `onChange('+919876543210')`. Intermediate calls are verified by count only, not by value.
2. **Formatting for +91** — after entering `9876543210`, the displayed digit field value is `'98765 43210'`.
3. **Formatting for +1** — after entering `4155551234`, the displayed value is `'415 555 1234'`.
4. **Fallback formatting** — for an unknown dial code, 8 digits `12345678` display as `'1234 5678'`.
5. **Max digit enforcement** — with +91 active, typing an 11th digit does not change the displayed value or call `onChange` with 11 local digits.
6. **Country change clears field** — select UAE after entering +91 digits; assert displayed digits are empty and `onChange` was last called with `''`.
7. **E.164 value prop parsed on mount** — `value="+919876543210"` renders pill as 🇮🇳 +91, digit field as `98765 43210`.
8. **`+1` collision displays US** — `value="+14155551234"` renders 🇺🇸 in the pill.
9. **Country picker open / close** — pressing the pill renders the modal; pressing a country row closes it and updates the pill.
10. **Overlay dismiss** — pressing the overlay outside the sheet closes it without changing the selected country.
11. **`editable={false}`** — pill press does nothing; `TextInput` is not editable.
12. **`testID` forwarded** — `testID="phone-input"` is on the digit `TextInput`, not the container.

---

## Out of Scope

- Full 200-country list (19-country curated list; expand later).
- SMS OTP verification.
- Phone number portability detection.
- Search within the country picker.
