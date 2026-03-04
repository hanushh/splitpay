import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

/**
 * Requires an existing test account to be available.
 * Set TEST_EMAIL and TEST_PASSWORD as env vars, or update the constants below.
 */
const TEST_EMAIL = process.env.E2E_EMAIL ?? 'e2e@paysplit.test';
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'TestPass123!';

async function signIn() {
  await waitFor(element(by.id('email-input'))).toBeVisible().withTimeout(5000);
  await element(by.id('email-input')).typeText(TEST_EMAIL);
  await element(by.id('password-input')).typeText(TEST_PASSWORD);
  await element(by.text('Sign In')).tap();
  await waitFor(element(by.text('Groups')))
    .toBeVisible()
    .withTimeout(15000);
}

describe('Add Expense flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await signIn();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('shows groups tab after login', async () => {
    await detoxExpect(element(by.text('Groups'))).toBeVisible();
  });

  it('opens add-expense modal via FAB', async () => {
    await element(by.id('fab-add-expense')).tap();
    await waitFor(element(by.text('Add Expense')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('save button is disabled without required fields', async () => {
    await detoxExpect(element(by.id('save-button'))).toHaveAttribute('disabled', 'true');
  });

  it('fills in description', async () => {
    await element(by.id('description-input')).typeText('Team Lunch');
    await detoxExpect(element(by.id('description-input'))).toHaveText('Team Lunch');
  });

  it('fills in amount', async () => {
    await element(by.id('amount-input')).typeText('60.00');
    await detoxExpect(element(by.id('amount-input'))).toHaveText('60.00');
  });

  it('selects a group', async () => {
    await element(by.id('group-picker')).tap();
    await waitFor(element(by.id('group-list'))).toBeVisible().withTimeout(5000);
    // Pick the first group in the list
    await element(by.id('group-list-item-0')).tap();
  });

  it('members are loaded and selected by default', async () => {
    await waitFor(element(by.id('member-list'))).toBeVisible().withTimeout(5000);
    await detoxExpect(element(by.id('member-chip-0'))).toBeVisible();
  });

  it('save button becomes enabled with all required fields', async () => {
    await detoxExpect(element(by.id('save-button'))).not.toHaveAttribute('disabled', 'true');
  });

  it('saves expense and returns to groups screen', async () => {
    await element(by.id('save-button')).tap();
    await waitFor(element(by.text('Groups')))
      .toBeVisible()
      .withTimeout(10000);
  });
});

describe('Groups tab', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
  });

  it('shows at least one group', async () => {
    await waitFor(element(by.id('groups-list'))).toBeVisible().withTimeout(8000);
    await detoxExpect(element(by.id('group-card-0'))).toBeVisible();
  });

  it('tapping a group navigates to detail screen', async () => {
    await element(by.id('group-card-0')).tap();
    await waitFor(element(by.id('group-detail-screen')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('back button returns to groups list', async () => {
    await element(by.id('back-button')).tap();
    await detoxExpect(element(by.text('Groups'))).toBeVisible();
  });
});

describe('Friends tab', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
  });

  it('navigates to Friends tab', async () => {
    await element(by.text('Friends')).tap();
    await waitFor(element(by.id('friends-screen')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('search filters the friends list', async () => {
    await element(by.id('friends-search')).typeText('xyz_nonexistent');
    await waitFor(element(by.text(/no friends|empty/i)))
      .toBeVisible()
      .withTimeout(3000);
    await element(by.id('friends-search')).clearText();
  });

  it('shows invite friend button', async () => {
    await detoxExpect(element(by.id('invite-friend-button'))).toBeVisible();
  });
});

describe('Account tab', () => {
  it('navigates to Account tab', async () => {
    await element(by.text('Account')).tap();
    await waitFor(element(by.id('account-screen'))).toBeVisible().withTimeout(5000);
  });

  it('shows currency picker', async () => {
    await detoxExpect(element(by.id('currency-picker'))).toBeVisible();
  });

  it('can change currency', async () => {
    await element(by.id('currency-picker')).tap();
    await waitFor(element(by.text('USD'))).toBeVisible().withTimeout(3000);
    await element(by.text('USD')).tap();
    await detoxExpect(element(by.text('USD'))).toBeVisible();
  });

  it('sign out button is visible', async () => {
    await detoxExpect(element(by.id('sign-out-button'))).toBeVisible();
  });
});
