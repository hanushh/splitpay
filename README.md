## Splitpay – React Native, Expo Router, Supabase

This is the Splitpay mobile app built with [Expo](https://expo.dev), [Expo Router](https://docs.expo.dev/router/introduction/), and [Supabase](https://supabase.com/).

You can start developing by editing the files inside the `app` directory. Routing is file-based and follows Expo Router conventions (`app/(tabs)` for the main tab navigator, additional routes and modals under `app/`).

### Prerequisites

- Node.js 20+
- Android Studio / Xcode for device simulators
- `pnpm` or `npm` (CI uses `pnpm`, scripts work with either)

### Install dependencies

```bash
npm install
```

### Local development

- **Start the dev server**

  ```bash
  npm run dev
  ```

  This runs `expo start`.

- **Run unit tests**

  ```bash
  npm test
  ```

- **Run E2E tests (Detox)**

  ```bash
  npm run e2e:build
  npm run e2e:test
  ```

- **Run Android release build locally**

  ```bash
  npm run build:android
  ```

### Project maintenance

- **Reset starter example code**

  ```bash
  npm run reset-project
  ```

For more details about architecture, conventions, and workflows, see `.cursorrules` and `.agents/workflows/` in the repository.**_ End Patch```} _**!
