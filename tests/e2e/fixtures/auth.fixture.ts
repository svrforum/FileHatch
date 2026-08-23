/**
 * Authentication Fixture for E2E Tests
 *
 * Provides reusable authentication utilities for logging in,
 * logging out, and handling initial setup scenarios.
 */
import { Page, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';
import { navigateVia } from '../helpers/navigate';

export interface UserCredentials {
  username: string;
  password: string;
}

export const DEFAULT_USER: UserCredentials = {
  username: process.env.TEST_USER || 'admin',
  password: process.env.TEST_PASSWORD || 'admin1234',
};

export const DEFAULT_ADMIN: UserCredentials = {
  username: process.env.TEST_ADMIN || 'admin',
  password: process.env.TEST_ADMIN_PASSWORD || 'admin1234',
};

export class AuthFixture {
  constructor(private page: Page) {}

  /**
   * Login with the specified credentials
   */
  async login(credentials: UserCredentials = DEFAULT_USER): Promise<void> {
    await this.page.goto('/');

    // Wait for login form
    await expect(
      this.page.locator('input[name="username"], input[type="text"]').first()
    ).toBeVisible();

    // Fill credentials
    await this.page
      .locator('input[name="username"], input[type="text"]')
      .first()
      .fill(credentials.username);
    await this.page
      .locator('input[name="password"], input[type="password"]')
      .first()
      .fill(credentials.password);

    // Submit
    await this.page.locator('button[type="submit"]').click();

    // Wait for login to complete
    await expect(this.page).toHaveURL(/.*(?!login)/);
    await this.handleInitialSetupIfNeeded();
    await expect(this.page.locator('.avatar-btn')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Logout the current user
   */
  async logout(): Promise<void> {
    await this.page.locator('.avatar-btn').click();
    await expect(this.page.locator('.logout-btn')).toBeVisible({ timeout: 5000 });
    await this.page.locator('.logout-btn').click();
    await this.page.waitForTimeout(1000);
    await this.page.reload();
    await expect(
      this.page.locator('input[name="username"], input[type="text"]').first()
    ).toBeVisible({ timeout: 15000 });
  }

  /**
   * Handle initial setup modal if it appears (for default admin account)
   */
  async handleInitialSetupIfNeeded(): Promise<boolean> {
    await this.page.waitForTimeout(1000);

    const setupModal = this.page.locator('.initial-setup-modal');
    const isSetupVisible = await setupModal.isVisible().catch(() => false);

    if (isSetupVisible) {
      const newUsername = 'testadmin';
      const newPassword = 'TestAdmin123!';

      await this.page.locator('#newUsername').fill(newUsername);
      await this.page.locator('#newPassword').fill(newPassword);
      await this.page.locator('#confirmPassword').fill(newPassword);
      await this.page.locator('.initial-setup-submit').click();

      await this.page.waitForTimeout(2000);
      await expect(this.page.locator('.avatar-btn')).toBeVisible({ timeout: 15000 });
      return true;
    }

    return false;
  }

  /**
   * Navigate to admin mode
   */
  async enterAdminMode(): Promise<void> {
    await navigateVia(this.page, Selectors.header.adminBtn);
    await expect(this.page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Exit admin mode and return to files
   */
  async exitAdminMode(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.locator('.file-list-wrapper')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if user is logged in
   */
  async isLoggedIn(): Promise<boolean> {
    return await this.page.locator('.avatar-btn').isVisible().catch(() => false);
  }

  /**
   * Check if user is admin
   */
  async isAdmin(): Promise<boolean> {
    return await this.page
      .locator('.admin-btn:has-text("관리자 모드")')
      .isVisible()
      .catch(() => false);
  }

  /**
   * Open user profile menu
   */
  async openProfileMenu(): Promise<void> {
    await this.page.locator('.avatar-btn').click();
    await expect(this.page.locator('.user-dropdown')).toBeVisible({ timeout: 5000 });
  }

  /**
   * Navigate to profile settings
   */
  async goToProfile(): Promise<void> {
    await this.openProfileMenu();
    await this.page.locator('.profile-btn, a:has-text("프로필")').click();
    await expect(
      this.page.locator(':is(h1, h2):has-text("프로필"), :is(h1, h2):has-text("Profile")')
    ).toBeVisible({ timeout: 10000 });
  }
}
