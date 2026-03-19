---
description: Run Detox E2E tests
---

# Run Detox E2E Tests

When asked to verify the app using End-to-End (E2E) tests with Detox, follow these steps:

1. Ensure the Android emulator or iOS simulator is running.
2. Build the app for E2E testing by running:
   // turbo

```bash
npm run e2e:build
```

3. Once the build is successfully completed, execute the test suite by running:
   // turbo

```bash
npm run e2e:test
```

4. If there are failures, review the Detox terminal output or artifacts to identify the failing assertions and fix the underlying issues in the app code or test specs.
