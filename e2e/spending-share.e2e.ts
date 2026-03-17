import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

const TEST_EMAIL = process.env.E2E_EMAIL ?? 'e2e@paysplit.test';
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'TestPass123!';
let activeEmail = TEST_EMAIL;
let activePassword = TEST_PASSWORD;

async function trySignIn(email: string, password: string, timeoutMs = 20000): Promise<boolean> {
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
  activeEmail = `e2e_spend_${Date.now()}@paysplit.test`;
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
    try { await element(by.text('Sign In')).tap(); } catch { /* already on sign-in */ }
  }

  const ok = await trySignIn(activeEmail, activePassword, 35000);
  if (!ok) throw new Error('Unable to authenticate for spending e2e setup.');
}

async function ensureSignedIn() {
  try {
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(3000);
  } catch {
    const ok = await trySignIn(activeEmail, activePassword, 20000);
    if (!ok) await signUpAndSignIn();
  }
}

async function createGroupWithExpense(): Promise<void> {
  // Wait for groups screen to fully settle (initialize_demo_data may run on first login)
  await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(15000);

  // Create a group
  await element(by.id('create-group-header-btn')).tap();
  await waitFor(element(by.id('create-group-screen'))).toBeVisible().withTimeout(8000);
  await element(by.id('group-name-input')).typeText(`Spend Test ${Date.now()}`);
  await device.disableSynchronization();
  await element(by.id('create-group-button')).tap();
  // Increase timeout — staging DB + demo data init can make this slow on first login
  await waitFor(element(by.id('group-detail-screen'))).toBeVisible().withTimeout(40000);
  await device.enableSynchronization();

  // Add an expense from the group detail screen FAB
  await element(by.id('fab-add-expense')).tap();
  await waitFor(element(by.id('add-expense-screen'))).toBeVisible().withTimeout(8000);
  await element(by.id('group-picker-button')).tap();
  await waitFor(element(by.id('group-option-0'))).toBeVisible().withTimeout(8000);
  await device.disableSynchronization();
  await element(by.id('group-option-0')).tap();
  await waitFor(element(by.id('paid-by-section'))).toBeVisible().withTimeout(20000);
  await device.enableSynchronization();
  await element(by.id('description-input')).typeText('E2E Restaurant');
  await element(by.id('amount-input')).typeText('60.00');
  await device.disableSynchronization();
  await element(by.id('save-expense-button')).tap();
  await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(25000);
  await device.enableSynchronization();

  // Open the first group card
  await element(by.id('group-card-0')).tap();
  await waitFor(element(by.id('group-detail-screen'))).toBeVisible().withTimeout(15000);
}

describe('Spending screen — share card', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await ensureSignedIn();
    await createGroupWithExpense();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('shows "Spending →" link on group detail', async () => {
    await detoxExpect(element(by.id('spending-link'))).toBeVisible();
  });

  it('navigates to spending screen', async () => {
    await device.disableSynchronization();
    await element(by.id('spending-link')).tap();
    await waitFor(element(by.id('spending-screen'))).toBeVisible().withTimeout(10000);
    await device.enableSynchronization();
  });

  it('shows "Spending" header title', async () => {
    await detoxExpect(element(by.text('Spending'))).toBeVisible();
  });

  it('shows spending data after expenses load', async () => {
    await waitFor(element(by.text('TOTAL GROUP SPEND'))).toBeVisible().withTimeout(15000);
    await detoxExpect(element(by.text('BREAKDOWN'))).toBeVisible();
  });

  it('share button is enabled when data is present', async () => {
    const attrs = (await element(by.id('spending-share-btn')).getAttributes()) as { enabled?: boolean };
    expect(attrs.enabled).toBe(true);
  });

  it('tapping share button opens share card sheet', async () => {
    await element(by.id('spending-share-btn')).tap();
    await waitFor(element(by.id('share-card-sheet'))).toBeVisible().withTimeout(3000);
  });

  it('share card shows "Share Summary" title', async () => {
    await detoxExpect(element(by.text('Share Summary'))).toBeVisible();
  });

  it('share card preview shows "TOTAL SPENT"', async () => {
    await detoxExpect(element(by.text('TOTAL SPENT'))).toBeVisible();
  });

  it('share card preview shows "Shared via PaySplit" footer', async () => {
    await detoxExpect(element(by.text('Shared via PaySplit'))).toBeVisible();
  });

  it('tapping Share button triggers native share sheet', async () => {
    await device.disableSynchronization();
    await element(by.id('share-card-confirm-btn')).tap();
    // Native share sheet appears — dismiss it by pressing back
    await device.pressBack();
    await device.enableSynchronization();
  });

  it('back button returns to group detail', async () => {
    // Dismiss the modal first if still open
    try {
      await device.pressBack();
    } catch { /* already dismissed */ }
    await element(by.id('spending-back-btn')).tap();
    await waitFor(element(by.id('group-detail-screen'))).toBeVisible().withTimeout(5000);
  });
});

describe('Spending screen — empty state', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await ensureSignedIn();

    // Create a group with no expenses
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(15000);
    await element(by.id('create-group-header-btn')).tap();
    await waitFor(element(by.id('create-group-screen'))).toBeVisible().withTimeout(8000);
    await element(by.id('group-name-input')).typeText(`Empty Spend ${Date.now()}`);
    await device.disableSynchronization();
    await element(by.id('create-group-button')).tap();
    await waitFor(element(by.id('group-detail-screen'))).toBeVisible().withTimeout(40000);
    await device.enableSynchronization();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('navigates to spending screen from empty group', async () => {
    await device.disableSynchronization();
    await element(by.id('spending-link')).tap();
    await waitFor(element(by.id('spending-screen'))).toBeVisible().withTimeout(10000);
    await device.enableSynchronization();
  });

  it('shows empty state message', async () => {
    await waitFor(element(by.text('No spending data yet'))).toBeVisible().withTimeout(10000);
  });

  it('share button is disabled in empty state', async () => {
    const attrs = (await element(by.id('spending-share-btn')).getAttributes()) as { enabled?: boolean };
    expect(attrs.enabled).toBe(false);
  });
});
