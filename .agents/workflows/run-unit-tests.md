---
description: Run Jest unit and integration tests
---

# Run Unit and Integration Tests

When asked to run the Jest test suite for Splitpay, follow these steps:

1. Ensure dependencies are installed:

   ```bash
   npm install
   ```

2. Run the test suite:

   ```bash
   npm test
   ```

3. For focused development, you can use watch mode:

   ```bash
   npm run test:watch
   ```

4. For coverage reports:

   ```bash
   npm run test:coverage
   ```

If tests fail, use the Jest output to identify failing assertions and fix the underlying issues in the app code or test files.

