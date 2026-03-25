import { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useOnboarding } from '@/context/onboarding';
import { type TargetLayout } from '@/components/ui/OnboardingTooltip';

interface OnboardingStep {
  titleKey: string;
  descKey: string;
  targetIndex: number | null; // index into targets array, null = no target
  arrow: 'up' | 'down' | 'none';
}

const STEPS: OnboardingStep[] = [
  { titleKey: 'onboarding.welcomeTitle', descKey: 'onboarding.welcomeDesc', targetIndex: null, arrow: 'none' },
  { titleKey: 'onboarding.balanceTitle', descKey: 'onboarding.balanceDesc', targetIndex: 0, arrow: 'up' },
  { titleKey: 'onboarding.createGroupTitle', descKey: 'onboarding.createGroupDesc', targetIndex: 1, arrow: 'up' },
  { titleKey: 'onboarding.addExpenseTitle', descKey: 'onboarding.addExpenseDesc', targetIndex: 2, arrow: 'down' },
];

type MeasurableRef = React.RefObject<React.ElementRef<typeof View>>;

function measureRef(ref: MeasurableRef, setter: (layout: TargetLayout) => void): void {
  const node = ref.current as unknown as {
    measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
  } | null;
  node?.measureInWindow?.((x, y, w, h) => setter({ x, y, width: w, height: h }));
}

export function useHomeOnboarding() {
  const { t } = useTranslation();
  const { isOnboardingVisible, completeOnboarding } = useOnboarding();
  const [step, setStep] = useState(0);

  // Target refs & layouts — order: balanceCard, createGroupBtn, fab
  const balanceCardRef = useRef<React.ElementRef<typeof View>>(null);
  const createGroupBtnRef = useRef<React.ElementRef<typeof View>>(null);
  const fabRef = useRef<React.ElementRef<typeof View>>(null);

  const [layouts, setLayouts] = useState<(TargetLayout | null)[]>([null, null, null]);

  const setLayout = useCallback((index: number, layout: TargetLayout) => {
    setLayouts((prev) => {
      const next = [...prev];
      next[index] = layout;
      return next;
    });
  }, []);

  const measureBalanceCard = useCallback(() => {
    measureRef(balanceCardRef, (l) => setLayout(0, l));
  }, [setLayout]);

  const measureCreateGroupBtn = useCallback(() => {
    measureRef(createGroupBtnRef, (l) => setLayout(1, l));
  }, [setLayout]);

  const measureFab = useCallback(() => {
    measureRef(fabRef, (l) => setLayout(2, l));
  }, [setLayout]);

  const onNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      completeOnboarding();
    }
  }, [step, completeOnboarding]);

  const onSkip = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const current = STEPS[step];

  const tooltipProps = useMemo(
    () => ({
      visible: isOnboardingVisible,
      step,
      totalSteps: STEPS.length,
      title: t(current.titleKey),
      description: t(current.descKey),
      targetLayout: current.targetIndex !== null ? layouts[current.targetIndex] : null,
      arrowDirection: current.arrow,
      onNext,
      onSkip,
    }),
    [isOnboardingVisible, step, current, layouts, t, onNext, onSkip],
  );

  return {
    tooltipProps,
    // Refs & onLayout handlers for the screen to attach
    balanceCardRef,
    createGroupBtnRef,
    fabRef,
    measureBalanceCard,
    measureCreateGroupBtn,
    measureFab,
  };
}
