const stableT = (key: string) => key;
const stableI18n = { language: 'en', changeLanguage: jest.fn() };

export const useTranslation = () => ({
  t: stableT,
  i18n: stableI18n,
});

export const initReactI18next = { type: '3rdParty', init: jest.fn() };
