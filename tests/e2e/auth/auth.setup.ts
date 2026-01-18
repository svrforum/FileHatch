import { test as setup, expect, Page } from '@playwright/test';
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

// Helper function to handle initial setup modal if it appears
// Returns true if setup was completed, false otherwise
async function handleInitialSetupIfNeeded(page: Page): Promise<boolean> {
  // Wait a moment for the modal to appear if needed
  await page.waitForTimeout(1000);

  // Check if initial setup modal is visible
  const setupModal = page.locator('.initial-setup-modal');
  const isSetupVisible = await setupModal.isVisible().catch(() => false);

  if (isSetupVisible) {
    console.log('Initial setup modal detected, completing setup...');

    // Fill in new username (using id selector)
    await page.locator('#newUsername').fill(NEW_ADMIN_USERNAME);

    // Fill in new password
    await page.locator('#newPassword').fill(NEW_ADMIN_PASSWORD);

    // Fill in confirm password
    await page.locator('#confirmPassword').fill(NEW_ADMIN_PASSWORD);

    // Submit the setup form
    await page.locator('.initial-setup-submit').click();

    // Wait for setup to complete - page will reload
    await page.waitForTimeout(2000);

    // After reload, wait for the avatar button to appear
    await expect(page.locator('.avatar-btn')).toBeVisible({ timeout: 15000 });

    console.log('Initial setup completed successfully');
    return true;
  }

  return false;
}

setup('authenticate as user', async ({ page }) => {
  // Go to login page
  await page.goto('/');

  // Wait for login form
  await expect(page.locator('input[name="username"], input[type="text"]').first()).toBeVisible();

  // Fill in credentials
  await page.locator('input[name="username"], input[type="text"]').first().fill(TEST_USER.username);
  await page.locator('input[name="password"], input[type="password"]').first().fill(TEST_USER.password);

  // Click login button
  await page.locator('button[type="submit"]').click();

  // Wait for successful login - should redirect to main page
  await expect(page).toHaveURL(/.*(?!login)/);

  // Handle initial setup modal if it appears (for default admin account)
  const setupCompleted = await handleInitialSetupIfNeeded(page);

  // Verify user is logged in by checking for user-specific elements (avatar button)
  // Skip if already verified during setup completion
  if (!setupCompleted) {
    await expect(page.locator('.avatar-btn')).toBeVisible({
      timeout: 10000,
    });
  }

  // Save authentication state
  await page.context().storageState({ path: userAuthFile });
});

setup('authenticate as admin', async ({ page }) => {
  // Go to login page
  await page.goto('/');

  // Wait for login form
  await expect(page.locator('input[name="username"], input[type="text"]').first()).toBeVisible();

  // Fill in admin credentials
  await page.locator('input[name="username"], input[type="text"]').first().fill(TEST_ADMIN.username);
  await page.locator('input[name="password"], input[type="password"]').first().fill(TEST_ADMIN.password);

  // Click login button
  await page.locator('button[type="submit"]').click();

  // Wait for successful login
  await expect(page).toHaveURL(/.*(?!login)/);

  // Handle initial setup modal if it appears (for default admin account)
  const setupCompleted = await handleInitialSetupIfNeeded(page);

  // Verify admin is logged in (avatar button)
  // Skip if already verified during setup completion
  if (!setupCompleted) {
    await expect(page.locator('.avatar-btn')).toBeVisible({
      timeout: 10000,
    });
  }

  // Save admin authentication state
  await page.context().storageState({ path: adminAuthFile });
});
