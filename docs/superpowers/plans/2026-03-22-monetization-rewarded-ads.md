# Monetization: Rewarded Ads with Scratch Card Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rewarded-ad monetisation layer to cover Supabase hosting costs (~$30–40/month). After a user successfully settles a debt, a scratch-card screen appears. The user can watch a short rewarded video ad to reveal a prize (or dismiss without watching). No virtual currency, no wallet — the reward is direct and immediate.

**Revenue model:** Rewarded video ads (CPM $10–25, ~90% completion rate) triggered once per settlement. A plain interstitial would yield ~8–10× less due to lower CPM and forced-skip behaviour.

**User flow:**
```
settle-up.tsx  →  record_settlement RPC succeeds
             →  router.replace('/scratch-card')
             →  ScratchCardScreen shows covered card
             →  "Watch a short ad to reveal your reward" button
             →  Rewarded ad plays (Google AdMob rewarded)
             →  On reward callback → card becomes scratchable
             →  User scratches to reveal prize text
             →  "Done" returns to group screen
```

**No coins.** No coin balance, no coin hook, no wallet UI. The scratch card is the only reward mechanism.

**Tech Stack:** React Native 0.81 + Expo ~54, Google AdMob (`react-native-google-mobile-ads`), React Native Gesture Handler (scratch interaction), TypeScript strict, Expo Router, pnpm

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

## Chunk 2: Rewarded Ad Hook

### Task 2: Create `hooks/use-rewarded-ad.ts`

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

## Chunk 3: Scratch Card Screen

### Task 3: Create `app/scratch-card.tsx`

**Files:**
- Create: `app/scratch-card.tsx`
- Modify: `app/_layout.tsx` — register modal route

The screen has two visual states:

1. **Locked** — card face covered by a grey overlay, "Watch a short ad to reveal" button visible.
2. **Unlocked** — overlay removed, instructional text "Scratch to reveal!" appears; user scratches with finger.

Prize pool (randomised, kept lightweight — no backend needed at this stage):

| Prize | Weight |
|-------|--------|
| "Better luck next time" | 60% |
| "Free coffee on your friend ☕" | 20% |
| "You're the settle-up hero 🏆" | 10% |
| "Legend. That's it." | 10% |

- [ ] **Step 1: Implement scratch-card screen**

```typescript
// app/scratch-card.tsx
import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/colors';
import { useRewardedAd } from '@/hooks/use-rewarded-ad';

const PRIZES = [
  { label: 'scratchCard.prizes.betterLuck', weight: 60 },
  { label: 'scratchCard.prizes.freeCoffee', weight: 20 },
  { label: 'scratchCard.prizes.hero', weight: 10 },
  { label: 'scratchCard.prizes.legend', weight: 10 },
];

function pickPrize(): string {
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let rand = Math.random() * total;
  for (const prize of PRIZES) {
    rand -= prize.weight;
    if (rand <= 0) return prize.label;
  }
  return PRIZES[0].label;
}

export default function ScratchCardScreen() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const colors = Colors[colorScheme];

  const [revealed, setRevealed] = useState(false);
  const [scratched, setScratched] = useState(false);
  const prize = useRef(pickPrize()).current;

  const overlayOpacity = useRef(new Animated.Value(1)).current;

  const handleEarned = useCallback(() => {
    setRevealed(true);
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [overlayOpacity]);

  const { loaded, loading, show, error } = useRewardedAd(handleEarned);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => revealed,
      onPanResponderMove: () => {
        if (revealed && !scratched) setScratched(true);
      },
    }),
  ).current;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
    >
      <Text style={[styles.title, { color: colors.white }]}>
        {t('scratchCard.title')}
      </Text>

      {/* Card */}
      <View style={styles.cardWrapper} {...panResponder.panHandlers}>
        {/* Prize text — always rendered below overlay */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.prizeText, { color: colors.primary }]}>
            {scratched ? t(prize) : '???'}
          </Text>
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

      {revealed ? (
        <Text style={[styles.hint, { color: colors.white }]}>
          {t('scratchCard.scratchHint')}
        </Text>
      ) : (
        <>
          {error && (
            <Text style={[styles.error, { color: colors.danger }]}>
              {t('scratchCard.adError')}
            </Text>
          )}
          <TouchableOpacity
            style={[
              styles.watchButton,
              { backgroundColor: colors.primary },
              (!loaded || loading) && styles.watchButtonDisabled,
            ]}
            onPress={show}
            disabled={!loaded || loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={[styles.watchButtonText, { color: colors.bg }]}>
                {t('scratchCard.watchButton')}
              </Text>
            )}
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={styles.doneButton}
        onPress={() => router.back()}
      >
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
    width: 280,
    height: 160,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 32,
  },
  card: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  prizeText: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 16,
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
  watchButton: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
    marginBottom: 16,
  },
  watchButtonDisabled: {
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

## Chunk 4: Wire Settle-Up to Scratch Card

### Task 4: Navigate to scratch card after settlement

**Files:**
- Modify: `app/settle-up.tsx`

After `record_settlement` succeeds, replace the current success path with navigation to the scratch card.

- [ ] **Step 1: Update `settle-up.tsx` success handler**

Find the success callback (after `useSettlement` / RPC resolves) and replace any existing `router.back()` or alert with:

```typescript
router.replace('/scratch-card');
```

---

## Chunk 5: i18n Strings

### Task 5: Add translation keys to all 17 locale files

**Files:**
- Modify: `locales/en.json` (and all 16 other locale files)

- [ ] **Step 1: Add keys to `locales/en.json`**

```json
"scratchCard": {
  "title": "You earned a scratch card!",
  "coverText": "Covered",
  "watchButton": "Watch a short ad to reveal",
  "scratchHint": "Scratch the card to reveal your reward!",
  "adError": "Ad unavailable — try again later",
  "prizes": {
    "betterLuck": "Better luck next time",
    "freeCoffee": "Free coffee on your friend ☕",
    "hero": "You're the settle-up hero 🏆",
    "legend": "Legend. That's it."
  }
}
```

- [ ] **Step 2: Add translated equivalents to all other 16 locale files**

Locale files: `es`, `fr`, `de`, `it`, `pt`, `ru`, `ar`, `fa`, `he`, `hi`, `mr`, `ur`, `ta`, `te`, `kn`, `tr`

Use the same key structure. Translate values appropriately for each language.

---

## Chunk 6: Unit Tests

### Task 6: Tests for `useRewardedAd` and `ScratchCardScreen`

**Files:**
- Create: `__tests__/hooks/use-rewarded-ad.test.ts`
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

export const RewardedAd = {
  createForAdRequest: jest.fn(() => mockAd),
};
export const RewardedAdEventType = {
  LOADED: 'loaded',
  EARNED_REWARD: 'earned_reward',
};
export const AdEventType = { ERROR: 'error' };
export const TestIds = { REWARDED: 'test-rewarded-id' };
export { mockAd as __mockAd, listeners as __listeners };
```

- [ ] **Step 2: Write hook tests**

Test that:
- `loaded` becomes `true` when `LOADED` fires
- `onEarned` callback fires when `EARNED_REWARD` fires
- `error` is set when `ERROR` fires
- `show()` calls `ad.show()`

- [ ] **Step 3: Write screen tests**

Test that:
- Watch button renders and is disabled while ad is loading
- Pressing watch button calls `show()`
- After reward earned, overlay fades and scratch hint appears
- Done button navigates back

---

## Verification

- [ ] `pnpm typecheck` — no errors
- [ ] `pnpm lint` — no errors
- [ ] `pnpm test` — all tests pass
- [ ] Manual: settle a debt on Android emulator → scratch card screen appears → watch ad → card reveals → scratch → prize shown
