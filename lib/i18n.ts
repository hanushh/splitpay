import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '@/locales/en.json';
import hi from '@/locales/hi.json';
import mr from '@/locales/mr.json';
import ur from '@/locales/ur.json';
import ta from '@/locales/ta.json';
import te from '@/locales/te.json';
import kn from '@/locales/kn.json';
import tr from '@/locales/tr.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import de from '@/locales/de.json';
import it from '@/locales/it.json';
import pt from '@/locales/pt.json';
import ru from '@/locales/ru.json';
import ar from '@/locales/ar.json';
import fa from '@/locales/fa.json';
import he from '@/locales/he.json';

const LANGUAGE_KEY = 'user-language';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية' },
  { code: 'fa', label: 'Persian', nativeLabel: 'فارسی' },
  { code: 'he', label: 'Hebrew', nativeLabel: 'עברית' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी' },
  { code: 'ur', label: 'Urdu', nativeLabel: 'اردو' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
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
      mr: { translation: mr },
      ur: { translation: ur },
      ta: { translation: ta },
      te: { translation: te },
      kn: { translation: kn },
      tr: { translation: tr },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      it: { translation: it },
      pt: { translation: pt },
      ru: { translation: ru },
      ar: { translation: ar },
      fa: { translation: fa },
      he: { translation: he },
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

export default i18n;
