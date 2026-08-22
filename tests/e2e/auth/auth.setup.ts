import { test as setup, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const userAuthFile = path.join(__dirname, '../playwright/.auth/user.json');
const adminAuthFile = path.join(__dirname, '../playwright/.auth/admin.json');

// Test credentials - should be set via environment or use defaults for local testing
// Default admin account: admin/admin1234 (from 002_default_data.sql migration)
const TEST_USER = {
  username: process.env.TEST_USER || 'admin',
  password: process.env.TEST_PASSWORD || 'admin1234',
};

const TEST_ADMIN = {
  username: process.env.TEST_ADMIN || 'admin',
  password: process.env.TEST_ADMIN_PASSWORD || 'admin1234',
};

// New credentials for initial setup (used when admin account requires setup)
const NEW_ADMIN_USERNAME = 'testadmin';
const NEW_ADMIN_PASSWORD = 'TestAdmin123!';

// Shipped defaults, from migration 002_default_data.sql. Only when the caller
// is still using these is it safe to retry with the post-setup credentials.
const DEFAULT_ACCOUNT = { username: 'admin', password: 'admin1234' };

/**
 * Both storage states are produced by a single, serial sign-in.
 *
 * They used to be two independent setup tests. On a fresh database that
 * raced: the default account still needs the initial-setup flow, which
 * *renames the account and changes its password*. Whichever test got there
 * first rewrote the credentials out from under the other, so the loser
 * failed on "Invalid username or password". A failed setup makes every
 * dependent project report "did not run", which surfaces as a suite-wide
 * wall of skipped tests rather than one visible failure.
 *
 * TEST_USER and TEST_ADMIN point at the same account by default, so one
 * sign-in is enough. When they are configured differently, the admin state
 * is captured with its own sign-in - still serially, after the first one
 * has settled the initial-setup flow.
 */

async function completeInitialSetupIfPresent(page: Page): Promise<boolean> {
  await page.waitForTimeout(1000);

  const setupModal = page.locator('.initial-setup-modal');
  if (!(await setupModal.isVisible().catch(() => false))) {
    return false;
  }

  console.log('Initial setup modal detected, completing setup...');
  await page.locator('#newUsername').fill(NEW_ADMIN_USERNAME);
  await page.locator('#newPassword').fill(NEW_ADMIN_PASSWORD);
  await page.locator('#confirmPassword').fill(NEW_ADMIN_PASSWORD);
  await page.locator('.initial-setup-submit').click();

  // The page reloads once setup succeeds.
  await expect(page.locator('.avatar-btn')).toBeVisible({ timeout: 15000 });
  console.log('Initial setup completed successfully');
  return true;
}

/** One sign-in attempt. Returns the credentials that are valid afterwards. */
async function attemptSignIn(
  page: Page,
  credentials: { username: string; password: string }
): Promise<{ username: string; password: string } | null> {
  await page.goto('/');

  const usernameField = page.locator('input[name="username"], input[type="text"]').first();
  const passwordField = page.locator('input[name="password"], input[type="password"]').first();
  await expect(usernameField).toBeVisible();

  await usernameField.fill(credentials.username);
  await passwordField.fill(credentials.password);
  await page.locator('button[type="submit"]').click();

  if (await completeInitialSetupIfPresent(page)) {
    return { username: NEW_ADMIN_USERNAME, password: NEW_ADMIN_PASSWORD };
  }

  const loginError = page.locator('.login-error, .auth-error, [role="alert"]');
  if (await loginError.isVisible({ timeout: 2000 }).catch(() => false)) {
    return null;
  }

  await expect(page.locator('.avatar-btn')).toBeVisible({ timeout: 10000 });
  return credentials;
}

/**
 * Signs in, and returns the credentials that are valid afterwards - they
 * differ from the ones passed in when the initial-setup flow ran.
 *
 * The suite has to be runnable more than once against the same database.
 * Its own initial-setup step renames the default account and changes its
 * password, so on every run after the first, the documented defaults no
 * longer authenticate. Rather than requiring a database reset between runs,
 * fall back to the credentials this suite itself established.
 */
async function signIn(
  page: Page,
  credentials: { username: string; password: string }
): Promise<{ username: string; password: string }> {
  const first = await attemptSignIn(page, credentials);
  if (first) {
    return first;
  }

  const usingDefaults =
    credentials.username === DEFAULT_ACCOUNT.username &&
    credentials.password === DEFAULT_ACCOUNT.password;

  if (usingDefaults) {
    const retry = await attemptSignIn(page, {
      username: NEW_ADMIN_USERNAME,
      password: NEW_ADMIN_PASSWORD,
    });
    if (retry) {
      console.log(
        `Default credentials rejected; a previous run had already completed initial setup. ` +
          `Signed in as "${NEW_ADMIN_USERNAME}".`
      );
      return retry;
    }
  }

  throw new Error(
    `Sign-in failed for "${credentials.username}". ` +
      (usingDefaults
        ? `Neither the default account nor "${NEW_ADMIN_USERNAME}" (created by a previous run) was accepted. ` +
          `Reset the database, or set TEST_USER / TEST_PASSWORD to a working account.`
        : `Check TEST_USER / TEST_PASSWORD.`)
  );
}

setup('authenticate', async ({ page }) => {
  fs.mkdirSync(path.dirname(userAuthFile), { recursive: true });

  const effective = await signIn(page, TEST_USER);
  await page.context().storageState({ path: userAuthFile });

  const adminIsSameAccount =
    TEST_ADMIN.username === TEST_USER.username && TEST_ADMIN.password === TEST_USER.password;

  if (adminIsSameAccount) {
    // One account, one session - reuse it rather than racing a second sign-in.
    await page.context().storageState({ path: adminAuthFile });
    return;
  }

  // A distinct admin account: sign in separately, but only now that the
  // initial-setup flow above has finished.
  const adminPage = await page.context().browser()!.newPage();
  try {
    await signIn(adminPage, TEST_ADMIN);
    await adminPage.context().storageState({ path: adminAuthFile });
  } finally {
    await adminPage.close();
  }

  // `effective` differs from TEST_USER only when initial setup ran; log it so
  // a failing downstream test is traceable to the credentials actually used.
  console.log(`Authenticated as "${effective.username}"`);
});
