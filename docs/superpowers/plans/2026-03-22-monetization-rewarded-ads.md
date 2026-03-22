# Monetization: Rewarded Ads with Scratch Card Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rewarded-ad monetisation layer to cover Supabase hosting costs (~$30–40/month). After a user successfully settles a debt, a scratch-card screen appears. The user watches a short rewarded video ad to reveal a real affiliate coupon from a brand partner. No virtual currency, no wallet — the reward is a genuine discount code, immediately actionable.

**Revenue model (dual stream):**
1. **AdMob rewarded video** — CPM $10–25, ~90% completion rate, paid per completed view
2. **Affiliate commission** — 2–8% of sale value when user redeems the coupon via the tracking link

**User flow:**
```
settle-up.tsx  →  record_settlement RPC succeeds
             →  router.replace('/scratch-card')
             →  ScratchCardScreen fetches a coupon from Supabase (pre-loaded)
             →  Covered card shown, "Watch a short ad to reveal" button
             →  Rewarded ad plays (Google AdMob rewarded)
             →  On reward callback → overlay fades, card becomes scratchable
             →  User scratches to reveal:
                  - Brand logo
                  - Discount text (e.g. "20% off at Swiggy")
                  - Coupon code
                  - [Redeem Now →] button (affiliate tracking URL)
                  - [Copy Code] button
             →  "Done" returns to group screen
```

**No coins.** No coin balance, no coin hook, no wallet UI.

**Affiliate networks (region-aware mix):**

| Region | Network | Key Brands |
|--------|---------|------------|
| India (`IN`) | Cuelinks | Flipkart, Amazon IN, Myntra, Swiggy |
| India (`IN`) | vCommission | Zomato, MakeMyTrip, Nykaa |
| India (`IN`) | EarnKaro | Amazon IN, Meesho, Ajio |
| Global (`GLOBAL`) | Impact | Uber Eats, Booking.com, Nike, Adidas |
| Global (`GLOBAL`) | CJ Affiliate | Expedia, Dell, GoPro |
| Middle East (`AE`) | Admitad | Noon, Namshi, Careem |

**Rollout strategy:** Launch with **Cuelinks** (India) + hardcoded `GLOBAL` fallback coupons. Add Impact/CJ/Admitad once approved — flip `region` in the table, no app update needed.

**Region detection:** Device locale (`expo-localization`) → `regionCode` (e.g. `IN`, `US`, `AE`). Falls back to `'GLOBAL'`. Coupons shown are `WHERE region = p_region OR region = 'GLOBAL'`, weighted by `priority`.

**Tech Stack:** React Native 0.81 + Expo ~54, Google AdMob (`react-native-google-mobile-ads`), Supabase (coupon table + RPC), TypeScript strict, Expo Router, pnpm

---

## Chunk 1: Install AdMob SDK

### Task 1: Add dependency

**Files:**
- Modify: `package.json` (via pnpm)
- Modify: `app.json` — add AdMob app ID to `expo.plugins`

- [ ] **Step 1: Install react-native-google-mobile-ads**

```bash
pnpm add react-native-google-mobile-ads
```

- [ ] **Step 2: Configure app.json plugin**

Add to `app.json` under `expo.plugins`:

```json
[
  "react-native-google-mobile-ads",
  {
    "androidAppId": "ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX"
  }
]
```

> Note: Replace with real AdMob app ID. Use test IDs (`ca-app-pub-3940256099942544~3347511713`) during development.

---

## Chunk 2: Database — Coupon Table

### Task 2: Create the migration file

**Files:**
- Create: `supabase/migrations/20260322100000_add_coupons.sql`

The `coupons` table stores affiliate coupon inventory pre-loaded by the developer. Each row is one coupon offer from a brand. Coupons can be shared (one code used by many users) or single-use — the `single_use` flag controls this.

**New columns vs. original plan:**
- `region` — ISO country code (`'IN'`, `'US'`, `'AE'`) or `'GLOBAL'` for region-agnostic coupons. Coupons are served when `region = user_region OR region = 'GLOBAL'`.
- `priority` — integer weight (1–10). Higher priority coupons are picked more often via weighted random selection.

The `claim_coupon(p_region)` RPC accepts the user's detected region, filters eligible coupons, picks one via weighted random, and for single-use coupons marks it claimed.

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260322100000_add_coupons.sql

CREATE TABLE public.coupons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name      TEXT        NOT NULL,
  brand_logo_url  TEXT,
  discount_text   TEXT        NOT NULL,   -- e.g. "20% off your next order"
  code            TEXT        NOT NULL,
  tracking_url    TEXT        NOT NULL,   -- affiliate deep link / tracking URL
  region          TEXT        NOT NULL DEFAULT 'GLOBAL', -- 'IN', 'US', 'AE', 'GLOBAL', etc.
  priority        INTEGER     NOT NULL DEFAULT 5,        -- 1 (low) – 10 (high), used for weighted pick
  single_use      BOOLEAN     NOT NULL DEFAULT false,
  claimed_by      UUID        REFERENCES public.profiles(id),
  active          BOOLEAN     NOT NULL DEFAULT true,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only the service role can insert/update coupons (developer manages inventory)
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read active coupons"
  ON public.coupons FOR SELECT
  TO authenticated
  USING (active = true AND (expires_at IS NULL OR expires_at > NOW()));

-- RPC: claim_coupon
-- p_region: ISO country code from client (e.g. 'IN', 'US') or 'GLOBAL'
-- Returns a weighted-random active coupon matching the user's region or GLOBAL.
-- For single-use coupons, marks claimed_by.
-- SECURITY DEFINER so it can update claimed_by regardless of RLS.
CREATE OR REPLACE FUNCTION public.claim_coupon(p_region TEXT DEFAULT 'GLOBAL')
RETURNS TABLE (
  id              UUID,
  brand_name      TEXT,
  brand_logo_url  TEXT,
  discount_text   TEXT,
  code            TEXT,
  tracking_url    TEXT,
  region          TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon public.coupons%ROWTYPE;
BEGIN
  -- Pick a weighted-random active coupon matching region or GLOBAL,
  -- not already claimed by this user.
  -- Weighted random: ORDER BY -log(RANDOM()) / priority (Efraimidis-Spirakis reservoir trick).
  SELECT * INTO v_coupon
  FROM public.coupons
  WHERE active = true
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (region = p_region OR region = 'GLOBAL')
    AND (single_use = false OR claimed_by IS NULL)
    AND (claimed_by IS DISTINCT FROM auth.uid())
  ORDER BY -ln(RANDOM()) / priority
  LIMIT 1;

  IF v_coupon.id IS NULL THEN
    RETURN; -- empty result set — caller handles gracefully
  END IF;

  -- Mark single-use coupons as claimed
  IF v_coupon.single_use THEN
    UPDATE public.coupons
    SET claimed_by = auth.uid()
    WHERE id = v_coupon.id;
  END IF;

  RETURN QUERY SELECT
    v_coupon.id,
    v_coupon.brand_name,
    v_coupon.brand_logo_url,
    v_coupon.discount_text,
    v_coupon.code,
    v_coupon.tracking_url,
    v_coupon.region;
END;
$$;
```

- [ ] **Step 2: Regenerate Supabase TypeScript types**

```bash
# See .agents/workflows/update-supabase-types.md
```

---

## Chunk 3: Region Detection Utility

### Task 3: Create `lib/detect-region.ts`

**Files:**
- Create: `lib/detect-region.ts`

Reads the device locale via `expo-localization` and returns an ISO country code (e.g. `'IN'`, `'US'`, `'AE'`). Falls back to `'GLOBAL'` if the region cannot be determined.

- [ ] **Step 1: Implement the utility**

```typescript
// lib/detect-region.ts
import * as Localization from 'expo-localization';

/**
 * Returns an ISO 3166-1 alpha-2 country code derived from the device locale
 * (e.g. 'IN', 'US', 'AE'), or 'GLOBAL' if the region cannot be determined.
 * Used to filter affiliate coupons to the user's market.
 */
export function detectRegion(): string {
  const locale = Localization.getLocales()[0];
  return locale?.regionCode ?? 'GLOBAL';
}
```

> **Note:** `expo-localization` is already in the project (included with Expo). No new dependency needed.

---

## Chunk 4: Coupon Hook

### Task 4: Create `hooks/use-coupon.ts`

**Files:**
- Create: `hooks/use-coupon.ts`

The hook detects the user's region and passes it to `claim_coupon(p_region)`. This ensures Indian users receive Indian brand coupons, while users elsewhere get GLOBAL coupons (or their own regional ones once those networks are onboarded).

- [ ] **Step 1: Implement the hook**

```typescript
// hooks/use-coupon.ts
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { detectRegion } from '@/lib/detect-region';

export interface Coupon {
  id: string;
  brand_name: string;
  brand_logo_url: string | null;
  discount_text: string;
  code: string;
  tracking_url: string;
  region: string;
}

interface UseCouponReturn {
  coupon: Coupon | null;
  loading: boolean;
  error: string | null;
  claim: () => Promise<void>;
}

export function useCoupon(): UseCouponReturn {
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const region = detectRegion();
      const { data, error: rpcError } = await supabase.rpc('claim_coupon', {
        p_region: region,
      });
      if (rpcError) throw rpcError;
      setCoupon((data as Coupon[])?.[0] ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { coupon, loading, error, claim };
}
```

---

## Chunk 5: Rewarded Ad Hook

### Task 5: Create `hooks/use-rewarded-ad.ts`

**Files:**
- Create: `hooks/use-rewarded-ad.ts`

- [ ] **Step 1: Implement the hook**

```typescript
// hooks/use-rewarded-ad.ts
import { useEffect, useState, useCallback } from 'react';
import {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

const AD_UNIT_ID = __DEV__
  ? TestIds.REWARDED
  : 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX'; // replace with real unit ID

interface UseRewardedAdReturn {
  loaded: boolean;
  loading: boolean;
  show: () => void;
  earned: boolean;
  error: string | null;
}

export function useRewardedAd(onEarned: () => void): UseRewardedAdReturn {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [earned, setEarned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ad] = useState(() => RewardedAd.createForAdRequest(AD_UNIT_ID));

  useEffect(() => {
    setLoading(true);
    const unsubLoad = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      setLoaded(true);
      setLoading(false);
    });
    const unsubEarned = ad.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        setEarned(true);
        onEarned();
      },
    );
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, (err) => {
      setError(err.message);
      setLoading(false);
    });
    ad.load();
    return () => {
      unsubLoad();
      unsubEarned();
      unsubError();
    };
  }, [ad, onEarned]);

  const show = useCallback(() => {
    if (loaded) ad.show();
  }, [ad, loaded]);

  return { loaded, loading, show, earned, error };
}
```

---

## Chunk 6: Scratch Card Screen

### Task 6: Create `app/scratch-card.tsx`

**Files:**
- Create: `app/scratch-card.tsx`
- Modify: `app/_layout.tsx` — register modal route

The screen has three visual states:

1. **Locked** — card face covered, "Watch a short ad to reveal" button visible. Coupon is fetched from Supabase in the background while the user decides.
2. **Unlocked** — overlay fades out, "Scratch to reveal!" hint appears. User scratches with finger.
3. **Scratched** — coupon revealed: brand name, discount text, code, Redeem and Copy buttons.

**Fallback:** if `claim_coupon` returns no rows (inventory empty), show a fun string instead of a coupon — no broken state.

- [ ] **Step 1: Implement scratch-card screen**

```typescript
// app/scratch-card.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
  Animated,
  Linking,
  Clipboard,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/colors';
import { useRewardedAd } from '@/hooks/use-rewarded-ad';
import { useCoupon } from '@/hooks/use-coupon';

export default function ScratchCardScreen() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const colors = Colors[colorScheme];

  const [revealed, setRevealed] = useState(false);
  const [scratched, setScratched] = useState(false);
  const [copied, setCopied] = useState(false);

  const overlayOpacity = useRef(new Animated.Value(1)).current;

  const { coupon, loading: couponLoading, claim } = useCoupon();

  // Pre-fetch coupon as soon as screen mounts
  useEffect(() => {
    claim();
  }, [claim]);

  const handleEarned = useCallback(() => {
    setRevealed(true);
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [overlayOpacity]);

  const { loaded, loading: adLoading, show, error: adError } = useRewardedAd(handleEarned);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => revealed,
      onPanResponderMove: () => {
        if (revealed && !scratched) setScratched(true);
      },
    }),
  ).current;

  const handleCopy = useCallback(() => {
    if (!coupon) return;
    Clipboard.setString(coupon.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [coupon]);

  const handleRedeem = useCallback(() => {
    if (!coupon) return;
    Linking.openURL(coupon.tracking_url);
  }, [coupon]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.white }]}>
        {t('scratchCard.title')}
      </Text>

      {/* Card */}
      <View style={styles.cardWrapper} {...panResponder.panHandlers}>
        {/* Coupon content — rendered below overlay */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {scratched ? (
            coupon ? (
              <View style={styles.couponContent}>
                {coupon.brand_logo_url && (
                  <Image
                    source={{ uri: coupon.brand_logo_url }}
                    style={styles.brandLogo}
                    contentFit="contain"
                  />
                )}
                <Text style={[styles.brandName, { color: colors.white }]}>
                  {coupon.brand_name}
                </Text>
                <Text style={[styles.discountText, { color: colors.primary }]}>
                  {coupon.discount_text}
                </Text>
                <Text style={[styles.couponCode, { color: colors.orange }]}>
                  {coupon.code}
                </Text>
              </View>
            ) : (
              <Text style={[styles.fallbackText, { color: colors.primary }]}>
                {t('scratchCard.noOffer')}
              </Text>
            )
          ) : (
            <Text style={[styles.hiddenText, { color: colors.surfaceHL }]}>
              ???
            </Text>
          )}
        </View>

        {/* Scratch overlay */}
        <Animated.View
          style={[
            styles.overlay,
            { backgroundColor: colors.surfaceHL, opacity: overlayOpacity },
          ]}
          pointerEvents={revealed ? 'none' : 'auto'}
        >
          {!revealed && (
            <Text style={[styles.overlayText, { color: colors.white }]}>
              {t('scratchCard.coverText')}
            </Text>
          )}
        </Animated.View>
      </View>

      {/* State-dependent controls */}
      {scratched && coupon ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.redeemButton, { backgroundColor: colors.primary }]}
            onPress={handleRedeem}
          >
            <Text style={[styles.redeemButtonText, { color: colors.bg }]}>
              {t('scratchCard.redeemButton')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.copyButton, { borderColor: colors.primary }]}
            onPress={handleCopy}
          >
            <Text style={[styles.copyButtonText, { color: colors.primary }]}>
              {copied ? t('scratchCard.copied') : t('scratchCard.copyCode')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : revealed ? (
        <Text style={[styles.hint, { color: colors.white }]}>
          {t('scratchCard.scratchHint')}
        </Text>
      ) : (
        <>
          {adError && (
            <Text style={[styles.error, { color: colors.danger }]}>
              {t('scratchCard.adError')}
            </Text>
          )}
          <TouchableOpacity
            style={[
              styles.watchButton,
              { backgroundColor: colors.primary },
              (!loaded || adLoading || couponLoading) && styles.buttonDisabled,
            ]}
            onPress={show}
            disabled={!loaded || adLoading || couponLoading}
          >
            {adLoading || couponLoading ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={[styles.watchButtonText, { color: colors.bg }]}>
                {t('scratchCard.watchButton')}
              </Text>
            )}
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity style={styles.doneButton} onPress={() => router.back()}>
        <Text style={[styles.doneText, { color: colors.white }]}>
          {t('common.done')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 32,
  },
  cardWrapper: {
    width: 300,
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 32,
  },
  card: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    padding: 16,
  },
  couponContent: {
    alignItems: 'center',
    gap: 4,
  },
  brandLogo: {
    width: 48,
    height: 48,
    marginBottom: 4,
  },
  brandName: {
    fontSize: 14,
    fontWeight: '600',
  },
  discountText: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  couponCode: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  fallbackText: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  hiddenText: {
    fontSize: 24,
    fontWeight: '700',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: {
    fontSize: 16,
    opacity: 0.7,
  },
  hint: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  redeemButton: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  redeemButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  copyButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  copyButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  watchButton: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  watchButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  doneButton: {
    padding: 12,
  },
  doneText: {
    fontSize: 16,
    opacity: 0.7,
  },
  error: {
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: Register modal in `app/_layout.tsx`**

Add inside the `<Stack>`:

```tsx
<Stack.Screen
  name="scratch-card"
  options={{ presentation: 'modal', headerShown: false }}
/>
```

---

## Chunk 7: Wire Settle-Up to Scratch Card

### Task 7: Navigate to scratch card after settlement

**Files:**
- Modify: `app/settle-up.tsx`

After `record_settlement` succeeds, replace the current success path with navigation to the scratch card.

- [ ] **Step 1: Update `settle-up.tsx` success handler**

Find the success callback (after `useSettlement` / RPC resolves) and replace any existing `router.back()` or alert with:

```typescript
router.replace('/scratch-card');
```

---

## Chunk 8: i18n Strings

### Task 8: Add translation keys to all 17 locale files

**Files:**
- Modify: `locales/en.json` (and all 16 other locale files)

- [ ] **Step 1: Add keys to `locales/en.json`**

```json
"scratchCard": {
  "title": "You earned a scratch card!",
  "coverText": "Scratch me",
  "watchButton": "Watch a short ad to reveal",
  "scratchHint": "Scratch to reveal your coupon!",
  "adError": "Ad unavailable — try again later",
  "redeemButton": "Redeem Now →",
  "copyCode": "Copy Code",
  "copied": "Copied!",
  "noOffer": "No offers right now — check back soon!"
}
```

- [ ] **Step 2: Add translated equivalents to all other 16 locale files**

Locale files: `es`, `fr`, `de`, `it`, `pt`, `ru`, `ar`, `fa`, `he`, `hi`, `mr`, `ur`, `ta`, `te`, `kn`, `tr`

Use the same key structure. Translate values appropriately for each language.

---

## Chunk 9: Unit Tests

### Task 9: Tests for hooks and ScratchCardScreen

**Files:**
- Create: `__tests__/hooks/use-rewarded-ad.test.ts`
- Create: `__tests__/hooks/use-coupon.test.ts`
- Create: `__tests__/lib/detect-region.test.ts`
- Create: `__tests__/screens/scratch-card.test.tsx`

- [ ] **Step 1: Mock `react-native-google-mobile-ads`**

Create `lib/__mocks__/react-native-google-mobile-ads.ts`:

```typescript
const listeners: Record<string, (() => void)[]> = {};
const mockAd = {
  addAdEventListener: jest.fn((event: string, cb: () => void) => {
    listeners[event] = listeners[event] ?? [];
    listeners[event].push(cb);
    return () => {};
  }),
  load: jest.fn(),
  show: jest.fn(),
};

export const RewardedAd = { createForAdRequest: jest.fn(() => mockAd) };
export const RewardedAdEventType = { LOADED: 'loaded', EARNED_REWARD: 'earned_reward' };
export const AdEventType = { ERROR: 'error' };
export const TestIds = { REWARDED: 'test-rewarded-id' };
export { mockAd as __mockAd, listeners as __listeners };
```

- [ ] **Step 2: Write `use-rewarded-ad` tests**

Test that:
- `loaded` becomes `true` when `LOADED` fires
- `onEarned` callback fires when `EARNED_REWARD` fires
- `error` is set when `ERROR` fires
- `show()` calls `ad.show()`

- [ ] **Step 3: Write `detect-region` tests**

Mock `expo-localization`. Test that:
- Returns `regionCode` when locale has one (e.g. `'IN'`, `'US'`)
- Returns `'GLOBAL'` when `regionCode` is null/undefined
- Returns `'GLOBAL'` when locale list is empty

- [ ] **Step 4: Write `use-coupon` tests**

Mock `supabase.rpc('claim_coupon')` and `detectRegion`. Test that:
- `claim()` calls `supabase.rpc` with `{ p_region: 'IN' }` when region is `'IN'`
- `claim()` calls `supabase.rpc` with `{ p_region: 'GLOBAL' }` when region is `'GLOBAL'`
- `claim()` sets `coupon` on success (including the `region` field)
- `claim()` sets `error` on RPC failure
- `loading` is `true` during fetch and `false` after

- [ ] **Step 5: Write scratch-card screen tests**

Test that:
- Watch button is disabled while ad or coupon is loading
- Pressing watch button calls `show()`
- After reward earned, overlay fades and scratch hint appears
- After scratching, coupon code and Redeem/Copy buttons render
- Copy button copies code to clipboard
- Redeem button calls `Linking.openURL` with tracking URL
- Done button navigates back
- Graceful fallback renders when `claim_coupon` returns no rows

---

## Verification

- [ ] `pnpm typecheck` — no errors
- [ ] `pnpm lint` — no errors
- [ ] `pnpm test` — all tests pass
- [ ] Seed at least one test coupon row into Supabase locally before manual testing
- [ ] Manual: settle a debt on Android emulator → scratch card screen appears → watch ad → card reveals → scratch → coupon shown → copy and redeem buttons work
