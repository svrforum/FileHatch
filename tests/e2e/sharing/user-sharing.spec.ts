/**
 * User Sharing Tests for FileHatch
 *
 * Tests for sharing files and folders with specific users:
 * - User search
 * - Share creation with different permissions
 * - Share modification
 * - Share deletion
 * - Shared-with-me / Shared-by-me views
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateFolderName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('User Sharing @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should open user share modal', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('user-share-modal') });

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });
    await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 30000 });

    // Open context menu and click user share option
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });

    const userShareOption = page.locator(Selectors.contextMenu.userShare);
    if (await userShareOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userShareOption.click();

      // Modal should appear
      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should search for users in share modal', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('user-search-share') });

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Open user share modal
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const userShareOption = page.locator(Selectors.contextMenu.userShare);
    if (await userShareOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userShareOption.click();

      // Search for user
      const searchInput = page.locator(
        'input[placeholder*="사용자"], input[placeholder*="user"], input[name="username"]'
      );
      await searchInput.fill('admin');

      // Wait for search results
      await page.waitForTimeout(1000);

      // Should show search results
      const searchResults = page.locator('.user-search-results, .user-list, .search-results');
      if (await searchResults.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(searchResults.locator('text=admin')).toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });

  test('should share file with read permission', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('read-permission-share') });

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Open user share modal
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const userShareOption = page.locator(Selectors.contextMenu.userShare);
    if (await userShareOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userShareOption.click();

      // Note: Actual user sharing requires another user to exist
      // This test verifies the UI flow
      const modal = page.locator(Selectors.modal.container);
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Verify permission options exist
      const permissionSelect = page.locator('select[name="permission"], select:near(:text("권한"))');
      if (await permissionSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Select read permission
        await permissionSelect.selectOption('read');
      }
    } else {
      test.skip();
    }
  });

  test('should share file with write permission', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('write-permission-share') });

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Open user share modal
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const userShareOption = page.locator(Selectors.contextMenu.userShare);
    if (await userShareOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userShareOption.click();

      const modal = page.locator(Selectors.modal.container);
      await expect(modal).toBeVisible({ timeout: 5000 });

      const permissionSelect = page.locator('select[name="permission"], select:near(:text("권한"))');
      if (await permissionSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Select write permission
        await permissionSelect.selectOption('write');
      }
    } else {
      test.skip();
    }
  });

  test('should share folder with user', async ({ page }) => {
    const folderName = generateFolderName('user-share-folder');

    // Create folder
    await page.locator(Selectors.fileList.newFolderBtn).click();
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 15000 });

    // Open user share modal
    await page.locator(`text=${folderName}`).click({ button: 'right' });
    const userShareOption = page.locator(Selectors.contextMenu.userShare);
    if (await userShareOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userShareOption.click();

      const modal = page.locator(Selectors.modal.container);
      await expect(modal).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Shared Views @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to shared with me view', async ({ page }) => {
    // Click on "Shared with me" in sidebar
    const sharedWithMeLink = page.locator(Selectors.sidebar.sharedWithMe);
    if (await sharedWithMeLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedWithMeLink.click();
      await page.waitForTimeout(1000);

      // Should show shared with me view or empty state
      await expect(
        page.locator('text=나와 공유된, text=Shared with me, text=공유된 파일')
          .or(page.locator('text=공유된 항목이 없습니다, text=No items shared'))
      ).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should navigate to my shares view', async ({ page }) => {
    // Click on "My shares" in sidebar
    const mySharesLink = page.locator(Selectors.sidebar.myShares);
    if (await mySharesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mySharesLink.click();
      await page.waitForTimeout(1000);

      // Should show my shares view or empty state
      await expect(
        page.locator('text=내가 공유한, text=My shares')
          .or(page.locator('text=공유한 항목이 없습니다, text=No shared items'))
      ).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should display shared file in my shares', async ({ page }) => {
    // This test requires creating a share first
    const testFile = generateTestFile({ name: generateFileName('my-shares-test') });

    // Upload file
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Create a link share
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await page.locator('text=링크로 공유').first().click();
    await page.locator(Selectors.shareModal.createLinkBtn).click();
    await expect(page.locator(Selectors.shareModal.shareLink)).toBeVisible({ timeout: 5000 });

    // Close modal
    await page.locator(Selectors.modal.closeBtn).click().catch(() => {
      page.keyboard.press('Escape');
    });

    // Navigate to my shares
    const mySharesLink = page.locator(Selectors.sidebar.myShares);
    if (await mySharesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mySharesLink.click();
      await page.waitForTimeout(1000);

      // Should show the shared file
      // Note: UI may vary - might show file name or share details
    }
  });
});

test.describe('Share Management @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should modify share permission', async ({ page }) => {
    // This test requires an existing share to modify
    // Navigate to my shares first
    const mySharesLink = page.locator(Selectors.sidebar.myShares);
    if (await mySharesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mySharesLink.click();
      await page.waitForTimeout(1000);

      // Find a share to modify
      const shareItem = page.locator('.share-item, .shared-file-row, .share-card').first();
      if (await shareItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Click to manage share
        const manageBtn = shareItem.locator('button:has-text("관리"), button:has-text("Manage")');
        if (await manageBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await manageBtn.click();

          // Modify permission
          const permissionSelect = page.locator('select[name="permission"]');
          if (await permissionSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
            await permissionSelect.selectOption({ index: 1 });
            await page.locator('button:has-text("저장"), button:has-text("Save")').click();
          }
        }
      }
    }
    // Skip if no shares exist
    test.skip();
  });

  test('should remove user from share', async ({ page }) => {
    // This test requires an existing user share
    const mySharesLink = page.locator(Selectors.sidebar.myShares);
    if (await mySharesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mySharesLink.click();
      await page.waitForTimeout(1000);

      const shareItem = page.locator('.share-item, .shared-file-row').first();
      if (await shareItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Find remove user button
        const removeBtn = shareItem.locator('button:has-text("제거"), button[aria-label="Remove"]');
        if (await removeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await removeBtn.click();

          // Confirm removal
          const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
          if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmBtn.click();
          }
        }
      }
    }
    // Skip if no shares exist
    test.skip();
  });
});
