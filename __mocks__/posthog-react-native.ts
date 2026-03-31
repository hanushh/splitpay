// Mock for posthog-react-native in Jest tests.
const PostHog = jest.fn().mockImplementation(() => ({
  capture: jest.fn(),
  identify: jest.fn(),
  reset: jest.fn(),
}));

export default PostHog;

export const PostHogProvider = ({ children }: { children: React.ReactNode }) => children;
export const usePostHog = () => null;
