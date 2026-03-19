export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
};

export const useLocalSearchParams = jest.fn().mockReturnValue({});
export const useRouter = jest.fn().mockReturnValue(router);
export const useFocusEffect = jest.fn().mockImplementation((cb: () => void) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  // Fire once after mount, matching the real hook's behaviour in a non-navigation test context
  useEffect(cb, []);
});
export const Link = 'Link';
export const Stack = { Screen: 'Screen' };
export const Tabs = { Screen: 'Screen' };
