---
description: Create a reusable UI component
---

# Create a Reusable UI Component

When asked to create a new reusable UI component, follow these steps:

1. Create the new component file inside the `components/ui/` directory if it's a generic UI building block. Otherwise, place it in `components/`.
2. Ensure the component is a functional component written in TypeScript (`.tsx`).
3. Define strict TypeScript interfaces for the component's props.
4. Use `StyleSheet` from `react-native` for all styling. Place the `const styles = StyleSheet.create(...)` at the bottom of the file.
5. If the component displays an image, use `Image` from `expo-image` rather than `react-native`.
6. If the component uses an icon, use `IconSymbol` from `@/components/ui/icon-symbol.tsx` or `expo-vector-icons`.
7. Ensure the component correctly handles the application's dark and light theme using `useColorScheme()` if applicable.
