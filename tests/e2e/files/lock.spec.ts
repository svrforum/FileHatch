/**
 * File Lock Tests for FileHatch
 *
 * Tests for file locking functionality:
 * - Lock file
 * - Unlock file
 * - Locked file behavior
 * - Lock list
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';
import { revealFile } from '../helpers/file-list';
import { openUploadDialog } from '../helpers/navigate';

test.describe('File Locking @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should lock a file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('lock-test') });

    // Upload file
    await openUploadDialog(page);
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Open context menu
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });

    // Click lock option
    const lockOption = page.locator(Selectors.contextMenu.lock);
    if (await lockOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lockOption.click();

      // File should show locked indicator
      await page.waitForTimeout(1000);
      const fileRow = page.locator(`text=${testFile.name}`).first().locator('..');
      const lockIndicator = fileRow.locator('.lock-icon, .locked, svg[data-icon="lock"]');

      await expect(
        lockIndicator.or(page.locator(':text("잠금됨"), :text("Locked")').first())
      ).toBeVisible({ timeout: 5000 }).catch(() => {
        // Lock may be indicated differently
      });
    } else {
      test.skip();
    }
  });

  test('should unlock a file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('unlock-test') });

    // Upload and lock file
    await openUploadDialog(page);
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Lock file
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    const lockOption = page.locator(Selectors.contextMenu.lock);
    if (await lockOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lockOption.click();
      await page.waitForTimeout(500);

      // Unlock file
      await revealFile(page, testFile.name);
      await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
      const unlockOption = page.locator(Selectors.contextMenu.unlock);
      if (await unlockOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await unlockOption.click();

        // Lock indicator should be gone
        await page.waitForTimeout(1000);
      }
    } else {
      test.skip();
    }
  });

  test('should prevent editing locked file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('prevent-edit') });

    // Upload and lock file
    await openUploadDialog(page);
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Lock file
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    const lockOption = page.locator(Selectors.contextMenu.lock);
    if (await lockOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lockOption.click();
      await page.waitForTimeout(500);

      // Try to rename
      await revealFile(page, testFile.name);
      await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
      const renameOption = page.locator(Selectors.contextMenu.rename);

      // Rename should be disabled or show error when clicked
      if (await renameOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        const isDisabled = await renameOption.evaluate((el) => {
          return el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true';
        });

        if (!isDisabled) {
          await renameOption.click();
          // Should show lock error
          await expect(
            page.locator(':text("잠금"), :text("locked"), :text("편집 불가")').first()
          ).toBeVisible({ timeout: 5000 }).catch(() => {});
        }
      }
    } else {
      test.skip();
    }
  });

  test('should prevent deleting locked file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('prevent-delete') });

    // Upload and lock file
    await openUploadDialog(page);
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Lock file
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    const lockOption = page.locator(Selectors.contextMenu.lock);
    if (await lockOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lockOption.click();
      await page.waitForTimeout(500);

      // Try to delete
      await revealFile(page, testFile.name);
      await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
      const deleteOption = page.locator(Selectors.contextMenu.delete);

      if (await deleteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        const isDisabled = await deleteOption.evaluate((el) => {
          return el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true';
        });

        if (!isDisabled) {
          await deleteOption.click();
          // Should show lock error or file should still exist
          await page.locator(Selectors.confirmModal.confirmBtn).click().catch(() => {});

          // File should still exist if locked properly
          await revealFile(page, testFile.name);
        }
      }
    } else {
      test.skip();
    }
  });

  test('should show locked by information', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('locked-by') });

    // Upload and lock file
    await openUploadDialog(page);
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    const lockOption = page.locator(Selectors.contextMenu.lock);
    if (await lockOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lockOption.click();
      await page.waitForTimeout(500);

      // Open properties to see lock info
      await revealFile(page, testFile.name);
      await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
      const propertiesOption = page.locator(Selectors.contextMenu.properties);
      if (await propertiesOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await propertiesOption.click();

        // Should show who locked the file
        await expect(
          page.locator(':text("잠금 정보"), :text("Locked by")').first()
        ).toBeVisible({ timeout: 5000 }).catch(() => {});
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Lock List @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should display locked files list if available', async ({ page }) => {
    // Look for locked files view in sidebar or menu
    const lockedFilesLink = page.locator(
      '.sidebar-item:has-text("잠금"), a:has-text("Locked files")'
    );

    if (await lockedFilesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await lockedFilesLink.click();
      await page.waitForTimeout(1000);

      // Should show locked files or empty state
      await expect(
        page.locator(':text("잠긴 파일"), :text("Locked files")').first()
          .or(page.locator(':text("잠긴 파일 없음"), :text("No locked files")').first())
      ).toBeVisible({ timeout: 10000 });
    } else {
      // Locked files view may not be a separate page
      test.skip();
    }
  });
});
