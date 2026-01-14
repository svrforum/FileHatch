import { test as setup, expect } from '@playwright/test';
import path from 'path';

const userAuthFile = path.join(__dirname, '../playwright/.auth/user.json');
const adminAuthFile = path.join(__dirname, '../playwright/.auth/admin.json');

// Test credentials - should be set via environment or use defaults for local testing
const TEST_USER = {
  username: process.env.TEST_USER || 'testuser',
  password: process.env.TEST_PASSWORD || 'testpass123',
};

const TEST_ADMIN = {
  username: process.env.TEST_ADMIN || 'admin',
  password: process.env.TEST_ADMIN_PASSWORD || 'admin123',
};

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

  // Verify user is logged in by checking for user-specific elements
  await expect(page.locator('[data-testid="user-menu"], .user-menu, .header-profile')).toBeVisible({
    timeout: 10000,
  });

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

  // Verify admin is logged in
  await expect(page.locator('[data-testid="user-menu"], .user-menu, .header-profile')).toBeVisible({
    timeout: 10000,
  });

  // Save admin authentication state
  await page.context().storageState({ path: adminAuthFile });
});
