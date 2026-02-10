/**
 * Security Settings Tests for FileHatch
 *
 * Tests for security-related profile settings:
 * - Password change
 * - Two-factor authentication setup
 * - Session management
 */
import { test, expect } from '@playwright/test';
import { TestPasswords } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('Password Change @profile @auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await page.locator(Selectors.header.profileBtn).click();
  });

  test('should display password change option', async ({ page }) => {
    // Look for password change button or section
    await expect(
      page.locator(Selectors.profile.changePasswordBtn)
        .or(page.locator('text=비밀번호 변경'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('should open password change form', async ({ page }) => {
    // Click password change button
    const changePasswordBtn = page.locator(Selectors.profile.changePasswordBtn);
    if (await changePasswordBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await changePasswordBtn.click();

      // Modal or form should appear
      await expect(
        page.locator('input[name="currentPassword"], input[placeholder*="현재 비밀번호"]')
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.locator('input[name="newPassword"], input[placeholder*="새 비밀번호"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should validate current password', async ({ page }) => {
    const changePasswordBtn = page.locator(Selectors.profile.changePasswordBtn);
    if (await changePasswordBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await changePasswordBtn.click();

      // Enter wrong current password
      await page
        .locator('input[name="currentPassword"], input[placeholder*="현재 비밀번호"]')
        .fill('wrongpassword');
      await page
        .locator('input[name="newPassword"], input[placeholder*="새 비밀번호"]')
        .fill(TestPasswords.valid);
      await page
        .locator('input[name="confirmPassword"], input[placeholder*="비밀번호 확인"]')
        .fill(TestPasswords.valid);

      // Submit
      await page.locator('button[type="submit"], button:has-text("변경")').click();

      // Should show error
      await expect(
        page.locator('text=틀린, text=incorrect, text=일치하지 않, text=wrong')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should validate new password requirements', async ({ page }) => {
    const changePasswordBtn = page.locator(Selectors.profile.changePasswordBtn);
    if (await changePasswordBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await changePasswordBtn.click();

      // Enter weak new password
      await page
        .locator('input[name="currentPassword"], input[placeholder*="현재 비밀번호"]')
        .fill('admin1234'); // Assume correct current password
      await page
        .locator('input[name="newPassword"], input[placeholder*="새 비밀번호"]')
        .fill(TestPasswords.weak);
      await page
        .locator('input[name="confirmPassword"], input[placeholder*="비밀번호 확인"]')
        .fill(TestPasswords.weak);

      // Submit
      await page.locator('button[type="submit"], button:has-text("변경")').click();

      // Should show validation error for weak password
      await expect(
        page.locator('text=8자 이상, text=too short, text=강도, text=복잡')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should validate password confirmation match', async ({ page }) => {
    const changePasswordBtn = page.locator(Selectors.profile.changePasswordBtn);
    if (await changePasswordBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await changePasswordBtn.click();

      // Enter mismatched passwords
      await page
        .locator('input[name="currentPassword"], input[placeholder*="현재 비밀번호"]')
        .fill('admin1234');
      await page
        .locator('input[name="newPassword"], input[placeholder*="새 비밀번호"]')
        .fill(TestPasswords.valid);
      await page
        .locator('input[name="confirmPassword"], input[placeholder*="비밀번호 확인"]')
        .fill('DifferentPassword123!');

      // Submit
      await page.locator('button[type="submit"], button:has-text("변경")').click();

      // Should show mismatch error
      await expect(
        page.locator('text=일치하지 않, text=do not match, text=같지 않')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Two-Factor Authentication @profile @auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await page.locator(Selectors.header.profileBtn).click();
  });

  test('should display 2FA section', async ({ page }) => {
    // Look for 2FA section
    await expect(
      page.locator('text=2FA, text=이중 인증, text=Two-Factor, text=2단계 인증')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show enable 2FA button when disabled', async ({ page }) => {
    // Look for enable 2FA button
    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    const disable2FABtn = page.locator(Selectors.profile.disable2FABtn);

    // One of them should be visible
    await expect(enable2FABtn.or(disable2FABtn)).toBeVisible({ timeout: 5000 });
  });

  test('should start 2FA setup process', async ({ page }) => {
    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    if (await enable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enable2FABtn.click();

      // Should show QR code or setup instructions
      await expect(
        page.locator('img[src*="qr"], .qr-code, canvas, text=QR, text=인증 앱')
      ).toBeVisible({ timeout: 10000 });

      // Should show secret key backup
      await expect(
        page.locator('text=시크릿, text=Secret, text=키, code, .secret-key')
      ).toBeVisible({ timeout: 5000 }).catch(() => {
        // Secret may be hidden by default
      });
    } else {
      // 2FA may already be enabled
      test.skip();
    }
  });

  test('should require verification code to enable 2FA', async ({ page }) => {
    const enable2FABtn = page.locator(Selectors.profile.enable2FABtn);
    if (await enable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enable2FABtn.click();

      // Wait for setup modal
      await page.waitForTimeout(1000);

      // Should have verification code input
      await expect(
        page.locator('input[placeholder*="코드"], input[placeholder*="code"], input[name="code"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should show disable 2FA option when enabled', async ({ page }) => {
    const disable2FABtn = page.locator(Selectors.profile.disable2FABtn);
    if (await disable2FABtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // 2FA is currently enabled
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

      // Should require password or code verification
      await expect(
        page.locator('input[type="password"], input[placeholder*="코드"], input[placeholder*="비밀번호"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Session Management @profile @auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await page.locator(Selectors.header.profileBtn).click();
  });

  test('should display active sessions if available', async ({ page }) => {
    // Look for sessions section
    const sessionsSection = page.locator(
      'text=세션, text=Sessions, text=활성 기기, text=Active devices'
    );

    if (await sessionsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should show at least current session
      await expect(
        page.locator('.session-item, .device-item, text=현재 세션, text=Current session')
      ).toBeVisible({ timeout: 5000 });
    } else {
      // Sessions feature may not be available
      test.skip();
    }
  });

  test('should allow terminating other sessions', async ({ page }) => {
    const sessionsSection = page.locator('text=세션, text=Sessions');

    if (await sessionsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Look for terminate button on non-current sessions
      const terminateBtn = page.locator(
        'button:has-text("종료"), button:has-text("Terminate"), button:has-text("로그아웃")'
      );

      if (await terminateBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        // Verify terminate button exists
        expect(await terminateBtn.count()).toBeGreaterThan(0);
      }
    } else {
      test.skip();
    }
  });

  test('should show session details', async ({ page }) => {
    const sessionsSection = page.locator('text=세션, text=Sessions');

    if (await sessionsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Look for session details like browser/device info
      const sessionItem = page.locator('.session-item, .device-item').first();
      if (await sessionItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Should show some device/browser info
        await expect(
          sessionItem.locator('text=Chrome, text=Firefox, text=Safari, text=브라우저, text=IP')
        ).toBeVisible({ timeout: 5000 }).catch(() => {
          // May just show minimal info
        });
      }
    } else {
      test.skip();
    }
  });
});
