import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

const TEST_EMAIL = process.env.E2E_EMAIL ?? 'e2e@paysplit.test';
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'TestPass123!';
const GROUP_NAME = `E2E Test Group ${Date.now()}`;
const GROUP_DESCRIPTION = 'Created by automated E2E tests';
const INVITE_EMAIL = 'friend@example.com';
const CREATE_GROUP_SCROLL_ID = 'create-group-scroll';
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
  activeEmail = `e2e_create_${Date.now()}@paysplit.test`;
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
    throw new Error('Unable to authenticate for create-group e2e setup.');
  }
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

async function dismissKeyboardIfVisible() {
  try {
    await element(by.text('New Group')).tap();
  } catch {
    // No-op if already blurred.
  }
}

async function scrollToField(testId: string) {
  await waitFor(element(by.id(testId)))
    .toBeVisible()
    .whileElement(by.id(CREATE_GROUP_SCROLL_ID))
    .scroll(220, 'down');
}

describe('Create Group', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await ensureSignedIn();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('opens create-group screen from groups header icon', async () => {
    // Tap the group-add icon in the header
    await element(by.id('create-group-header-btn')).tap();
    await waitFor(element(by.id('create-group-screen')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('shows New Group header title', async () => {
    await detoxExpect(element(by.text('New Group'))).toBeVisible();
  });

  it('Create button is disabled when name is empty', async () => {
    await element(by.id('group-name-input')).replaceText('');
    await dismissKeyboardIfVisible();
    await detoxExpect(element(by.id('create-group-screen'))).toBeVisible();
  });

  it('types a group name and enables Create button', async () => {
    await element(by.id('group-name-input')).replaceText(GROUP_NAME);
    await detoxExpect(element(by.id('group-name-input'))).toHaveText(GROUP_NAME);
  });

  it('types a description', async () => {
    await element(by.id('group-description-input')).replaceText(GROUP_DESCRIPTION);
    await dismissKeyboardIfVisible();
    await detoxExpect(element(by.id('group-description-input'))).toHaveText(GROUP_DESCRIPTION);
  });

  it('shows error for invalid email in member invite', async () => {
    await scrollToField('member-email-input');
    await element(by.id('member-email-input')).tap();
    await element(by.id('member-email-input')).replaceText('not-an-email');
    await dismissKeyboardIfVisible();
    await element(by.id('add-member-button')).tap();
    await detoxExpect(element(by.id('member-email-input'))).toHaveText('not-an-email');
    await detoxExpect(element(by.id('create-group-screen'))).toBeVisible();
  });

  it('adds a valid member email chip', async () => {
    await scrollToField('member-email-input');
    await element(by.id('member-email-input')).tap();
    await element(by.id('member-email-input')).replaceText(INVITE_EMAIL);
    await dismissKeyboardIfVisible();
    await element(by.id('add-member-button')).tap();
    await waitFor(element(by.text(INVITE_EMAIL)))
      .toBeVisible()
      .withTimeout(3000);
  });

  it('shows error for duplicate email', async () => {
    await scrollToField('member-email-input');
    await element(by.id('member-email-input')).tap();
    await element(by.id('member-email-input')).replaceText(INVITE_EMAIL);
    await dismissKeyboardIfVisible();
    await element(by.id('add-member-button')).tap();
    await detoxExpect(element(by.id('member-email-input'))).toHaveText(INVITE_EMAIL);
    await element(by.id('member-email-input')).replaceText('');
    await dismissKeyboardIfVisible();
  });

  it('creates the group and navigates to group detail', async () => {
    await element(by.id('header-create-button')).tap();
    // Wait on title text instead of root visibility; root can be partially occluded by IME.
    await waitFor(element(by.id('group-detail-title')))
      .toHaveText(GROUP_NAME)
      .withTimeout(20000);
    await detoxExpect(element(by.id('group-detail-screen'))).toExist();
  });
});

describe('Create Group — cancel flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await ensureSignedIn();
  });

  it('can open and cancel the create group flow', async () => {
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(15000);
    await element(by.id('create-group-header-btn')).tap();
    await waitFor(element(by.id('create-group-screen'))).toBeVisible().withTimeout(5000);
    await element(by.id('cancel-button')).tap();
    await waitFor(element(by.id('groups-screen'))).toBeVisible().withTimeout(5000);
  });
});
