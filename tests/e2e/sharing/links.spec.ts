import { test, expect } from '@playwright/test';

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
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Share test content'),
    });

    // Click start upload button
    await page.locator('button:has-text("업로드 시작")').click();

    // Wait for file to appear
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await page.locator(`text=${fileName}`).click({ button: 'right' });

    // Click share option
    await page.locator('text=링크로 공유').first().click();

    // Wait for share modal
    await expect(page.locator('[data-testid="share-modal"], .share-modal, .modal')).toBeVisible({
      timeout: 5000,
    });

    // Create share link
    await page.locator('button:has-text("링크 생성"), button:has-text("Create Link"), button:has-text("공유 링크")').click();

    // Verify link is generated
    await expect(page.locator('input[readonly], input[value*="http"], .share-link')).toBeVisible({
      timeout: 5000,
    });
  });

  test('should create password-protected share', async ({ page }) => {
    const fileName = `protected-share-${Date.now()}.txt`;

    // Upload file
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Protected share content'),
    });

    await page.locator('button:has-text("업로드 시작")').click();
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).click({ button: 'right' });
    await page.locator('text=링크로 공유').first().click();

    // Enable password protection
    await page.locator('input[type="checkbox"]:near(:text("비밀번호")), label:has-text("비밀번호") input').click();

    // Set password
    await page.locator('input[type="password"], input[placeholder*="비밀번호"]').fill('sharepassword123');

    // Create share
    await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();

    // Verify share is created with password indicator
    await expect(page.locator('input[readonly], .share-link')).toBeVisible({ timeout: 5000 });
  });

  test('should create share with expiration', async ({ page }) => {
    const fileName = `expiring-share-${Date.now()}.txt`;

    // Upload file
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Expiring share content'),
    });

    await page.locator('button:has-text("업로드 시작")').click();
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).click({ button: 'right' });
    await page.locator('text=링크로 공유').first().click();

    // Set expiration (select 1 day or similar option)
    await page.locator('select:near(:text("만료")), select[name*="expir"]').selectOption({ index: 1 });

    // Create share
    await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();

    // Verify share is created
    await expect(page.locator('input[readonly], .share-link')).toBeVisible({ timeout: 5000 });
  });

  test('should copy share link to clipboard', async ({ page, context }) => {
    const fileName = `copy-link-${Date.now()}.txt`;

    // Grant clipboard permission
    await context.grantPermissions(['clipboard-write', 'clipboard-read']);

    // Upload file
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Copy link test'),
    });

    await page.locator('button:has-text("업로드 시작")').click();
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).click({ button: 'right' });
    await page.locator('text=링크로 공유').first().click();

    // Create share
    await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();

    // Click copy button
    await page.locator('button:has-text("복사"), button[aria-label="Copy"], button:has(:text("copy"))').click();

    // Verify clipboard contains URL
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/^https?:\/\//);
  });

  test('should delete share link', async ({ page }) => {
    const fileName = `delete-share-${Date.now()}.txt`;

    // Upload file and create share
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Delete share test'),
    });

    await page.locator('button:has-text("업로드 시작")').click();
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Open share modal
    await page.locator(`text=${fileName}`).click({ button: 'right' });
    await page.locator('text=링크로 공유').first().click();

    // Create share
    await page.locator('button:has-text("링크 생성"), button:has-text("Create")').click();
    await expect(page.locator('input[readonly], .share-link')).toBeVisible({ timeout: 5000 });

    // Delete share
    await page.locator('button:has-text("삭제"), button:has-text("Delete"), button[aria-label="Delete"]').click();

    // Confirm deletion if needed
    const confirmButton = page.locator('button:has-text("확인"), button:has-text("Confirm")');
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    // Verify share is deleted (link input should be gone or show no shares)
    await expect(page.locator('input[readonly][value*="http"]')).not.toBeVisible({ timeout: 5000 });
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
    await expect(page.locator('text=다운로드, text=Download, button:has-text("다운로드")')).toBeVisible({
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
    await expect(page.locator('text=만료, text=expired, text=유효하지 않')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show 404 for invalid share token', async ({ page }) => {
    await page.goto('/s/invalid-token-12345');

    // Should show not found or error
    await expect(page.locator('text=찾을 수 없, text=Not Found, text=존재하지 않')).toBeVisible({
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

    // Verify upload success
    await expect(page.locator('text=완료, text=Success, text=업로드 완료')).toBeVisible({
      timeout: 30000,
    });
  });
});
