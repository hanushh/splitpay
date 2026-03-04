export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
};

export const useLocalSearchParams = jest.fn().mockReturnValue({});
export const useRouter = jest.fn().mockReturnValue(router);
export const Link = 'Link';
export const Stack = { Screen: 'Screen' };
export const Tabs = { Screen: 'Screen' };
