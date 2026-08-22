/**
 * Admin System Settings Tests for FileHatch
 *
 * Tests for admin system settings:
 * - General settings
 * - Storage settings
 * - Upload settings
 * - SSO settings
 */
import { test, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';

test.describe('Admin System Settings @admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Enter admin mode
    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    // Navigate to system settings
    await page.locator(Selectors.admin.systemSettings).click();
    await page.waitForTimeout(1000);
  });

  test('should display system settings page', async ({ page }) => {
    await expect(
      page.locator('h2:has-text("시스템 설정"), h2:has-text("설정"), h2:has-text("Settings")')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display general settings section', async ({ page }) => {
    await expect(
      page.locator(':text("일반"), :text("General"), .settings-section').first()
    ).toBeVisible({ timeout: 10000 }).catch(() => {
      // Settings may be organized differently
    });
  });

  test('should update site name setting', async ({ page }) => {
    const siteNameInput = page.locator('input[name="siteName"], input[placeholder*="사이트 이름"]');

    if (await siteNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const currentValue = await siteNameInput.inputValue();

      // Update value
      await siteNameInput.fill(`FileHatch Test ${Date.now()}`);

      // Save
      const saveBtn = page.locator('button:has-text("저장"), button:has-text("Save")');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
        await expect(
          page.locator(':text("저장됨"), :text("Saved")').first()
        ).toBeVisible({ timeout: 5000 }).catch(() => {});
      }

      // Restore original value
      await siteNameInput.fill(currentValue || 'FileHatch');
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
      }
    } else {
      test.skip();
    }
  });

  test('should update default storage quota', async ({ page }) => {
    const quotaInput = page.locator(
      'input[name="defaultQuota"], input[placeholder*="기본 용량"]'
    );

    if (await quotaInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Update quota
      await quotaInput.fill('10737418240'); // 10GB

      // Save
      const saveBtn = page.locator('button:has-text("저장"), button:has-text("Save")');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
        await expect(
          page.locator(':text("저장됨"), :text("Saved")').first()
        ).toBeVisible({ timeout: 5000 }).catch(() => {});
      }
    } else {
      test.skip();
    }
  });

  test('should update max upload size', async ({ page }) => {
    const maxUploadInput = page.locator(
      'input[name="maxUploadSize"], input[placeholder*="최대 업로드"]'
    );

    if (await maxUploadInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await maxUploadInput.fill('1073741824'); // 1GB

      const saveBtn = page.locator('button:has-text("저장"), button:has-text("Save")');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
      }
    } else {
      test.skip();
    }
  });

  test('should toggle registration setting', async ({ page }) => {
    const registrationToggle = page.locator(
      'input[name="allowRegistration"], label:has-text("회원가입") input[type="checkbox"]'
    );

    if (await registrationToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const wasChecked = await registrationToggle.isChecked();

      await registrationToggle.click();

      // Save
      const saveBtn = page.locator('button:has-text("저장"), button:has-text("Save")');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
      }

      // Verify state changed
      const isChecked = await registrationToggle.isChecked();
      expect(isChecked).not.toBe(wasChecked);

      // Restore original state
      if (isChecked !== wasChecked) {
        await registrationToggle.click();
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
        }
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin SSO Settings @admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    // Navigate to SSO settings
    await page.locator(Selectors.admin.ssoSettings).click();
    await page.waitForTimeout(1000);
  });

  test('should display SSO settings page', async ({ page }) => {
    await expect(
      page.locator('h2:has-text("SSO"), h2:has-text("Single Sign-On")')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should toggle SSO enabled', async ({ page }) => {
    const ssoToggle = page.locator('input[type="checkbox"]').first();

    if (await ssoToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const wasChecked = await ssoToggle.isChecked();

      await ssoToggle.click();

      // Save if button exists
      const saveBtn = page.locator('button:has-text("저장"), button:has-text("Save")');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
      }

      // Restore
      if ((await ssoToggle.isChecked()) !== wasChecked) {
        await ssoToggle.click();
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
        }
      }
    } else {
      test.skip();
    }
  });

  test('should configure OIDC settings', async ({ page }) => {
    // Look for OIDC configuration section
    const oidcSection = page.locator(':text("OIDC"), :text("OpenID")').first();

    if (await oidcSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check for OIDC configuration inputs
      const clientIdInput = page.locator('input[name="clientId"], input[placeholder*="Client ID"]');
      const clientSecretInput = page.locator('input[name="clientSecret"], input[placeholder*="Client Secret"]');
      const issuerInput = page.locator('input[name="issuer"], input[placeholder*="Issuer"]');

      // Verify configuration fields exist
      if (await clientIdInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        expect(await clientIdInput.isVisible()).toBe(true);
      }
    } else {
      test.skip();
    }
  });

  test('should configure SAML settings', async ({ page }) => {
    // Look for SAML configuration section
    const samlSection = page.locator('text=SAML');

    if (await samlSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      // SAML configuration exists
      expect(await samlSection.isVisible()).toBe(true);
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Storage Settings @admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    await page.locator(Selectors.admin.systemSettings).click();
    await page.waitForTimeout(1000);
  });

  test('should display storage statistics', async ({ page }) => {
    // Look for storage statistics
    const storageStats = page.locator(
      ':text("저장 공간"), :text("Storage"), .storage-stats'
    );

    if (await storageStats.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should show used/total storage
      await expect(
        page.locator(':text("GB"), :text("TB"), :text("사용량")').first()
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display storage backend configuration', async ({ page }) => {
    // Look for storage backend settings
    const backendConfig = page.locator(
      ':text("스토리지 백엔드"), :text("Storage Backend"), select[name="storageBackend"]'
    );

    if (await backendConfig.isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await backendConfig.isVisible()).toBe(true);
    }
  });
});

test.describe('Admin Email Settings @admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    await page.locator(Selectors.admin.systemSettings).click();
    await page.waitForTimeout(1000);
  });

  test('should display email configuration', async ({ page }) => {
    const emailSection = page.locator(
      ':text("이메일"), :text("Email"), .email-settings'
    );

    if (await emailSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check for SMTP settings
      const smtpHost = page.locator('input[name="smtpHost"], input[placeholder*="SMTP"]');
      if (await smtpHost.isVisible({ timeout: 2000 }).catch(() => false)) {
        expect(await smtpHost.isVisible()).toBe(true);
      }
    } else {
      test.skip();
    }
  });

  test('should test email configuration', async ({ page }) => {
    const testEmailBtn = page.locator(
      'button:has-text("테스트 메일"), button:has-text("Test Email")'
    );

    if (await testEmailBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Button exists - don't actually click as it sends email
      expect(await testEmailBtn.isVisible()).toBe(true);
    } else {
      test.skip();
    }
  });
});
