import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';
import { getItem, setItem } from '@/lib/storage';

const ONBOARDING_KEY = 'onboarding_complete_v1';

type OnboardingContextType = {
  isOnboardingVisible: boolean;
  completeOnboarding: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextType>({
  isOnboardingVisible: false,
  completeOnboarding: async () => {},
});

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
        const flag = await getItem(ONBOARDING_KEY);
        if (flag) return;

        // Existing user who already has groups — auto-complete
        const { count } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id);

        if (cancelled) return;

        if (count && count > 0) {
          await setItem(ONBOARDING_KEY, '1');
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
    await setItem(ONBOARDING_KEY, '1');
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
