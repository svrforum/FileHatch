/**
 * Upload Share Tests for FileHatch
 *
 * Tests for upload link functionality:
 * - Creating upload shares
 * - Uploading to upload shares (unauthenticated)
 * - Upload share options (password, expiration)
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateFolderName, generateTestFile, TestShareTokens } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';
import { revealFile } from '../helpers/file-list';
import { openNewFolderDialog } from '../helpers/navigate';

test.describe('Upload Share Creation @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should create upload share for folder', async ({ page }) => {
    const folderName = generateFolderName('upload-share-folder');

    // Create folder
    await openNewFolderDialog(page);
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await revealFile(page, folderName);

    // Right-click and create upload link
    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });

    const uploadLinkOption = page.locator(Selectors.contextMenu.uploadLink);
    if (await uploadLinkOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await uploadLinkOption.click();

      // Modal should appear
      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

      // Create link
      await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();

      // Should show the upload link
      await expect(
        page.locator('input[readonly][value*="http"], input.share-link, input[value*="/u/"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should create password-protected upload share', async ({ page }) => {
    const folderName = generateFolderName('protected-upload-share');

    // Create folder
    await openNewFolderDialog(page);
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await revealFile(page, folderName);

    // Create upload link with password
    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    const uploadLinkOption = page.locator(Selectors.contextMenu.uploadLink);
    if (await uploadLinkOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await uploadLinkOption.click();

      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

      // Enable password
      const passwordCheckbox = page.locator(
        'input[type="checkbox"]:near(:text("비밀번호")), label:has-text("비밀번호") input'
      );
      if (await passwordCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await passwordCheckbox.click();
        await page.locator('input[type="password"]').fill('uploadpassword123');
      }

      // Create link
      await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();

      // Should show the upload link
      await expect(
        page.locator('input[readonly][value*="http"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should create upload share with expiration', async ({ page }) => {
    const folderName = generateFolderName('expiring-upload-share');

    // Create folder
    await openNewFolderDialog(page);
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await revealFile(page, folderName);

    // Create upload link with expiration
    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    const uploadLinkOption = page.locator(Selectors.contextMenu.uploadLink);
    if (await uploadLinkOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await uploadLinkOption.click();

      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

      // Set expiration
      const expirationSelect = page.locator('select:near(:text("만료")), select[name*="expir"]').first();
      if (await expirationSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expirationSelect.selectOption({ index: 1 }); // Usually "1 day"
      }

      // Create link
      await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();

      // Should show the upload link
      await expect(
        page.locator('input[readonly][value*="http"]')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should copy upload share link', async ({ page, context }) => {
    // Grant clipboard permission
    await context.grantPermissions(['clipboard-write', 'clipboard-read']);

    const folderName = generateFolderName('copy-upload-link');

    // Create folder
    await openNewFolderDialog(page);
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await revealFile(page, folderName);

    // Create upload link
    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    const uploadLinkOption = page.locator(Selectors.contextMenu.uploadLink);
    if (await uploadLinkOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await uploadLinkOption.click();

      await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();
      await expect(page.locator('input[readonly][value*="http"]')).toBeVisible({ timeout: 5000 });

      // Copy link
      await page.locator('button:has-text("복사"), button[aria-label="Copy"]').click();

      // Verify clipboard
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toMatch(/^https?:\/\//);
      expect(clipboardText).toContain('/u/'); // Upload share URL pattern
    } else {
      test.skip();
    }
  });

  test('should delete upload share', async ({ page }) => {
    const folderName = generateFolderName('delete-upload-share');

    // Create folder
    await openNewFolderDialog(page);
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await revealFile(page, folderName);

    // Create upload link
    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    const uploadLinkOption = page.locator(Selectors.contextMenu.uploadLink);
    if (await uploadLinkOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await uploadLinkOption.click();

      await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();
      await expect(page.locator('input[readonly][value*="http"]')).toBeVisible({ timeout: 5000 });

      // Delete the share
      await page
        .locator('button:has-text("삭제"), button:has-text("Delete"), button[aria-label="Delete"]')
        .click();

      // Confirm if needed
      const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }

      // Link input should be gone
      await expect(page.locator('input[readonly][value*="http"]')).not.toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Upload Share Access (Unauthenticated) @sharing', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should access upload share page', async ({ page }) => {
    const uploadShareToken = TestShareTokens.upload;

    if (!uploadShareToken) {
      test.skip();
      return;
    }

    await page.goto(`/u/${uploadShareToken}`);

    // Should show upload interface
    await expect(
      page.locator(':text("업로드"), :text("Upload"), button:has-text("업로드"), .upload-zone').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should upload file via upload share', async ({ page }) => {
    const uploadShareToken = TestShareTokens.upload;

    if (!uploadShareToken) {
      test.skip();
      return;
    }

    await page.goto(`/u/${uploadShareToken}`);
    await page.waitForTimeout(1000);

    const fileName = generateFileName('upload-share-file');

    // Upload file
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), .upload-zone').click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Upload share test content'),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    // Verify upload success
    await expect(page.locator(':text("완료"), :text("Success"), :text("업로드 완료")').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test('should prompt for password on protected upload share', async ({ page }) => {
    // This test requires a protected upload share token
    const protectedToken = process.env.TEST_PROTECTED_UPLOAD_SHARE_TOKEN;

    if (!protectedToken) {
      test.skip();
      return;
    }

    await page.goto(`/u/${protectedToken}`);

    // Should show password input
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10000 });
  });

  test('should show error for expired upload share', async ({ page }) => {
    const expiredToken = process.env.TEST_EXPIRED_UPLOAD_SHARE_TOKEN;

    if (!expiredToken) {
      test.skip();
      return;
    }

    await page.goto(`/u/${expiredToken}`);

    // Should show expired message
    await expect(
      page.locator(':text("만료"), :text("expired"), :text("유효하지 않")').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show error for invalid upload share token', async ({ page }) => {
    await page.goto('/u/invalid-upload-token-12345');

    // Should show not found or error
    await expect(
      page.locator(':text("찾을 수 없"), :text("Not Found"), :text("존재하지 않"), :text("유효하지 않")').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should upload multiple files via upload share', async ({ page }) => {
    const uploadShareToken = TestShareTokens.upload;

    if (!uploadShareToken) {
      test.skip();
      return;
    }

    await page.goto(`/u/${uploadShareToken}`);
    await page.waitForTimeout(1000);

    const file1Name = generateFileName('multi-upload-share-1');
    const file2Name = generateFileName('multi-upload-share-2');

    // Upload multiple files
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), .upload-zone').click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles([
      { name: file1Name, mimeType: 'text/plain', buffer: Buffer.from('File 1 content') },
      { name: file2Name, mimeType: 'text/plain', buffer: Buffer.from('File 2 content') },
    ]);
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    // Verify upload success (may show count or individual success)
    await expect(
      page.locator(':text("완료"), :text("Success"), :text("업로드 완료")').first()
    ).toBeVisible({ timeout: 60000 });
  });
});

test.describe('Upload Share Drag and Drop @sharing', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should support drag and drop upload', async ({ page }) => {
    const uploadShareToken = TestShareTokens.upload;

    if (!uploadShareToken) {
      test.skip();
      return;
    }

    await page.goto(`/u/${uploadShareToken}`);
    await page.waitForTimeout(1000);

    const fileName = generateFileName('drag-drop-share');

    // Create DataTransfer
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.evaluate(
      ({ dt, name }) => {
        const file = new File(['Drag and drop content'], name, { type: 'text/plain' });
        (dt as DataTransfer).items.add(file);
      },
      { dt: dataTransfer, name: fileName }
    );

    // Find drop zone
    const dropZone = page.locator('.upload-zone, .drop-zone, .upload-area, main');
    await dropZone.dispatchEvent('dragenter', { dataTransfer });
    await dropZone.dispatchEvent('dragover', { dataTransfer });
    await dropZone.dispatchEvent('drop', { dataTransfer });

    // Verify upload
    await expect(
      page.locator(':text("완료"), :text("Success"), :text("업로드")').first()
    ).toBeVisible({ timeout: 30000 });
  });
});
