/**
 * Share Operations Fixture for E2E Tests
 *
 * Provides reusable utilities for sharing files and folders,
 * including link shares, user shares, and upload shares.
 */
import { Page, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';

export interface ShareOptions {
  password?: string;
  expiration?: 'none' | '1day' | '7days' | '30days';
  downloadLimit?: number;
}

export interface UserShareOptions {
  username: string;
  permission: 'read' | 'write' | 'admin';
}

export class ShareFixture {
  private createdShares: string[] = [];

  constructor(private page: Page) {}

  /**
   * Create a download share link
   */
  async createDownloadShare(fileName: string, options: ShareOptions = {}): Promise<string> {
    await this.openShareModal(fileName);

    // Set password if provided
    if (options.password) {
      await this.page
        .locator('input[type="checkbox"]:near(:text("비밀번호")), label:has-text("비밀번호") input')
        .click();
      await this.page
        .locator('input[type="password"], input[placeholder*="비밀번호"]')
        .fill(options.password);
    }

    // Set expiration if provided
    if (options.expiration && options.expiration !== 'none') {
      const expirationSelect = this.page.locator('select:near(:text("만료")), select[name*="expir"]');
      if (await expirationSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        const optionIndex =
          options.expiration === '1day' ? 1 : options.expiration === '7days' ? 2 : 3;
        await expirationSelect.selectOption({ index: optionIndex });
      }
    }

    // Create share link
    await this.page
      .locator('button:has-text("링크 생성"), button:has-text("Create Link"), button:has-text("공유 링크")')
      .click();

    // Get the share link
    await expect(
      this.page.locator('input[readonly], input[value*="http"], .share-link')
    ).toBeVisible({ timeout: 5000 });

    const linkInput = this.page.locator('input[readonly][value*="http"], input.share-link').first();
    const shareUrl = await linkInput.inputValue();

    this.createdShares.push(shareUrl);
    return shareUrl;
  }

  /**
   * Open share modal for a file
   */
  async openShareModal(fileName: string): Promise<void> {
    await this.page.locator(`text=${fileName}`).click({ button: 'right' });
    await this.page.locator('text=링크로 공유').first().click();
    await expect(
      this.page.locator('[data-testid="share-modal"], .share-modal, .modal')
    ).toBeVisible({ timeout: 5000 });
  }

  /**
   * Copy share link to clipboard
   */
  async copyShareLink(): Promise<string> {
    await this.page
      .locator('button:has-text("복사"), button[aria-label="Copy"], button:has(:text("copy"))')
      .click();
    const clipboardText = await this.page.evaluate(() => navigator.clipboard.readText());
    return clipboardText;
  }

  /**
   * Delete a share link
   */
  async deleteShare(): Promise<void> {
    await this.page
      .locator('button:has-text("삭제"), button:has-text("Delete"), button[aria-label="Delete"]')
      .click();

    // Confirm deletion if needed
    const confirmButton = this.page.locator(Selectors.confirmModal.confirmBtn);
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    await expect(this.page.locator('input[readonly][value*="http"]')).not.toBeVisible({
      timeout: 5000,
    });
  }

  /**
   * Close share modal
   */
  async closeShareModal(): Promise<void> {
    await this.page
      .locator('button:has-text("닫기"), button:has-text("Close"), .modal-close')
      .click();
    await expect(this.page.locator('.share-modal, .modal')).not.toBeVisible({ timeout: 3000 });
  }

  /**
   * Share with a specific user
   */
  async shareWithUser(fileName: string, options: UserShareOptions): Promise<void> {
    await this.page.locator(`text=${fileName}`).click({ button: 'right' });
    await this.page.locator(':text("사용자와 공유"), :text("사용자에게 공유")').first().click();

    await expect(this.page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

    // Search for user
    await this.page
      .locator('input[placeholder*="사용자"], input[placeholder*="user"], input[name="username"]')
      .fill(options.username);

    // Wait for user to appear in search results and click
    await this.page.locator(`text=${options.username}`).first().click();

    // Set permission
    const permissionSelect = this.page.locator('select[name="permission"], select:near(:text("권한"))');
    if (await permissionSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await permissionSelect.selectOption(options.permission);
    }

    // Confirm share
    await this.page.locator('button:has-text("공유"), button:has-text("Share")').click();

    // Wait for confirmation
    await expect(
      this.page.locator(':text("공유됨"), :text("Shared"), :text("완료")')
    ).toBeVisible({ timeout: 5000 }).catch(() => {});
  }

  /**
   * Create an upload share link
   */
  async createUploadShare(folderName: string, options: ShareOptions = {}): Promise<string> {
    await this.page.locator(`text=${folderName}`).click({ button: 'right' });
    await this.page.locator('text=업로드 링크').first().click();

    await expect(this.page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

    // Set password if provided
    if (options.password) {
      const passwordCheckbox = this.page.locator(
        'input[type="checkbox"]:near(:text("비밀번호")), label:has-text("비밀번호") input'
      );
      if (await passwordCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await passwordCheckbox.click();
        await this.page.locator('input[type="password"]').fill(options.password);
      }
    }

    // Create link
    await this.page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();

    // Get the share link
    await expect(this.page.locator('input[readonly][value*="http"]')).toBeVisible({ timeout: 5000 });
    const linkInput = this.page.locator('input[readonly][value*="http"]').first();
    const shareUrl = await linkInput.inputValue();

    this.createdShares.push(shareUrl);
    return shareUrl;
  }

  /**
   * Access a share link (unauthenticated)
   */
  async accessShareLink(shareUrl: string): Promise<void> {
    await this.page.goto(shareUrl);
    await this.page.waitForTimeout(1000);
  }

  /**
   * Download from share page
   */
  async downloadFromShare(): Promise<string> {
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.locator('button:has-text("다운로드"), button:has-text("Download")').click();
    const download = await downloadPromise;
    return download.suggestedFilename();
  }

  /**
   * Enter password for protected share
   */
  async enterSharePassword(password: string): Promise<void> {
    await this.page.locator('input[type="password"]').fill(password);
    await this.page.locator('button:has-text("확인"), button:has-text("Submit")').click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Upload file to upload share
   */
  async uploadToShare(fileName: string, content: string = 'Upload share content'): Promise<void> {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.page
      .locator('[data-testid="upload-btn"], button:has-text("업로드"), .upload-zone')
      .click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(content),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    await expect(this.page.locator(':text("완료"), :text("Success"), :text("업로드 완료")')).toBeVisible({
      timeout: 30000,
    });
  }

  /**
   * Get list of files shared with me
   */
  async goToSharedWithMe(): Promise<void> {
    await this.page.goto('/');
    await this.page.locator('.sidebar-item:has-text("나와 공유된"), a:has-text("Shared with me")').click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Get list of files I shared
   */
  async goToMyShares(): Promise<void> {
    await this.page.goto('/');
    await this.page.locator('.sidebar-item:has-text("내가 공유한"), a:has-text("My shares")').click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Go to shared drives/folders
   */
  async goToSharedDrives(): Promise<void> {
    await this.page.goto('/');
    await this.page.locator('.sidebar-item:has-text("공유 드라이브"), a:has-text("Shared drives")').click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Cleanup created shares
   */
  async cleanup(): Promise<void> {
    // Note: In a real scenario, we'd delete shares via API
    // For now, just clear the tracking array
    this.createdShares = [];
  }
}
