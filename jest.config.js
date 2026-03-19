module.exports = {
  preset: 'jest-expo',
  testTimeout: 15000,
  setupFilesAfterEnv: [
    '@testing-library/react-native/build/matchers/extend-expect',
    '<rootDir>/jest.setup.ts',
  ],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
  moduleNameMapper: {
    '^@expo/vector-icons$': '<rootDir>/__mocks__/@expo/vector-icons.ts',
    '^@expo/vector-icons/(.*)$': '<rootDir>/__mocks__/@expo/vector-icons.ts',
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.ts',
    '^expo-router$': '<rootDir>/__mocks__/expo-router.ts',
    '^expo/src/winter$': '<rootDir>/__mocks__/expo-winter.js',
    '^(\\.\\.?/)*lib/supabase$': '<rootDir>/lib/__mocks__/supabase.ts',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/__mocks__/@react-native-async-storage/async-storage.ts',
    '^expo-contacts$': '<rootDir>/lib/__mocks__/expo-contacts.ts',
    '^react-i18next$': '<rootDir>/__mocks__/react-i18next.ts',
    '^i18next$': '<rootDir>/__mocks__/i18next.ts',
    '^expo-localization$': '<rootDir>/__mocks__/expo-localization.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  collectCoverageFrom: [
    'context/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
};
