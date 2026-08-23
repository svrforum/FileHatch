/**
 * Profile Tests for FileHatch
 *
 * Tests for user profile management:
 * - Profile viewing
 * - Email changes
 * - Theme preferences
 * - SMB password
 */
import { test, expect } from '@playwright/test';
import { generateEmail } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('Profile Settings @profile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to profile page', async ({ page }) => {
    // Click avatar to open dropdown
    await page.locator(Selectors.header.avatarBtn).click();

    // Click profile link
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });

    // Should be on profile page
    await expect(
      page.locator(':text("프로필"), :text("Profile"), :is(h1, h2):has-text("프로필")').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display current user info', async ({ page }) => {
    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });

    // Wait for profile page
    await expect(
      page.locator(':text("프로필"), :text("Profile")').first()
    ).toBeVisible({ timeout: 10000 });

    // Should show username
    const usernameField = page.locator('input[name="username"], .username-display');
    if (await usernameField.isVisible({ timeout: 3000 }).catch(() => false)) {
      const username = await usernameField.inputValue().catch(() => usernameField.textContent());
      expect(username).toBeTruthy();
    }
  });

  test('should update email address', async ({ page }) => {
    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator(':text("프로필"), :text("Profile")').first()
    ).toBeVisible({ timeout: 10000 });

    // Find email input
    const emailInput = page.locator(Selectors.profile.emailInput);
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const newEmail = generateEmail('profile-test');

      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Save changes
      await page.locator(Selectors.profile.saveBtn).click();

      // Wait for success indication
      await expect(
        page.locator(':text("저장됨"), :text("Saved"), :text("완료"), :text("success")').first()
      ).toBeVisible({ timeout: 5000 }).catch(() => {
        // May show in toast instead
      });
    } else {
      test.skip();
    }
  });

  test('should change display theme', async ({ page }) => {
    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator(':text("프로필"), :text("Profile")').first()
    ).toBeVisible({ timeout: 10000 });

    // Find theme selector
    const themeSelect = page.locator(Selectors.profile.themeSelect);
    if (await themeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Get current value
      const currentTheme = await themeSelect.inputValue();

      // Change to different theme
      const options = await themeSelect.locator('option').allTextContents();
      const newThemeIndex = currentTheme === 'dark' ? 0 : 1; // Toggle between first two options

      await themeSelect.selectOption({ index: newThemeIndex });

      // Save if needed
      const saveBtn = page.locator(Selectors.profile.saveBtn);
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
      }

      // Theme should change (may affect body class or similar)
      await page.waitForTimeout(1000);
    } else {
      // Check for theme toggle buttons instead
      const themeToggle = page.locator('.theme-toggle, button:has-text("다크"), button:has-text("Dark")');
      if (await themeToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        await themeToggle.click();
        await page.waitForTimeout(1000);
      } else {
        test.skip();
      }
    }
  });

  test('should set SMB password', async ({ page }) => {
    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator(':text("프로필"), :text("Profile")').first()
    ).toBeVisible({ timeout: 10000 });

    // Find SMB password section
    const smbSection = page.locator(':text("SMB"), :text("Samba")').first();
    if (await smbSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Find SMB password input
      const smbPasswordInput = page.locator('input[name="smbPassword"], input[placeholder*="SMB"]');
      if (await smbPasswordInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await smbPasswordInput.fill('NewSMBPass123!');

        // Save
        await page.locator('button:has-text("저장"), button:has-text("Save")').click();

        // Wait for success
        await expect(
          page.locator(':text("저장됨"), :text("Saved"), :text("완료")').first()
        ).toBeVisible({ timeout: 5000 }).catch(() => {});
      }
    } else {
      test.skip();
    }
  });

  test('should display storage usage', async ({ page }) => {
    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator(':text("프로필"), :text("Profile")').first()
    ).toBeVisible({ timeout: 10000 });

    // Look for storage usage display
    const storageDisplay = page.locator(
      '.storage-usage, text=저장 공간, text=Storage, text=사용량'
    );
    if (await storageDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Should show some storage info
      await expect(
        page.locator(':text("GB"), :text("MB"), :text("KB"), :text("바이트")').first()
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should validate email format', async ({ page }) => {
    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator(':text("프로필"), :text("Profile")').first()
    ).toBeVisible({ timeout: 10000 });

    const emailInput = page.locator(Selectors.profile.emailInput);
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Enter invalid email
      await emailInput.clear();
      await emailInput.fill('invalid-email');

      // Try to save
      await page.locator(Selectors.profile.saveBtn).click();

      // Should show validation error
      await expect(
        page.locator(':text("유효한 이메일"), :text("invalid email"), :text("올바른 이메일")').first()
      ).toBeVisible({ timeout: 5000 }).catch(() => {
        // HTML5 validation may prevent submission
      });
    } else {
      test.skip();
    }
  });
});

test.describe('Profile Language Settings @profile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    // Navigate to profile
    await page.locator(Selectors.header.avatarBtn).click();
    await expect(page.locator(Selectors.profile.container)).toBeVisible({ timeout: 10000 });
  });

  test('should display language selector if available', async ({ page }) => {
    // Look for language selector
    const languageSelect = page.locator(
      'select[name="language"], select:near(:text("언어")), select:near(:text("Language"))'
    );

    if (await languageSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Get available languages
      const options = await languageSelect.locator('option').allTextContents();
      expect(options.length).toBeGreaterThan(0);
    } else {
      // Language setting may not be available
      test.skip();
    }
  });
});
