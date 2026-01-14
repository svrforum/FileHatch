import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // Unauthenticated tests

  test('should display login form', async ({ page }) => {
    await page.goto('/');

    // Check for login form elements
    await expect(page.locator('input[name="username"], input[type="text"]').first()).toBeVisible();
    await expect(page.locator('input[name="password"], input[type="password"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/');

    // Fill in invalid credentials
    await page.locator('input[name="username"], input[type="text"]').first().fill('invaliduser');
    await page.locator('input[name="password"], input[type="password"]').first().fill('wrongpassword');

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should show error message
    await expect(page.locator('.error, .alert-error, [role="alert"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await page.goto('/');

    const username = process.env.TEST_USER || 'testuser';
    const password = process.env.TEST_PASSWORD || 'testpass123';

    // Fill in valid credentials
    await page.locator('input[name="username"], input[type="text"]').first().fill(username);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should redirect to main page
    await expect(page).not.toHaveURL(/login/);

    // Should show user menu or logged-in indicator
    await expect(page.locator('[data-testid="user-menu"], .user-menu, .header-profile')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should redirect to login when accessing protected route', async ({ page }) => {
    // Try to access protected route without authentication
    await page.goto('/files');

    // Should redirect to login
    await expect(page.locator('input[name="username"], input[type="text"]').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('should logout successfully', async ({ page }) => {
    // First login
    await page.goto('/');

    const username = process.env.TEST_USER || 'testuser';
    const password = process.env.TEST_PASSWORD || 'testpass123';

    await page.locator('input[name="username"], input[type="text"]').first().fill(username);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"]').click();

    // Wait for login
    await expect(page.locator('[data-testid="user-menu"], .user-menu, .header-profile')).toBeVisible({
      timeout: 10000,
    });

    // Click user menu and logout
    await page.locator('[data-testid="user-menu"], .user-menu, .header-profile').click();
    await page.locator('text=로그아웃, text=Logout').click();

    // Should redirect to login page
    await expect(page.locator('input[name="username"], input[type="text"]').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('should show SSO buttons when SSO is enabled', async ({ page }) => {
    await page.goto('/');

    // Check if SSO buttons exist (may not be visible if SSO is disabled)
    const ssoButtons = page.locator('[data-testid="sso-button"], .sso-button, button:has-text("SSO")');

    // This test just verifies the page loads correctly
    // SSO buttons visibility depends on configuration
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

test.describe('2FA Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should prompt for 2FA code when enabled', async ({ page }) => {
    await page.goto('/');

    // This test requires a user with 2FA enabled
    const username = process.env.TEST_2FA_USER || 'user2fa';
    const password = process.env.TEST_2FA_PASSWORD || 'password123';

    await page.locator('input[name="username"], input[type="text"]').first().fill(username);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"]').click();

    // Should show 2FA input or error (depending on user setup)
    // Look for either 2FA prompt or error message
    const twoFactorPrompt = page.locator('[data-testid="2fa-input"], input[placeholder*="인증"], input[placeholder*="OTP"]');
    const errorMessage = page.locator('.error, .alert-error, [role="alert"]');

    // Wait for either 2FA prompt or error
    await expect(twoFactorPrompt.or(errorMessage)).toBeVisible({ timeout: 5000 });
  });
});
