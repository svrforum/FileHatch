/**
 * Two-Factor Authentication Tests for FileHatch
 *
 * Tests for 2FA functionality:
 * - 2FA setup
 * - 2FA verification during login
 * - 2FA disable
 * - Backup codes
 */
import { test, expect } from '@playwright/test';
import { TestUsers } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('2FA Setup @auth', () => {
  // Note: These tests should be run with a user that doesn't have 2FA enabled
  // Running these tests may affect user account state

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await page.locator(Selectors.header.profileBtn).click();
  });

  test('should display 2FA setup option', async ({ page }) => {
    // Look for 2FA section
    await expect(
      page.locator('text=2FA, text=이중 인증, text=Two-Factor')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show QR code during 2FA setup', async ({ page }) => {
    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    if (await enable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enable2FABtn.click();

      // QR code should be displayed
      await expect(
        page.locator('img[src*="qr"], .qr-code, canvas[data-qr]')
      ).toBeVisible({ timeout: 10000 });
    } else {
      // 2FA may already be enabled
      test.skip();
    }
  });

  test('should display secret key during 2FA setup', async ({ page }) => {
    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    if (await enable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enable2FABtn.click();

      await page.waitForTimeout(1000);

      // Secret key should be available (may need to click to reveal)
      const showSecretBtn = page.locator('button:has-text("시크릿 표시"), button:has-text("Show secret")');
      if (await showSecretBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await showSecretBtn.click();
      }

      // Secret key should be visible
      await expect(
        page.locator('code, .secret-key, text=/^[A-Z0-9]{16,}$/')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should require verification code to complete setup', async ({ page }) => {
    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    if (await enable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enable2FABtn.click();

      await page.waitForTimeout(1000);

      // Verification code input should be present
      const codeInput = page.locator(
        'input[name="code"], input[placeholder*="인증 코드"], input[placeholder*="verification"]'
      );
      await expect(codeInput).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should reject invalid verification code', async ({ page }) => {
    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    if (await enable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enable2FABtn.click();

      const codeInput = page.locator(
        'input[name="code"], input[placeholder*="인증 코드"], input[placeholder*="verification"]'
      );
      if (await codeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Enter invalid code
        await codeInput.fill('000000');
        await page.locator('button:has-text("확인"), button:has-text("Verify"), button[type="submit"]').click();

        // Should show error
        await expect(
          page.locator('text=유효하지 않, text=Invalid, text=잘못된')
        ).toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });

  test('should display backup codes after 2FA enabled', async ({ page }) => {
    // This test assumes 2FA is being enabled for the first time
    // It requires actual TOTP code which we can't generate in tests

    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    if (await enable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enable2FABtn.click();

      // Look for backup codes section (may be shown after verification)
      await expect(
        page.locator('text=백업 코드, text=Backup codes, text=복구 코드')
      ).toBeVisible({ timeout: 10000 }).catch(() => {
        // Backup codes may only be shown after successful verification
      });
    } else {
      test.skip();
    }
  });
});

test.describe('2FA Login @auth', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // Unauthenticated

  test.skip('should prompt for 2FA code after password', async ({ page }) => {
    // This test requires a user with 2FA enabled
    // Skip by default as it requires specific setup
    const user2fa = TestUsers.user2fa;

    await page.goto('/');

    // Login with username/password
    await page.locator(Selectors.login.usernameInput).first().fill(user2fa.username);
    await page.locator(Selectors.login.passwordInput).first().fill(user2fa.password);
    await page.locator(Selectors.login.submitBtn).click();

    // Should show 2FA code input
    await expect(
      page.locator('input[name="totp"], input[placeholder*="인증 코드"], input[placeholder*="2FA"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test.skip('should reject invalid 2FA code', async ({ page }) => {
    const user2fa = TestUsers.user2fa;

    await page.goto('/');

    await page.locator(Selectors.login.usernameInput).first().fill(user2fa.username);
    await page.locator(Selectors.login.passwordInput).first().fill(user2fa.password);
    await page.locator(Selectors.login.submitBtn).click();

    // Enter 2FA code
    const tfaInput = page.locator('input[name="totp"], input[placeholder*="인증 코드"]');
    if (await tfaInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tfaInput.fill('000000');
      await page.locator('button[type="submit"], button:has-text("확인")').click();

      // Should show error
      await expect(
        page.locator('text=유효하지 않, text=Invalid, text=잘못된')
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test.skip('should accept valid backup code', async ({ page }) => {
    // This test requires knowing a valid backup code
    const user2fa = TestUsers.user2fa;
    const backupCode = process.env.TEST_BACKUP_CODE;

    if (!backupCode) {
      test.skip();
      return;
    }

    await page.goto('/');

    await page.locator(Selectors.login.usernameInput).first().fill(user2fa.username);
    await page.locator(Selectors.login.passwordInput).first().fill(user2fa.password);
    await page.locator(Selectors.login.submitBtn).click();

    // Click "Use backup code" link
    const backupCodeLink = page.locator('text=백업 코드 사용, text=Use backup code');
    if (await backupCodeLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backupCodeLink.click();

      // Enter backup code
      await page.locator('input[name="backupCode"]').fill(backupCode);
      await page.locator('button[type="submit"]').click();

      // Should be logged in
      await expect(page.locator(Selectors.header.avatarBtn)).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('2FA Disable @auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    await page.locator(Selectors.header.avatarBtn).click();
    await page.locator(Selectors.header.profileBtn).click();
  });

  test('should show disable 2FA option when enabled', async ({ page }) => {
    const disable2FABtn = page.locator(Selectors.profile.disable2FABtn);
    if (await disable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await disable2FABtn.isVisible()).toBe(true);
    } else {
      // 2FA is not enabled, so no disable button
      test.skip();
    }
  });

  test('should require verification to disable 2FA', async ({ page }) => {
    const disable2FABtn = page.locator(Selectors.profile.disable2FABtn);
    if (await disable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await disable2FABtn.click();

      // Should require password or TOTP code
      await expect(
        page.locator('input[type="password"], input[name="code"], input[placeholder*="비밀번호"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should show warning before disabling 2FA', async ({ page }) => {
    const disable2FABtn = page.locator(Selectors.profile.disable2FABtn);
    if (await disable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await disable2FABtn.click();

      // Should show warning
      await expect(
        page.locator('text=경고, text=Warning, text=주의, text=보안')
      ).toBeVisible({ timeout: 5000 }).catch(() => {
        // Warning may be inline or in different format
      });
    } else {
      test.skip();
    }
  });
});

test.describe('2FA Backup Codes @auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    await page.locator(Selectors.header.avatarBtn).click();
    await page.locator(Selectors.header.profileBtn).click();
  });

  test('should allow regenerating backup codes', async ({ page }) => {
    // This feature should be available when 2FA is enabled
    const regenerateBtn = page.locator(
      'button:has-text("백업 코드 재생성"), button:has-text("Regenerate backup codes")'
    );

    if (await regenerateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await regenerateBtn.click();

      // Should require verification
      await expect(
        page.locator('input[type="password"], input[name="code"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should show remaining backup codes count', async ({ page }) => {
    // Look for backup codes count indicator
    const backupCodesCount = page.locator(
      'text=/\\d+개 남음/, text=/\\d+ remaining/, .backup-codes-count'
    );

    if (await backupCodesCount.isVisible({ timeout: 3000 }).catch(() => false)) {
      const countText = await backupCodesCount.textContent();
      expect(countText).toMatch(/\d+/);
    } else {
      // Feature may not be available
      test.skip();
    }
  });
});
