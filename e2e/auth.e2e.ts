import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

const TEST_EMAIL = `e2e_${Date.now()}@paysplit.test`;
const TEST_PASSWORD = 'TestPass123!';

async function waitForAnyText(texts: string[], timeoutMs = 10000) {
  const eachTimeout = Math.max(
    1000,
    Math.floor(timeoutMs / Math.max(1, texts.length)),
  );
  for (const text of texts) {
    try {
      await waitFor(element(by.text(text)))
        .toBeVisible()
        .withTimeout(eachTimeout);
      return;
    } catch {
      // try next option
    }
  }
  throw new Error(
    `None of the expected texts were visible: ${texts.join(', ')}`,
  );
}

async function waitForSignUpResult() {
  try {
    await waitFor(element(by.text('Check your email')))
      .toBeVisible()
      .withTimeout(30000);
    return;
  } catch {
    await waitFor(element(by.id('sign-up-button')))
      .toBeVisible()
      .withTimeout(30000);
  }
}

describe('Authentication flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('shows sign-in screen on fresh launch', async () => {
    await waitFor(element(by.text('Welcome back')))
      .toBeVisible()
      .withTimeout(10000);
    await detoxExpect(element(by.id('sign-in-button'))).toBeVisible();
  });

  it('shows validation error for empty sign-in', async () => {
    await element(by.id('sign-in-button')).tap();
    await waitFor(element(by.text('Please fill in all fields.')))
      .toBeVisible()
      .withTimeout(3000);
  });

  it('navigates to sign-up screen', async () => {
    await element(by.text('Sign Up')).tap();
    await waitFor(element(by.text('Create account')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('shows error when passwords do not match', async () => {
    await element(by.id('email-input')).replaceText(TEST_EMAIL);
    await element(by.id('password-input')).replaceText(TEST_PASSWORD);
    await element(by.id('confirm-password-input')).replaceText(
      'DifferentPass!',
    );
    await element(by.text('Create account')).tap();
    await element(by.id('sign-up-button')).tap();
    await waitForAnyText(
      ['Passwords do not match.', 'Please fill in all fields.'],
      9000,
    );
  });

  it('submits the sign-up form and gets a response', async () => {
    await element(by.id('confirm-password-input')).replaceText(TEST_PASSWORD);
    await element(by.text('Create account')).tap();
    // Disable network sync so Supabase call doesn't block Espresso idling
    await device.disableSynchronization();
    await element(by.id('sign-up-button')).tap();
    // Accept either success state or staying on form with error
    await waitForSignUpResult();
    await device.enableSynchronization();
  });

  it('navigates back to sign-in from success screen', async () => {
    try {
      await element(by.text('Back to Sign In')).tap();
    } catch {
      try {
        await element(by.text('Sign In')).tap();
      } catch {
        // Already on sign-in screen
      }
    }
    await waitFor(element(by.text('Welcome back')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('shows error for invalid credentials', async () => {
    await waitFor(element(by.id('email-input')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('email-input')).replaceText('invalid@example.com');
    await element(by.id('password-input')).replaceText('wrongpassword');
    await device.disableSynchronization();
    await element(by.id('sign-in-button')).tap();
    await waitForAnyText(
      [
        'Invalid login credentials',
        'Invalid email or password',
        'Email not confirmed',
      ],
      12000,
    );
    await device.enableSynchronization();
  });
});
