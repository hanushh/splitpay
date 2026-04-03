import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const TOOLTIP_WIDTH = Math.min(SCREEN_WIDTH - 48, 300);

const C = {
  overlay: 'rgba(0,0,0,0.72)',
  surface: '#1e3a2f',
  primary: '#17e86b',
  white: '#ffffff',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  border: 'rgba(23, 232, 107, 0.25)',
};

export interface TargetLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OnboardingTooltipProps {
  visible: boolean;
  title: string;
  description: string;
  step: number;
  totalSteps: number;
  targetLayout: TargetLayout | null;
  arrowDirection: 'up' | 'down' | 'none';
  onNext: () => void;
  onSkip: () => void;
}

export default function OnboardingTooltip({
  visible,
  title,
  description,
  step,
  totalSteps,
  targetLayout,
  arrowDirection,
  onNext,
  onSkip,
}: OnboardingTooltipProps) {
  const { t } = useTranslation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const isLastStep = step === totalSteps - 1;

  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, step, fadeAnim]);

  const tooltipPos = computeTooltipPosition(targetLayout, arrowDirection);
  const arrowOffset = computeArrowOffset(targetLayout, tooltipPos.left);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[s.overlay, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onSkip} />

        {/* Container: arrow (if up) + bubble + arrow (if down) */}
        <View style={[s.tooltipContainer, tooltipPos]}>
          {arrowDirection === 'up' && (
            <View style={[s.arrowUp, { marginLeft: arrowOffset }]} />
          )}

          <View style={s.bubble}>
            <Text style={s.stepIndicator}>
              {t('onboarding.stepOf', { step: step + 1, total: totalSteps })}
            </Text>
            <Text style={s.title}>{title}</Text>
            <Text style={s.description}>{description}</Text>

            <View style={s.actions}>
              <Pressable onPress={onSkip} hitSlop={8} style={s.skipBtn}>
                <Text style={s.skipText}>{t('onboarding.skip')}</Text>
              </Pressable>
              <Pressable onPress={onNext} style={s.nextBtn}>
                <Text style={s.nextText}>
                  {isLastStep ? t('onboarding.done') : t('onboarding.next')}
                </Text>
              </Pressable>
            </View>
          </View>

          {arrowDirection === 'down' && (
            <View style={[s.arrowDown, { marginLeft: arrowOffset }]} />
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

function computeTooltipPosition(
  target: TargetLayout | null,
  arrow: 'up' | 'down' | 'none',
): { position: 'absolute'; top?: number; bottom?: number; left: number } {
  const left = target
    ? Math.max(
        16,
        Math.min(
          target.x + target.width / 2 - TOOLTIP_WIDTH / 2,
          SCREEN_WIDTH - TOOLTIP_WIDTH - 16,
        ),
      )
    : (SCREEN_WIDTH - TOOLTIP_WIDTH) / 2;

  if (!target || arrow === 'none') {
    return { position: 'absolute', top: SCREEN_HEIGHT * 0.38, left };
  }

  if (arrow === 'up') {
    // Tooltip below the anchor
    return {
      position: 'absolute',
      top: target.y + target.height + 4,
      left,
    };
  }

  // arrow === 'down': tooltip above the anchor
  return {
    position: 'absolute',
    bottom: SCREEN_HEIGHT - target.y + 4,
    left,
  };
}

function computeArrowOffset(
  target: TargetLayout | null,
  tooltipLeft: number,
): number {
  if (!target) return TOOLTIP_WIDTH / 2 - 10;
  const targetCenterX = target.x + target.width / 2;
  const offset = targetCenterX - tooltipLeft - 10;
  return Math.max(12, Math.min(offset, TOOLTIP_WIDTH - 32));
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
  },
  tooltipContainer: {
    width: TOOLTIP_WIDTH,
  },
  arrowUp: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: C.surface,
  },
  arrowDown: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: C.surface,
  },
  bubble: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  stepIndicator: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 8,
  },
  title: {
    color: C.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  description: {
    color: C.slate300,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  skipText: {
    color: C.slate500,
    fontSize: 14,
    fontWeight: '500',
  },
  nextBtn: {
    backgroundColor: C.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  nextText: {
    color: '#112117',
    fontSize: 14,
    fontWeight: '700',
  },
});
