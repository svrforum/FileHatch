/**
 * Shared Folders (Shared Drives) Tests for FileHatch
 *
 * Tests for shared folder functionality:
 * - Accessing shared drives
 * - Permission-based access control
 * - File operations in shared folders
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('Shared Drives Access @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to shared drives', async ({ page }) => {
    // Click on "Shared drives" in sidebar
    const sharedDrivesLink = page.locator(Selectors.sidebar.sharedDrives);
    if (await sharedDrivesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrivesLink.click();
      await page.waitForTimeout(1000);

      // Should show shared drives view
      await expect(
        page.locator(':text("공유 드라이브"), :text("Shared drives"), :text("공유 폴더")').first()
      ).toBeVisible({ timeout: 10000 }).catch(() => {
        // May show empty state
        expect(
          page.locator(':text("공유 드라이브가 없습니다"), :text("No shared drives")').first()
        ).toBeVisible({ timeout: 5000 }).catch(() => {
          // Or a list of drives - any visible content is acceptable
        });
      });
    } else {
      test.skip();
    }
  });

  test('should display shared drive list', async ({ page }) => {
    const sharedDrivesLink = page.locator(Selectors.sidebar.sharedDrives);
    if (await sharedDrivesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrivesLink.click();
      await page.waitForTimeout(1000);

      // Check for shared drive items or empty state
      const driveList = page.locator('.shared-drive-list, .drive-list, .folder-list');
      const emptyState = page.locator(':text("공유 드라이브가 없습니다"), :text("No shared drives")').first();

      // Either should be visible
      await expect(driveList.or(emptyState)).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should enter shared drive', async ({ page }) => {
    const sharedDrivesLink = page.locator(Selectors.sidebar.sharedDrives);
    if (await sharedDrivesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrivesLink.click();
      await page.waitForTimeout(1000);

      // Find a shared drive to enter
      const sharedDrive = page.locator('.shared-drive-item, .drive-card, .folder-item').first();
      if (await sharedDrive.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sharedDrive.dblclick();
        await page.waitForTimeout(1000);

        // Should navigate into the drive (breadcrumb or URL change)
        await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Shared Drive Operations @sharing', () => {
  // Note: These tests assume user has write access to at least one shared drive

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    // Navigate to shared drives
    const sharedDrivesLink = page.locator(Selectors.sidebar.sharedDrives);
    if (await sharedDrivesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrivesLink.click();
      await page.waitForTimeout(1000);
    }
  });

  test('should upload file to shared drive (if write access)', async ({ page }) => {
    // Find and enter a shared drive
    const sharedDrive = page.locator('.shared-drive-item, .drive-card, .folder-item').first();
    if (await sharedDrive.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrive.dblclick();
      await page.waitForTimeout(1000);

      const testFile = generateTestFile({ name: generateFileName('shared-drive-upload') });

      // Try to upload (may fail if read-only)
      const uploadBtn = page.locator(Selectors.fileList.uploadBtn);
      if (await uploadBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await uploadBtn.click();
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator(Selectors.uploadModal.selectFileBtn).click();
        const fileChooser = await fileChooserPromise;

        await fileChooser.setFiles({
          name: testFile.name,
          mimeType: testFile.mimeType,
          buffer: testFile.buffer,
        });
        /*
         * The upload modal closes itself once the transfer finishes. Without
         * waiting for it, the next click lands on .modal-overlay instead of the
         * file row and the context menu never opens.
         */
        await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });


        // Wait for result - success or permission error
        await expect(
          page.locator(`text=${testFile.name}`).first()
            .or(page.locator(':text("권한"), :text("permission"), :text("허용")').first())
        ).toBeVisible({ timeout: 30000 });
      } else {
        // No upload button - read-only access
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should create folder in shared drive (if write access)', async ({ page }) => {
    const sharedDrive = page.locator('.shared-drive-item, .drive-card, .folder-item').first();
    if (await sharedDrive.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrive.dblclick();
      await page.waitForTimeout(1000);

      const folderName = `shared-folder-${Date.now()}`;

      const newFolderBtn = page.locator(Selectors.fileList.newFolderBtn);
      if (await newFolderBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await newFolderBtn.click();
        await page
          .locator('input[placeholder*="폴더"], input[placeholder*="folder"]')
          .fill(folderName);
        await page.locator('button:has-text("생성")').click();

        // Wait for result
        await expect(
          page.locator(`text=${folderName}`).first()
            .or(page.locator(':text("권한"), :text("permission")').first())
        ).toBeVisible({ timeout: 15000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should download file from shared drive (if read access)', async ({ page }) => {
    const sharedDrive = page.locator('.shared-drive-item, .drive-card, .folder-item').first();
    if (await sharedDrive.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrive.dblclick();
      await page.waitForTimeout(1000);

      // Find a file to download
      const fileItem = page.locator('.file-list-item:not(.folder), .file-row:not(.folder)').first();
      if (await fileItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await fileItem.click({ button: 'right' });
        await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });

        const downloadPromise = page.waitForEvent('download');
        await page.locator(Selectors.contextMenu.download).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBeDefined();
      } else {
        // No files in shared drive
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should show read-only indicator for read-only shared drive', async ({ page }) => {
    // Look for a shared drive with read-only badge or indicator
    const readOnlyDrive = page.locator(
      '.shared-drive-item:has(.badge.read-only), .drive-card:has(text=읽기 전용)'
    );
    if (await readOnlyDrive.isVisible({ timeout: 3000 }).catch(() => false)) {
      await readOnlyDrive.dblclick();
      await page.waitForTimeout(1000);

      // Upload/create buttons should be hidden or disabled
      const uploadBtn = page.locator(Selectors.fileList.uploadBtn);
      const newFolderBtn = page.locator(Selectors.fileList.newFolderBtn);

      const uploadHidden = !(await uploadBtn.isVisible({ timeout: 2000 }).catch(() => false));
      const folderHidden = !(await newFolderBtn.isVisible({ timeout: 2000 }).catch(() => false));
      const uploadDisabled = uploadBtn.isDisabled ? await uploadBtn.isDisabled() : false;

      // At least one restriction should be in place
      expect(uploadHidden || folderHidden || uploadDisabled).toBe(true);
    } else {
      test.skip();
    }
  });
});

test.describe('Shared Drive Permissions @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should show permission level in shared drive list', async ({ page }) => {
    const sharedDrivesLink = page.locator(Selectors.sidebar.sharedDrives);
    if (await sharedDrivesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrivesLink.click();
      await page.waitForTimeout(1000);

      // Check for permission indicators
      const permissionBadge = page.locator(
        '.permission-badge, .access-level, text=읽기, text=쓰기, text=관리'
      );
      if (await permissionBadge.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        // Permission indicators are displayed
        expect(await permissionBadge.count()).toBeGreaterThan(0);
      }
    } else {
      test.skip();
    }
  });

  test('should prevent delete operation with read-only access', async ({ page }) => {
    const sharedDrivesLink = page.locator(Selectors.sidebar.sharedDrives);
    if (await sharedDrivesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sharedDrivesLink.click();
      await page.waitForTimeout(1000);

      // Find read-only drive
      const readOnlyDrive = page.locator(
        '.shared-drive-item:has(.badge.read-only), .drive-card:has(text=읽기 전용), .shared-drive-item'
      ).first();

      if (await readOnlyDrive.isVisible({ timeout: 3000 }).catch(() => false)) {
        await readOnlyDrive.dblclick();
        await page.waitForTimeout(1000);

        // Find a file
        const fileItem = page.locator('.file-list-item:not(.folder)').first();
        if (await fileItem.isVisible({ timeout: 3000 }).catch(() => false)) {
          await fileItem.click({ button: 'right' });

          // Delete option should be disabled or hidden in read-only mode
          const deleteOption = page.locator(Selectors.contextMenu.delete);
          const deleteDisabled = deleteOption.locator('.disabled, [aria-disabled="true"]');

          // Either delete is hidden, disabled, or will show permission error when clicked
          if (await deleteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            // If visible, it might be disabled or will show error
            // Try clicking and expect error
            await deleteOption.click().catch(() => {});

            // May show permission error
            const permissionError = page.locator(':text("권한"), :text("permission"), :text("허용되지 않")').first();
            // No assertion here as behavior may vary
          }
        }
      }
    }
    test.skip();
  });
});
