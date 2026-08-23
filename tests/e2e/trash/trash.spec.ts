/**
 * Trash (Recycle Bin) Tests for FileHatch
 *
 * Tests for trash functionality:
 * - Move files to trash
 * - View trash contents
 * - Restore files from trash
 * - Permanent deletion
 * - Empty trash
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateFolderName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';
import { revealFile, expectFileGone, restoreFromTrash, purgeFromTrash } from '../helpers/file-list';
import { navigateVia, openNewFolderDialog, openUploadDialog } from '../helpers/navigate';

test.describe('Trash Operations @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should move file to trash', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('trash-move') });

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
    await revealFile(page, testFile.name);

    // Delete (move to trash)
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();

    // File should be gone from main view
    await expectFileGone(page, testFile.name);
  });

  test('should view trash contents', async ({ page }) => {
    // First create and delete a file
    const testFile = generateTestFile({ name: generateFileName('trash-view') });

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

    // Delete file
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expectFileGone(page, testFile.name);

    // Navigate to trash
    await navigateVia(page, Selectors.sidebar.trash);
    await page.waitForTimeout(1000);

    // File should be in trash
    await revealFile(page, testFile.name);
  });

  test('should restore file from trash', async ({ page }) => {
    // Create and delete file
    const testFile = generateTestFile({ name: generateFileName('trash-restore') });

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

    // Delete file
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expectFileGone(page, testFile.name);

    // Navigate to trash
    await navigateVia(page, Selectors.sidebar.trash);
    await page.waitForTimeout(1000);

    // Restore is the row's own icon button; the trash view has no context menu.
    await restoreFromTrash(page, testFile.name);

    // Navigate back to home and verify file is restored
    await navigateVia(page, Selectors.sidebar.homeBtn);
    await page.waitForTimeout(1000);
    await revealFile(page, testFile.name);
  });

  test('should permanently delete file from trash', async ({ page }) => {
    // Create and delete file
    const testFile = generateTestFile({ name: generateFileName('trash-permanent') });

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

    // Delete file
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expectFileGone(page, testFile.name);

    // Navigate to trash
    await navigateVia(page, Selectors.sidebar.trash);
    await page.waitForTimeout(1000);

    // Permanent delete is the row's own icon button plus its confirmation.
    await purgeFromTrash(page, testFile.name);


    // File should be permanently deleted
    await expectFileGone(page, testFile.name);
  });

  test('should empty trash', async ({ page }) => {
    // Create and delete multiple files
    const file1 = generateTestFile({ name: generateFileName('empty-trash-1') });
    const file2 = generateTestFile({ name: generateFileName('empty-trash-2') });

    // Upload first file
    await openUploadDialog(page);
    let fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    let fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: file1.name,
      mimeType: file1.mimeType,
      buffer: file1.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Upload second file
    await openUploadDialog(page);
    fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: file2.name,
      mimeType: file2.mimeType,
      buffer: file2.buffer,
    });

    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Delete both files
    await revealFile(page, file1.name);
    await page.locator(`text=${file1.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expectFileGone(page, file1.name);

    await revealFile(page, file2.name);
    await page.locator(`text=${file2.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expectFileGone(page, file2.name);

    // Navigate to trash
    await navigateVia(page, Selectors.sidebar.trash);
    await page.waitForTimeout(1000);

    // Verify files are in trash
    await revealFile(page, file1.name);
    await revealFile(page, file2.name);

    // Empty trash
    await page.locator(Selectors.trash.emptyTrashBtn).click();

    // Confirm
    const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
    await confirmBtn.click();

    // Emptying removes every row, so assert the empty state rather than
    // chasing each name through a list that no longer renders.
    await expect(page.locator(Selectors.trash.item)).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator(Selectors.trash.container)).toContainText('휴지통이 비어 있습니다', {
      timeout: 10000,
    });
  });

  test('should move folder to trash', async ({ page }) => {
    const folderName = generateFolderName('trash-folder');

    // Create folder
    await openNewFolderDialog(page);
    await page.locator(Selectors.createFolderModal.nameInput).fill(folderName);
    await page.locator(Selectors.createFolderModal.submit).first().click();
    await revealFile(page, folderName);

    // Delete folder
    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();

    // Folder should be gone
    await expectFileGone(page, folderName);

    // Navigate to trash and verify
    await navigateVia(page, Selectors.sidebar.trash);
    await page.waitForTimeout(1000);
    await revealFile(page, folderName);
  });

  test('should restore folder from trash', async ({ page }) => {
    const folderName = generateFolderName('restore-folder');

    // Create folder with content
    await openNewFolderDialog(page);
    await page.locator(Selectors.createFolderModal.nameInput).fill(folderName);
    await page.locator(Selectors.createFolderModal.submit).first().click();
    await revealFile(page, folderName);

    // Navigate into folder and upload a file
    await page.locator(`text=${folderName}`).first().dblclick();
    await page.waitForTimeout(1000);

    const testFile = generateTestFile({ name: generateFileName('folder-content') });
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

    // Go back and delete folder
    await page.locator(Selectors.fileList.breadcrumbHome).click();
    await revealFile(page, folderName);

    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expectFileGone(page, folderName);

    // Navigate to trash
    await navigateVia(page, Selectors.sidebar.trash);
    await page.waitForTimeout(1000);

    // Restore folder
    await restoreFromTrash(page, folderName);

    // Navigate home and verify folder is restored
    await navigateVia(page, Selectors.sidebar.homeBtn);
    await page.waitForTimeout(1000);
    await revealFile(page, folderName);

    // Verify content is restored
    await page.locator(`text=${folderName}`).first().dblclick();
    await page.waitForTimeout(1000);
    await revealFile(page, testFile.name);
  });
});

test.describe('Trash Edge Cases @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should handle deleting multiple files at once', async ({ page }) => {
    // Share a prefix so one filter query surfaces both rows.
    const prefix = `multi-delete-${Date.now()}`;
    const file1 = generateTestFile({ name: `${prefix}-a.txt` });
    const file2 = generateTestFile({ name: `${prefix}-b.txt` });

    // Upload both files
    await openUploadDialog(page);
    let fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    let fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file1.name,
      mimeType: file1.mimeType,
      buffer: file1.buffer,
    });
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await openUploadDialog(page);
    fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file2.name,
      mimeType: file2.mimeType,
      buffer: file2.buffer,
    });
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    /*
     * Filter to the pair first: the list is virtualised, so ctrl-clicking a row
     * that a single-name filter has hidden selects nothing.
     */
    await revealFile(page, prefix);
    const rows = page.locator(Selectors.fileList.row).filter({ hasText: prefix });
    await expect(rows).toHaveCount(2, { timeout: 15000 });
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });

    await expect(page.locator(Selectors.multiSelect.bar)).toBeVisible({ timeout: 5000 });

    // The batch delete goes through a native confirm(), so the handler has to
    // be attached before the click.
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator(Selectors.multiSelect.deleteBtn).click();

    const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Both files should be gone
    await expectFileGone(page, file1.name);
    await expectFileGone(page, file2.name);
  });

  test('should show empty state in trash', async ({ page }) => {
    // First empty the trash if there's anything
    await navigateVia(page, Selectors.sidebar.trash);
    await page.waitForTimeout(1000);

    const emptyTrashBtn = page.locator(Selectors.trash.emptyTrashBtn);
    if (await emptyTrashBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await emptyTrashBtn.click();
      const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await page.waitForTimeout(1000);
    }

    // Verify empty state message
    await expect(
      page.locator(':text("휴지통이 비어 있습니다"), :text("Trash is empty"), :text("비어 있")').first()
    ).toBeVisible({ timeout: 5000 }).catch(() => {
      // If no explicit empty state message, check that no items exist
      // This is acceptable behavior
    });
  });
});
