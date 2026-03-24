import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

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
  const [isOnboardingVisible, setIsOnboardingVisible] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDING_KEY)
      .then((val) => {
        setIsOnboardingVisible(!val);
      })
      .catch(() => {
        setIsOnboardingVisible(false);
      });
  }, []);

  const completeOnboarding = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, '1');
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
