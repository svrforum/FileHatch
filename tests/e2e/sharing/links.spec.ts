import { test, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';

test.describe('Share Links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-list-wrapper')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should create download share link', async ({ page }) => {
    const fileName = `share-test-${Date.now()}.txt`;

    // Upload a file first
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Share test content'),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    // Click start upload button

    // Wait for file to appear
    await expect(page.locator(`text=${fileName}`).first()).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await page.locator(`text=${fileName}`).first().click({ button: 'right' });

    // Click share option
    await page.locator(Selectors.contextMenu.share).click();
    await expect(page.locator(Selectors.linkShareModal.container)).toBeVisible({ timeout: 5000 });

    // Create share link
    await page.locator(Selectors.linkShareModal.createBtn).click();

    // Verify link is generated
    await expect(page.locator(Selectors.linkShareModal.createdUrl).first()).toHaveValue(/^https?:\/\//, {
      timeout: 5000,
    });
  });

  test('should create password-protected share', async ({ page }) => {
    const fileName = `protected-share-${Date.now()}.txt`;

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Protected share content'),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    await expect(page.locator(`text=${fileName}`).first()).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.share).click();
    await expect(page.locator(Selectors.linkShareModal.container)).toBeVisible({ timeout: 5000 });

    // Enable password protection
    await page.locator(Selectors.linkShareModal.option.password).click();

    // Set password (the create button stays disabled until it is filled)
    await page.locator(Selectors.linkShareModal.passwordInput).fill('sharepassword123');

    // Create share
    await page.locator(Selectors.linkShareModal.createBtn).click();

    // Verify share is created with password indicator
    await expect(page.locator(Selectors.linkShareModal.createdUrl).first()).toHaveValue(/^https?:\/\//, { timeout: 5000 });
  });

  test('should create share with expiration', async ({ page }) => {
    const fileName = `expiring-share-${Date.now()}.txt`;

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Expiring share content'),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    await expect(page.locator(`text=${fileName}`).first()).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.share).click();
    await expect(page.locator(Selectors.linkShareModal.container)).toBeVisible({ timeout: 5000 });

    // Set expiration (select 1 day or similar option)
    await page.locator(Selectors.linkShareModal.option.expiry).click();

    // Create share
    await page.locator(Selectors.linkShareModal.createBtn).click();

    // Verify share is created
    await expect(page.locator(Selectors.linkShareModal.createdUrl).first()).toHaveValue(/^https?:\/\//, { timeout: 5000 });
  });

  test('should copy share link to clipboard', async ({ page, context }) => {
    const fileName = `copy-link-${Date.now()}.txt`;

    // Grant clipboard permission
    await context.grantPermissions(['clipboard-write', 'clipboard-read']);

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Copy link test'),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    await expect(page.locator(`text=${fileName}`).first()).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.share).click();
    await expect(page.locator(Selectors.linkShareModal.container)).toBeVisible({ timeout: 5000 });

    // Create share
    await page.locator(Selectors.linkShareModal.createBtn).click();

    // Click copy button
    await page.locator(Selectors.linkShareModal.copyBtn).click();

    // Verify clipboard contains URL
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/^https?:\/\//);
  });

  test('should delete share link', async ({ page }) => {
    const fileName = `delete-share-${Date.now()}.txt`;

    // Upload file and create share
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Delete share test'),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    await expect(page.locator(`text=${fileName}`).first()).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.share).click();
    await expect(page.locator(Selectors.linkShareModal.container)).toBeVisible({ timeout: 5000 });

    // Create share
    await page.locator(Selectors.linkShareModal.createBtn).click();
    await expect(page.locator(Selectors.linkShareModal.createdUrl).first()).toHaveValue(/^https?:\/\//, { timeout: 5000 });

    /*
     * LinkShareModal deletes behind a native confirm(); the handler must be
     * attached before the click or Playwright cancels the dialog for us.
     */
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator(Selectors.linkShareModal.existingDeleteBtn).first().click();

    // Verify share is deleted (link input should be gone or show no shares)
    // Two readonly inputs carry the same URL (the "just created" box and the
    // row in 기존 공유 링크), so assert on the rows themselves.
    await expect(page.locator(Selectors.linkShareModal.existingDeleteBtn)).toHaveCount(0, { timeout: 5000 });
  });
});

test.describe('Share Access (Unauthenticated)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should access public share link', async ({ page }) => {
    // This test requires a pre-created share link
    // In a real scenario, we'd use API to create a share first
    const shareToken = process.env.TEST_SHARE_TOKEN;

    if (!shareToken) {
      test.skip();
      return;
    }

    await page.goto(`/s/${shareToken}`);

    // Should show share access page or download prompt
    await expect(page.locator(':text("다운로드"), :text("Download"), button:has-text("다운로드")').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should prompt for password on protected share', async ({ page }) => {
    const protectedShareToken = process.env.TEST_PROTECTED_SHARE_TOKEN;

    if (!protectedShareToken) {
      test.skip();
      return;
    }

    await page.goto(`/s/${protectedShareToken}`);

    // Should show password input
    await expect(page.locator('input[type="password"], input[placeholder*="비밀번호"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show error for expired share', async ({ page }) => {
    const expiredShareToken = process.env.TEST_EXPIRED_SHARE_TOKEN;

    if (!expiredShareToken) {
      test.skip();
      return;
    }

    await page.goto(`/s/${expiredShareToken}`);

    // Should show expired message
    await expect(page.locator(':text("만료"), :text("expired"), :text("유효하지 않")').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show 404 for invalid share token', async ({ page }) => {
    await page.goto('/s/invalid-token-12345');

    // Should show not found or error
    await expect(page.locator(':text("찾을 수 없"), :text("Not Found"), :text("존재하지 않")').first()).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Upload Share', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should upload file via upload share', async ({ page }) => {
    const uploadShareToken = process.env.TEST_UPLOAD_SHARE_TOKEN;

    if (!uploadShareToken) {
      test.skip();
      return;
    }

    await page.goto(`/u/${uploadShareToken}`);

    const fileName = `upload-share-${Date.now()}.txt`;

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
});
