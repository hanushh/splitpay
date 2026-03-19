---
description: Update project dependencies safely
---

# Update Dependencies

When asked to update dependencies for Splitpay, follow these steps:

1. Install current dependencies to ensure a clean baseline:

   ```bash
   npm install
   ```

2. Review available updates (use one of):

   ```bash
   npm outdated
   ```

3. Upgrade dependencies incrementally:

   ```bash
   npm update
   ```

   For larger or breaking upgrades, update specific packages and consult their CHANGELOGs.

4. After updating, run the full quality gate:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run e2e:build
   npm run e2e:test
   npm run build:android
   ```

5. Fix any issues introduced by the dependency updates before merging the changes.
