import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';

const ONBOARDING_KEY = 'onboarding_complete_v1';

type OnboardingContextType = {
  isOnboardingVisible: boolean;
  completeOnboarding: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextType>({
  isOnboardingVisible: false,
  completeOnboarding: async () => {},
});

async function getFlag(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return (globalThis as any).localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function setFlag(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    (globalThis as any).localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isOnboardingVisible, setIsOnboardingVisible] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsOnboardingVisible(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Already completed the tour — skip
        const flag = await getFlag(ONBOARDING_KEY);
        if (flag) return;

        // Existing user who already has groups — auto-complete
        const { count } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id);

        if (cancelled) return;

        if (count && count > 0) {
          await setFlag(ONBOARDING_KEY, '1');
        } else {
          setIsOnboardingVisible(true);
        }
      } catch {
        // Fail closed — don't show tour if something goes wrong
        setIsOnboardingVisible(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const completeOnboarding = useCallback(async () => {
    await setFlag(ONBOARDING_KEY, '1');
    setIsOnboardingVisible(false);
  }, []);

  return (
    <OnboardingContext.Provider value={{ isOnboardingVisible, completeOnboarding }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextType {
  return useContext(OnboardingContext);
}
