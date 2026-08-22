/**
 * Initial Setup Tests for FileHatch
 *
 * Tests for the initial setup flow that appears when
 * logging in with the default admin credentials.
 */
import { test, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';

test.describe('Initial Setup @auth', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // Unauthenticated

  // Note: These tests may modify the admin account state.
  // They should be run in isolation or with a fresh database.

  test.skip('should display initial setup modal on first admin login', async ({ page }) => {
    // This test requires a fresh database with default admin credentials
    // Skip by default as it modifies database state

    await page.goto('/');

    // Login with default admin credentials
    await page.locator(Selectors.login.usernameInput).first().fill('admin');
    await page.locator(Selectors.login.passwordInput).first().fill('admin1234');
    await page.locator(Selectors.login.submitBtn).click();

    // Wait for redirect
    await expect(page).toHaveURL(/.*(?!login)/);

    // Check if initial setup modal appears
    const setupModal = page.locator(Selectors.initialSetup.modal);
    await expect(setupModal).toBeVisible({ timeout: 10000 });

    // Verify modal contents
    await expect(page.locator(Selectors.initialSetup.usernameInput)).toBeVisible();
    await expect(page.locator(Selectors.initialSetup.passwordInput)).toBeVisible();
    await expect(page.locator(Selectors.initialSetup.confirmPasswordInput)).toBeVisible();
    await expect(page.locator(Selectors.initialSetup.submitBtn)).toBeVisible();
  });

  test.skip('should complete initial setup with valid credentials', async ({ page }) => {
    // Skip by default as it modifies database state

    await page.goto('/');

    // Login with default admin credentials
    await page.locator(Selectors.login.usernameInput).first().fill('admin');
    await page.locator(Selectors.login.passwordInput).first().fill('admin1234');
    await page.locator(Selectors.login.submitBtn).click();

    // Wait for setup modal
    const setupModal = page.locator(Selectors.initialSetup.modal);
    if (await setupModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      const newUsername = `admin${Date.now()}`.slice(0, 20);
      const newPassword = 'NewAdmin123!';

      // Fill setup form
      await page.locator(Selectors.initialSetup.usernameInput).fill(newUsername);
      await page.locator(Selectors.initialSetup.passwordInput).fill(newPassword);
      await page.locator(Selectors.initialSetup.confirmPasswordInput).fill(newPassword);

      // Submit
      await page.locator(Selectors.initialSetup.submitBtn).click();

      // Wait for redirect/reload
      await page.waitForTimeout(2000);

      // Should be logged in
      await expect(page.locator(Selectors.header.avatarBtn)).toBeVisible({ timeout: 15000 });
    } else {
      // Setup was already completed, verify logged in
      await expect(page.locator(Selectors.header.avatarBtn)).toBeVisible({ timeout: 15000 });
    }
  });

  test.skip('should validate username requirements', async ({ page }) => {
    // Skip by default as it modifies database state

    await page.goto('/');

    await page.locator(Selectors.login.usernameInput).first().fill('admin');
    await page.locator(Selectors.login.passwordInput).first().fill('admin1234');
    await page.locator(Selectors.login.submitBtn).click();

    const setupModal = page.locator(Selectors.initialSetup.modal);
    if (await setupModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try invalid username (too short)
      await page.locator(Selectors.initialSetup.usernameInput).fill('ab');
      await page.locator(Selectors.initialSetup.passwordInput).fill('ValidPass123!');
      await page.locator(Selectors.initialSetup.confirmPasswordInput).fill('ValidPass123!');
      await page.locator(Selectors.initialSetup.submitBtn).click();

      // Should show validation error
      await expect(
        page.locator(':text("3자 이상"), :text("too short"), :text("최소")').first()
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test.skip('should validate password requirements', async ({ page }) => {
    // Skip by default as it modifies database state

    await page.goto('/');

    await page.locator(Selectors.login.usernameInput).first().fill('admin');
    await page.locator(Selectors.login.passwordInput).first().fill('admin1234');
    await page.locator(Selectors.login.submitBtn).click();

    const setupModal = page.locator(Selectors.initialSetup.modal);
    if (await setupModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try weak password
      await page.locator(Selectors.initialSetup.usernameInput).fill('validuser');
      await page.locator(Selectors.initialSetup.passwordInput).fill('weak');
      await page.locator(Selectors.initialSetup.confirmPasswordInput).fill('weak');
      await page.locator(Selectors.initialSetup.submitBtn).click();

      // Should show validation error
      await expect(
        page.locator(':text("8자 이상"), :text("too short"), :text("최소")').first()
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test.skip('should validate password confirmation match', async ({ page }) => {
    // Skip by default as it modifies database state

    await page.goto('/');

    await page.locator(Selectors.login.usernameInput).first().fill('admin');
    await page.locator(Selectors.login.passwordInput).first().fill('admin1234');
    await page.locator(Selectors.login.submitBtn).click();

    const setupModal = page.locator(Selectors.initialSetup.modal);
    if (await setupModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try mismatched passwords
      await page.locator(Selectors.initialSetup.usernameInput).fill('validuser');
      await page.locator(Selectors.initialSetup.passwordInput).fill('ValidPass123!');
      await page.locator(Selectors.initialSetup.confirmPasswordInput).fill('DifferentPass123!');
      await page.locator(Selectors.initialSetup.submitBtn).click();

      // Should show validation error
      await expect(
        page.locator(':text("일치하지 않"), :text("do not match"), :text("비밀번호가 같지")').first()
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test.skip('should not allow dismissing initial setup modal', async ({ page }) => {
    // Skip by default as it modifies database state

    await page.goto('/');

    await page.locator(Selectors.login.usernameInput).first().fill('admin');
    await page.locator(Selectors.login.passwordInput).first().fill('admin1234');
    await page.locator(Selectors.login.submitBtn).click();

    const setupModal = page.locator(Selectors.initialSetup.modal);
    if (await setupModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try to close modal by clicking outside
      await page.locator('body').click({ position: { x: 10, y: 10 } });

      // Modal should still be visible
      await expect(setupModal).toBeVisible();

      // Try pressing Escape
      await page.keyboard.press('Escape');

      // Modal should still be visible (can't be dismissed without completing setup)
      await expect(setupModal).toBeVisible();
    } else {
      test.skip();
    }
  });
});

test.describe('Initial Setup - API Validation @auth', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should reject setup API call without authentication', async ({ request }) => {
    // Try to call the initial setup API without being logged in
    const response = await request.post('/api/auth/initial-setup', {
      data: {
        username: 'hackedadmin',
        password: 'HackedPass123!',
      },
    });

    // Should fail with 401 or 403
    expect([401, 403]).toContain(response.status());
  });
});
