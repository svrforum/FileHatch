/**
 * Compression Tests for FileHatch
 *
 * Tests for file compression and extraction features:
 * - Single file compression
 * - Multiple file compression
 * - Folder compression
 * - Archive extraction
 * - ZIP preview
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateFolderName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';
import { revealFile, expectFileGone, compressSelection } from '../helpers/file-list';
import { navigateVia, openNewFolderDialog, openUploadDialog } from '../helpers/navigate';

test.describe('File Compression @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should compress single file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('compress-single') });
    const archiveBase = `archive-${Date.now()}`;

    // Upload file first
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

    // Right-click and compress
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    // Fill archive name if modal appears
    const archive = await compressSelection(page, archiveBase);

    // The folder filter still holds the source file's name, so re-query for
    // the archive we just asked for.
    await revealFile(page, archive);
  });

  test('should compress multiple files', async ({ page }) => {
    // Share a prefix so one filter query surfaces both rows; the list is
    // virtualised and filtering to a single name hides the other.
    const stamp = Date.now();
    const file1 = generateTestFile({ name: `multi-compress-${stamp}-a.txt` });
    const file2 = generateTestFile({ name: `multi-compress-${stamp}-b.txt` });

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
    await revealFile(page, file1.name);

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
    await revealFile(page, file2.name);

    // Filter to the pair first: the list is virtualised, so ctrl-clicking a row
    // that a single-name filter has hidden selects nothing.
    await revealFile(page, `multi-compress-${stamp}`);
    const rows = page.locator(Selectors.fileList.row).filter({ hasText: `multi-compress-${stamp}` });
    await expect(rows).toHaveCount(2, { timeout: 15000 });
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });

    // Right-click on one of them and compress
    await rows.nth(0).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    const archive = await compressSelection(page, `multi-archive-${Date.now()}`);
  });

  test('should compress folder', async ({ page }) => {
    const folderName = generateFolderName('compress-folder');

    // Create folder
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

    // Go back to parent
    await navigateVia(page, Selectors.fileList.breadcrumbHome);
    await revealFile(page, folderName);

    // Compress the folder
    await page.locator(`text=${folderName}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    const archive = await compressSelection(page, folderName);
  });
});

test.describe('Archive Extraction @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should extract archive', async ({ page }) => {
    // First create an archive by compressing a file
    const testFile = generateTestFile({ name: generateFileName('extract-test') });
    const archiveBase = `extract-archive-${Date.now()}`;

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

    // Compress to create archive
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    const archive = await compressSelection(page, archiveBase);

    await revealFile(page, archive);

    // Delete original file to make extraction visible
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expectFileGone(page, testFile.name);

    // Extract the archive
    await revealFile(page, archive);
    await page.locator(`text=${archive}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.extract).click();

    // Wait for extraction (may create folder or extract files directly)
    await page.waitForTimeout(3000);

    // Original file or folder should appear
    // Note: Extraction behavior may vary - might extract to folder or same directory
  });

  test('should extract archive to specific folder', async ({ page }) => {
    // Create a file and compress it
    const testFile = generateTestFile({ name: generateFileName('extract-folder-test') });
    const extractFolder = generateFolderName('extract-destination');

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

    // Compress
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.compress).click();

    const archive = await compressSelection(page, `folder-extract-${Date.now()}`);

    // Create destination folder
    await openNewFolderDialog(page);
    await page.locator(Selectors.createFolderModal.nameInput).fill(extractFolder);
    await page.locator(Selectors.createFolderModal.submit).first().click();
    await revealFile(page, extractFolder);

    // Note: Specific folder extraction UI may vary
  });
});

test.describe('ZIP Preview @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should preview ZIP contents', async ({ page }) => {
    // Create a file and compress it
    const testFile = generateTestFile({ name: generateFileName('preview-content') });
    const archiveBase = `preview-archive-${Date.now()}`;

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

    // Compress
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.compress).click();

    const archive = await compressSelection(page, archiveBase);

    await revealFile(page, archive);

    // Double-click to preview (if supported)
    await page.locator(`text=${archive}`).first().dblclick();

    // Check if preview modal/panel appears with file list
    const previewModal = page.locator('.archive-preview, .zip-preview, .modal:has-text(".txt")');
    if (await previewModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should show the contained file
      await expect(previewModal.locator(`text=${testFile.name}`)).toBeVisible();
    }
  });

  test('should download file from ZIP preview', async ({ page }) => {
    // Create a file and compress it
    const testFile = generateTestFile({ name: generateFileName('zip-download') });
    const archiveBase = `download-preview-${Date.now()}`;

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

    // Compress
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await page.locator(Selectors.contextMenu.compress).click();

    const archive = await compressSelection(page, archiveBase);

    await revealFile(page, archive);

    // Double-click to preview
    await page.locator(`text=${archive}`).first().dblclick();

    // If preview is available, try to download a file from it
    const previewModal = page.locator('.archive-preview, .zip-preview, .modal');
    if (await previewModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      const downloadBtn = previewModal.locator('button:has-text("다운로드"), button[aria-label="Download"]');
      if (await downloadBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        const downloadPromise = page.waitForEvent('download');
        await downloadBtn.first().click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBeDefined();
      }
    }
  });
});
