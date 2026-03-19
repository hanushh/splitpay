## Contributing to Splitpay

### Prerequisites

- Node.js 20+
- Android Studio / Xcode for device simulators
- `npm` or `pnpm` (CI uses `pnpm`)

### Local setup

```bash
pnpm install
```

Create a `.env.development` file in the project root with the staging credentials (ask a maintainer for these values):

```
EXPO_PUBLIC_SUPABASE_URL=https://gfmbrytpmmbtpumxwile.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ask maintainer>
SUPABASE_ACCESS_TOKEN=<ask maintainer>
```

Expo automatically loads `.env.development` when running `pnpm dev`, and `.env` (production) for release builds. You never need to manually switch between them.

> **Never push env files to git** — all `.env*` files are gitignored.

### Supabase environments

| Environment    | Project                | Used when                     |
| -------------- | ---------------------- | ----------------------------- |
| **Staging**    | `gfmbrytpmmbtpumxwile` | Feature branches, local dev   |
| **Production** | `yapfqffhgcncqxovjcsr` | `main` branch only, via CI/CD |

**Running migrations on a feature branch** — always target staging, never prod:

```bash
supabase link --project-ref gfmbrytpmmbtpumxwile
supabase db push --yes
supabase link --project-ref yapfqffhgcncqxovjcsr  # re-link prod after
```

Migrations are pushed to production automatically by CI/CD when a PR is merged to `main`.

### Before opening a pull request

Run the following checks locally and ensure they pass:

- **Lint**:

  ```bash
  npm run lint
  ```

- **Typecheck**:

  ```bash
  npm run typecheck
  ```

- **Unit tests**:

  ```bash
  npm test
  ```

- **E2E tests (Detox)** – when relevant to your changes:

  ```bash
  npm run e2e:build
  npm run e2e:test
  ```

- **Android release build** – when changes touch native / Android-specific code:

  ```bash
  npm run build:android
  ```

### Coding conventions

- Follow the rules in `.cursorrules`:
  - Use functional React components and hooks.
  - Use Expo Router conventions in the `app` directory.
  - Use `StyleSheet` with styles defined at the bottom of each file.
  - Prefer `expo-image` for images and `expo-vector-icons` or `IconSymbol` for icons.
- Keep business logic out of screen components where possible; extract to `lib/` or custom hooks under `hooks/`.
- Support dark/light theme using `useColorScheme()` from `hooks/` when applicable.

See `ARCHITECTURE.md` for a high-level overview of routing, Supabase integration, and state management patterns.

### Adding screens and components

- **New screens**: follow `.agents/workflows/create-screen.md`.
- **Reusable UI components**: follow `.agents/workflows/create-ui-component.md`.

These workflows describe expected locations, patterns, and styling for new UI.

### Using AI helpers

- When using Cursor, you can delegate code review to the `codebase-reviewer` subagent in `.cursor/agents/codebase-reviewer.md`:
  - Run it **after significant edits** and **before requesting human review**.
- For other AI tools (VS Code, Codex, Claude Code, etc.), configure them to respect:
  - `.cursorrules`
  - `ARCHITECTURE.md`
  - `.agents/workflows/*`

Always ensure AI-generated changes pass the same checks listed above.
