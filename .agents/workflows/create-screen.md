---
description: Create a new screen in the app
---
# Create a New Screen

When asked to create a new screen or view for the SplitPay application, follow these steps:

1. Determine the correct location for the screen. If it belongs in a tab, place it in `app/(tabs)/`. If it's a standalone screen, place it in `app/`. If it's a modal, make sure its presentation is set to modal in `app/_layout.tsx`.
2. Ensure the screen is a functional component written in TypeScript (`.tsx`).
3. Use `react-native`'s `StyleSheet` for styling. Place the `StyleSheet.create(...)` block at the bottom of the file. No inline styles unless dynamically calculated.
4. Support Dark/Light themes by importing and using `useColorScheme()` from `@/hooks/use-color-scheme`.
5. If the screen requires a safe area, wrap the main content in a `SafeAreaView` from `react-native-safe-area-context` or use the existing `ParallaxScrollView` from `@/components/parallax-scroll-view` if scrolling is needed.
6. Make sure to define and export the default functional component.
7. If the screen is a new route, update `app/_layout.tsx` to include the `Stack.Screen` definition with appropriate options (e.g., `presentation: 'modal'` if it's a modal).
