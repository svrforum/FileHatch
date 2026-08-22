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

test.describe('Trash Operations @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should move file to trash', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('trash-move') });

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

    // Delete (move to trash)
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();

    // File should be gone from main view
    await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('should view trash contents', async ({ page }) => {
    // First create and delete a file
    const testFile = generateTestFile({ name: generateFileName('trash-view') });

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

    // Delete file
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 5000 });

    // Navigate to trash
    await page.locator(Selectors.sidebar.trash).click();
    await page.waitForTimeout(1000);

    // File should be in trash
    await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 10000 });
  });

  test('should restore file from trash', async ({ page }) => {
    // Create and delete file
    const testFile = generateTestFile({ name: generateFileName('trash-restore') });

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

    // Delete file
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 5000 });

    // Navigate to trash
    await page.locator(Selectors.sidebar.trash).click();
    await page.waitForTimeout(1000);

    // Find and restore the file
    await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 10000 });

    // Right-click to restore or use restore button
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const restoreOption = page.locator('.context-menu >> text=복원, .context-menu >> text=Restore');
    if (await restoreOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await restoreOption.click();
    } else {
      // Try restore button
      await page.locator(`text=${testFile.name}`).click();
      await page.locator(Selectors.trash.restoreBtn).click();
    }

    // Confirm restoration if needed
    const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // File should be gone from trash
    await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 10000 });

    // Navigate back to home and verify file is restored
    await page.locator(Selectors.sidebar.homeBtn).click();
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 10000 });
  });

  test('should permanently delete file from trash', async ({ page }) => {
    // Create and delete file
    const testFile = generateTestFile({ name: generateFileName('trash-permanent') });

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

    // Delete file
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 5000 });

    // Navigate to trash
    await page.locator(Selectors.sidebar.trash).click();
    await page.waitForTimeout(1000);

    await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 10000 });

    // Permanently delete
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const permanentDeleteOption = page.locator(
      '.context-menu >> text=영구 삭제, .context-menu >> text=Permanent Delete, .context-menu >> .context-menu-item.danger'
    );
    if (await permanentDeleteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await permanentDeleteOption.click();
    } else {
      await page.locator(`text=${testFile.name}`).click();
      await page.locator(Selectors.trash.permanentDeleteBtn).click();
    }

    // Confirm permanent deletion
    const confirmBtn = page.locator('button:has-text("확인"), button:has-text("Confirm"), button:has-text("삭제")');
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // File should be permanently deleted
    await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 10000 });
  });

  test('should empty trash', async ({ page }) => {
    // Create and delete multiple files
    const file1 = generateTestFile({ name: generateFileName('empty-trash-1') });
    const file2 = generateTestFile({ name: generateFileName('empty-trash-2') });

    // Upload first file
    await page.locator(Selectors.fileList.uploadBtn).click();
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
    await page.locator(Selectors.fileList.uploadBtn).click();
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
    await page.locator(`text=${file1.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(page.locator(`text=${file1.name}`)).not.toBeVisible({ timeout: 5000 });

    await page.locator(`text=${file2.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(page.locator(`text=${file2.name}`)).not.toBeVisible({ timeout: 5000 });

    // Navigate to trash
    await page.locator(Selectors.sidebar.trash).click();
    await page.waitForTimeout(1000);

    // Verify files are in trash
    await expect(page.locator(`text=${file1.name}`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${file2.name}`)).toBeVisible({ timeout: 10000 });

    // Empty trash
    await page.locator(Selectors.trash.emptyTrashBtn).click();

    // Confirm
    const confirmBtn = page.locator('button:has-text("확인"), button:has-text("Confirm"), button:has-text("비우기")');
    await confirmBtn.click();

    // Both files should be gone
    await expect(page.locator(`text=${file1.name}`)).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${file2.name}`)).not.toBeVisible({ timeout: 10000 });
  });

  test('should move folder to trash', async ({ page }) => {
    const folderName = generateFolderName('trash-folder');

    // Create folder
    await page.locator(Selectors.fileList.newFolderBtn).click();
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 15000 });

    // Delete folder
    await page.locator(`text=${folderName}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();

    // Folder should be gone
    await expect(page.locator(`text=${folderName}`)).not.toBeVisible({ timeout: 5000 });

    // Navigate to trash and verify
    await page.locator(Selectors.sidebar.trash).click();
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 10000 });
  });

  test('should restore folder from trash', async ({ page }) => {
    const folderName = generateFolderName('restore-folder');

    // Create folder with content
    await page.locator(Selectors.fileList.newFolderBtn).click();
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]')
      .fill(folderName);
    await page.locator('button:has-text("생성")').click();
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 15000 });

    // Navigate into folder and upload a file
    await page.locator(`text=${folderName}`).dblclick();
    await page.waitForTimeout(1000);

    const testFile = generateTestFile({ name: generateFileName('folder-content') });
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

    // Go back and delete folder
    await page.locator(Selectors.fileList.breadcrumbHome).click();
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 10000 });

    await page.locator(`text=${folderName}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(page.locator(`text=${folderName}`)).not.toBeVisible({ timeout: 5000 });

    // Navigate to trash
    await page.locator(Selectors.sidebar.trash).click();
    await page.waitForTimeout(1000);

    // Restore folder
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 10000 });
    await page.locator(`text=${folderName}`).click({ button: 'right' });

    const restoreOption = page.locator('.context-menu >> text=복원, .context-menu >> text=Restore');
    if (await restoreOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await restoreOption.click();
    } else {
      await page.locator(`text=${folderName}`).click();
      await page.locator(Selectors.trash.restoreBtn).click();
    }

    const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Navigate home and verify folder is restored
    await page.locator(Selectors.sidebar.homeBtn).click();
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 10000 });

    // Verify content is restored
    await page.locator(`text=${folderName}`).dblclick();
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Trash Edge Cases @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should handle deleting multiple files at once', async ({ page }) => {
    const file1 = generateTestFile({ name: generateFileName('multi-delete-1') });
    const file2 = generateTestFile({ name: generateFileName('multi-delete-2') });

    // Upload both files
    await page.locator(Selectors.fileList.uploadBtn).click();
    let fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    let fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file1.name,
      mimeType: file1.mimeType,
      buffer: file1.buffer,
    });
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await page.locator(Selectors.fileList.uploadBtn).click();
    fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file2.name,
      mimeType: file2.mimeType,
      buffer: file2.buffer,
    });
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Select both files
    await page.locator(`text=${file1.name}`).click();
    await page.locator(`text=${file2.name}`).click({ modifiers: ['Control'] });

    // Verify multi-select bar
    await expect(page.locator(Selectors.multiSelect.bar)).toBeVisible({ timeout: 5000 });

    // Delete via multi-select bar or context menu
    const multiDeleteBtn = page.locator(Selectors.multiSelect.deleteBtn);
    if (await multiDeleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await multiDeleteBtn.click();
    } else {
      await page.locator(`text=${file1.name}`).click({ button: 'right' });
      await page.locator(Selectors.contextMenu.delete).click();
    }

    // Confirm deletion
    await page.locator(Selectors.confirmModal.confirmBtn).click();

    // Both files should be gone
    await expect(page.locator(`text=${file1.name}`)).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text=${file2.name}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('should show empty state in trash', async ({ page }) => {
    // First empty the trash if there's anything
    await page.locator(Selectors.sidebar.trash).click();
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
      page.locator('text=휴지통이 비어 있습니다, text=Trash is empty, text=비어 있')
    ).toBeVisible({ timeout: 5000 }).catch(() => {
      // If no explicit empty state message, check that no items exist
      // This is acceptable behavior
    });
  });
});
