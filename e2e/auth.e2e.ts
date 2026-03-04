import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

const TEST_EMAIL = `e2e_${Date.now()}@paysplit.test`;
const TEST_PASSWORD = 'TestPass123!';

describe('Authentication flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('shows sign-in screen on fresh launch', async () => {
    await detoxExpect(element(by.text('PaySplit'))).toBeVisible();
    await detoxExpect(element(by.text('Sign In'))).toBeVisible();
  });

  it('shows validation error for empty sign-in', async () => {
    await element(by.text('Sign In')).tap();
    await detoxExpect(element(by.text(/email.*required|enter.*email/i))).toBeVisible();
  });

  it('navigates to sign-up screen', async () => {
    await element(by.text("Don't have an account")).tap();
    await detoxExpect(element(by.text('Create Account'))).toBeVisible();
  });

  it('shows error when passwords do not match', async () => {
    await element(by.id('email-input')).typeText(TEST_EMAIL);
    await element(by.id('password-input')).typeText(TEST_PASSWORD);
    await element(by.id('confirm-password-input')).typeText('DifferentPass!');
    await element(by.text('Create Account')).tap();
    await detoxExpect(element(by.text(/passwords.*match/i))).toBeVisible();
  });

  it('creates a new account successfully', async () => {
    await element(by.id('confirm-password-input')).clearText();
    await element(by.id('confirm-password-input')).typeText(TEST_PASSWORD);
    await element(by.text('Create Account')).tap();
    // After sign-up, user sees "Check your email" confirmation
    await waitFor(element(by.text(/check your email/i)))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('navigates back to sign-in', async () => {
    await element(by.text('Sign In')).tap();
    await detoxExpect(element(by.text('Sign In'))).toBeVisible();
  });

  it('shows error for invalid credentials', async () => {
    await element(by.id('email-input')).typeText('invalid@example.com');
    await element(by.id('password-input')).typeText('wrongpassword');
    await element(by.text('Sign In')).tap();
    await waitFor(element(by.text(/invalid|credentials|not found/i)))
      .toBeVisible()
      .withTimeout(8000);
  });
});
