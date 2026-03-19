import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '@/locales/en.json';
import hi from '@/locales/hi.json';

const LANGUAGE_KEY = 'user-language';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

async function getStoredLanguage(): Promise<string | null> {
  return AsyncStorage.getItem(LANGUAGE_KEY);
}

function getDeviceLanguage(): string {
  const locales = Localization.getLocales();
  const deviceLang = locales[0]?.languageCode ?? 'en';
  const supported = SUPPORTED_LANGUAGES.map((l) => l.code);
  return supported.includes(deviceLang as LanguageCode) ? deviceLang : 'en';
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, code);
}

export async function initI18n(): Promise<void> {
  const stored = await getStoredLanguage();
  const lng = stored ?? getDeviceLanguage();

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

export default i18n;
