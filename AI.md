# AI Context

This repository is optimized for AI-assisted development.

- **Purpose**: "SplitPay" is a bill-splitting application allowing users to create groups, add expenses, and settle up balances.
- **AI Rules**: Please refer to `.cursorrules` and `llms.txt` for specific syntax, architectural guidelines, and tech stack details when contributing to this codebase.
- **Key Files**:
  - `app/_layout.tsx`: Root layout configuring standard providers (Auth, Currency) and global navigation stack.
  - `package.json`: Contains scripts for running the app via Expo and detox test suites.

When asked to implement new features, adhere strictly to the established patterns: Expo Router for navigation, Supabase for data and auth, and native `StyleSheet` for theming.
