---
description: Verify the Android build
---

# Verify Android Build

When asked to verify that the Android application builds successfully (often after adding native dependencies), follow these steps:

1. Execute the Gradle build command for the release variant, as defined in `package.json`:
   // turbo

```bash
npm run build:android
```

2. Monitor the output. If the build fails, identify the root cause (e.g., missing SDKs, incompatible native modules, or Java/Kotlin syntax errors) and attempt to fix those issues.
3. A successful build indicates that the native Android layer is intact.
