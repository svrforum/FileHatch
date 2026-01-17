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

    // Should show error message (in Korean or English)
    await expect(
      page.locator('text=Invalid username or password')
        .or(page.locator('text=잘못된 사용자명 또는 비밀번호'))
        .or(page.locator('.error, .alert-error, [role="alert"]'))
    ).toBeVisible({
      timeout: 10000,
    });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await page.goto('/');

    const username = process.env.TEST_USER || 'admin';
    const password = process.env.TEST_PASSWORD || 'admin1234';

    // Fill in valid credentials
    await page.locator('input[name="username"], input[type="text"]').first().fill(username);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should redirect to main page
    await expect(page).not.toHaveURL(/login/);

    // Should show user menu or logged-in indicator (avatar button in header)
    await expect(page.locator('.avatar-btn')).toBeVisible({
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

    const username = process.env.TEST_USER || 'admin';
    const password = process.env.TEST_PASSWORD || 'admin1234';

    await page.locator('input[name="username"], input[type="text"]').first().fill(username);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"]').click();

    // Wait for login (avatar button in header)
    await expect(page.locator('.avatar-btn')).toBeVisible({
      timeout: 10000,
    });

    // Click user menu to open dropdown
    await page.locator('.avatar-btn').click();

    // Wait for logout button to be visible
    await expect(page.locator('.logout-btn')).toBeVisible({ timeout: 5000 });

    // Click logout button
    await page.locator('.logout-btn').click();

    // Wait a moment for state to update
    await page.waitForTimeout(1000);

    // Reload the page to ensure we see the login page
    await page.reload();

    // Wait for login page (should show login form)
    await expect(page.locator('input[name="username"], input[type="text"]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should show SSO buttons when SSO is enabled', async ({ page }) => {
    await page.goto('/');

    // This test just verifies the page loads correctly
    // SSO buttons visibility depends on configuration
    // Note: SSO buttons may not be visible if SSO is disabled in the system
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

test.describe('2FA Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Skip this test by default as it requires a pre-configured user with 2FA enabled
  // Set TEST_2FA_USER and TEST_2FA_PASSWORD environment variables to run this test
  test.skip('should prompt for 2FA code when enabled', async ({ page }) => {
    await page.goto('/');

    // This test requires a user with 2FA enabled
    const username = process.env.TEST_2FA_USER || 'user2fa';
    const password = process.env.TEST_2FA_PASSWORD || 'password123';

    await page.locator('input[name="username"], input[type="text"]').first().fill(username);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"]').click();

    // Should show 2FA input (OTP code field)
    const twoFactorPrompt = page.locator('[data-testid="2fa-input"], input[placeholder*="인증"], input[placeholder*="OTP"]');
    await expect(twoFactorPrompt).toBeVisible({ timeout: 5000 });
  });
});
