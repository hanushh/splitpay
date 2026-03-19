const i18next = {
  use: jest.fn().mockReturnThis(),
  init: jest.fn().mockResolvedValue(undefined),
  t: (key: string) => key,
  language: 'en',
  changeLanguage: jest.fn(),
};

export default i18next;
