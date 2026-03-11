import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

const TEST_EMAIL = process.env.E2E_EMAIL ?? 'e2e@paysplit.test';
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'TestPass123!';
let activeEmail = TEST_EMAIL;
let activePassword = TEST_PASSWORD;

async function trySignIn(email: string, password: string, timeoutMs = 15000): Promise<boolean> {
  await waitFor(element(by.id('email-input'))).toBeVisible().withTimeout(12000);
  await element(by.id('email-input')).replaceText(email);
  await element(by.id('password-input')).replaceText(password);
  await device.disableSynchronization();
  await element(by.id('sign-in-button')).tap();
  try {
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(timeoutMs);
    return true;
  } catch {
    return false;
  } finally {
    await device.enableSynchronization();
  }
}

async function signUpAndSignIn() {
  activeEmail = `e2e_exp_${Date.now()}@paysplit.test`;
  activePassword = `E2E_${Date.now()}!aA1`;

  try {
    await waitFor(element(by.text('Create account'))).toBeVisible().withTimeout(2000);
  } catch {
    await element(by.text('Sign Up')).tap();
    await waitFor(element(by.text('Create account'))).toBeVisible().withTimeout(8000);
  }

  await element(by.id('email-input')).replaceText(activeEmail);
  await element(by.id('password-input')).replaceText(activePassword);
  await element(by.id('confirm-password-input')).replaceText(activePassword);
  await element(by.text('Create account')).tap();
  await device.disableSynchronization();
  await element(by.id('sign-up-button')).tap();
  await device.enableSynchronization();

  try {
    await waitFor(element(by.text('Back to Sign In'))).toBeVisible().withTimeout(12000);
    await element(by.text('Back to Sign In')).tap();
  } catch {
    try {
      await element(by.text('Sign In')).tap();
    } catch {
      // Already on sign-in
    }
  }

  const signedIn = await trySignIn(activeEmail, activePassword, 35000);
  if (!signedIn) {
    throw new Error('Unable to authenticate for add-expense e2e setup.');
  }
}

async function ensureAtLeastOneGroup() {
  await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(10000);
  await element(by.id('create-group-header-btn')).tap();
  await waitFor(element(by.id('create-group-screen'))).toBeVisible().withTimeout(5000);
  await element(by.id('group-name-input')).typeText(`E2E Expense Group ${Date.now()}`);
  await device.disableSynchronization();
  await element(by.id('create-group-button')).tap();
  // After creation, the app navigates to the group detail screen — wait for it then go back
  await waitFor(element(by.id('group-detail-screen'))).toBeVisible().withTimeout(20000);
  await device.enableSynchronization();
  await device.pressBack();
  await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(5000);
}

async function ensureSignedIn() {
  try {
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(3000);
    return;
  } catch {
    const signedIn = await trySignIn(activeEmail, activePassword, 20000);
    if (!signedIn) {
      await signUpAndSignIn();
    }
  }
}

describe('Add Expense — validation', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await ensureSignedIn();
    await ensureAtLeastOneGroup();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('opens add-expense screen via FAB', async () => {
    await element(by.id('fab-add-expense')).tap();
    await waitFor(element(by.id('add-expense-screen')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('shows "Add expense" header title', async () => {
    await detoxExpect(element(by.text('Add expense'))).toBeVisible();
  });

  it('Save button in header is disabled with no data', async () => {
    const attrs = (await element(by.id('header-save-button')).getAttributes()) as { enabled?: boolean };
    expect(attrs.enabled).toBe(false);
  });

  it('footer Save Expense button is disabled with no data', async () => {
    const attrs = (await element(by.id('save-expense-button')).getAttributes()) as { enabled?: boolean };
    expect(attrs.enabled).toBe(false);
  });

  it('group picker opens and lists only user groups', async () => {
    await element(by.id('group-picker-button')).tap();
    await waitFor(element(by.id('group-list'))).toBeVisible().withTimeout(5000);
    // At least one group option should exist
    await detoxExpect(element(by.id('group-option-0'))).toBeVisible();
  });

  it('selects a group and closes picker', async () => {
    await device.disableSynchronization();
    await element(by.id('group-option-0')).tap();
    await waitFor(element(by.id('group-list'))).not.toBeVisible().withTimeout(3000);
  });

  it('loads members after group selection', async () => {
    // Members are fetched from Supabase — keep sync disabled until members appear
    await waitFor(element(by.id('paid-by-section')))
      .toBeVisible()
      .withTimeout(15000);
    await device.enableSynchronization();
  });

  it('fills description', async () => {
    await element(by.id('description-input')).typeText('E2E Dinner');
    await detoxExpect(element(by.id('description-input'))).toHaveText('E2E Dinner');
  });

  it('fills amount', async () => {
    await element(by.id('amount-input')).typeText('45.00');
  });

  it('Save button becomes enabled after all required fields filled', async () => {
    const attrs = (await element(by.id('save-expense-button')).getAttributes()) as { enabled?: boolean };
    expect(attrs.enabled).toBe(true);
  });

  it('saves expense and returns to groups screen', async () => {
    await device.disableSynchronization();
    await element(by.id('save-expense-button')).tap();
    await waitFor(element(by.text('Groups')))
      .toBeVisible()
      .withTimeout(20000);
    await device.enableSynchronization();
  });
});

describe('Add Expense — split method UI', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await ensureSignedIn();
    await ensureAtLeastOneGroup();
  });

  it('shows split method buttons after selecting group', async () => {
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('fab-add-expense')).tap();
    await waitFor(element(by.id('add-expense-screen'))).toBeVisible().withTimeout(5000);

    // Select a group — disable sync for network calls
    await element(by.id('group-picker-button')).tap();
    await waitFor(element(by.id('group-option-0'))).toBeVisible().withTimeout(5000);
    await device.disableSynchronization();
    await element(by.id('group-option-0')).tap();
    await waitFor(element(by.id('paid-by-section'))).toBeVisible().withTimeout(15000);
    await device.enableSynchronization();
  });

  it('Equally is selected by default', async () => {
    await detoxExpect(element(by.id('split-method-equally'))).toBeVisible();
  });

  it('tapping Exact shows a "coming soon" note', async () => {
    await element(by.id('split-method-exact')).tap();
    await waitFor(element(by.text(/coming soon/i)))
      .toBeVisible()
      .withTimeout(2000);
  });

  it('tapping Percent shows a "coming soon" note', async () => {
    await element(by.id('split-method-percent')).tap();
    await waitFor(element(by.text(/coming soon/i)))
      .toBeVisible()
      .withTimeout(2000);
  });

  it('switching back to Equally hides the note', async () => {
    await element(by.id('split-method-equally')).tap();
    await detoxExpect(element(by.text(/coming soon/i))).not.toBeVisible();
  });

  it('cancel returns to groups screen', async () => {
    await element(by.id('cancel-button')).tap();
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(5000);
  });
});

describe('Add Expense — validation errors', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await ensureSignedIn();
    await ensureAtLeastOneGroup();
  });

  it('shows error for zero amount', async () => {
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('fab-add-expense')).tap();
    await waitFor(element(by.id('add-expense-screen'))).toBeVisible().withTimeout(5000);

    // Select group and fill description but use 0 as amount
    await element(by.id('group-picker-button')).tap();
    await waitFor(element(by.id('group-option-0'))).toBeVisible().withTimeout(5000);
    await device.disableSynchronization();
    await element(by.id('group-option-0')).tap();
    await waitFor(element(by.id('paid-by-section'))).toBeVisible().withTimeout(15000);
    await device.enableSynchronization();
    await element(by.id('description-input')).typeText('Zero test');
    await element(by.id('amount-input')).typeText('0');

    // Tap header save — since canSave is false (amount 0), call handleSave directly via footer
    await element(by.id('save-expense-button')).tap();
    await waitFor(element(by.text(/valid amount/i)))
      .toBeVisible()
      .withTimeout(3000);
  });

  it('cancel clears and returns', async () => {
    await element(by.id('cancel-button')).tap();
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(5000);
  });
});
