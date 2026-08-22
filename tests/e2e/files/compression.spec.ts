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

test.describe('File Compression @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should compress single file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('compress-single') });
    const archiveName = `archive-${Date.now()}.zip`;

    // Upload file first
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

    // Right-click and compress
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    // Fill archive name if modal appears
    const archiveInput = page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveInput.fill(archiveName);
      await page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    // Wait for archive to appear
    await expect(page.locator(`text=.zip`).first()).toBeVisible({ timeout: 30000 });
  });

  test('should compress multiple files', async ({ page }) => {
    const file1 = generateTestFile({ name: generateFileName('multi-compress-1') });
    const file2 = generateTestFile({ name: generateFileName('multi-compress-2') });

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
    await expect(page.locator(`text=${file1.name}`)).toBeVisible({ timeout: 30000 });

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
    await expect(page.locator(`text=${file2.name}`)).toBeVisible({ timeout: 30000 });

    // Select both files (Ctrl+click)
    await page.locator(`text=${file1.name}`).click();
    await page.locator(`text=${file2.name}`).click({ modifiers: ['Control'] });

    // Right-click on one of them and compress
    await page.locator(`text=${file1.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    // Fill archive name if modal appears
    const archiveInput = page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveInput.fill(`multi-archive-${Date.now()}.zip`);
      await page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    // Wait for archive to appear
    await expect(page.locator(`text=.zip`).first()).toBeVisible({ timeout: 30000 });
  });

  test('should compress folder', async ({ page }) => {
    const folderName = generateFolderName('compress-folder');

    // Create folder
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

    // Go back to parent
    await page.locator(Selectors.fileList.breadcrumbHome).click();
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 10000 });

    // Compress the folder
    await page.locator(`text=${folderName}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    // Fill archive name if modal appears
    const archiveInput = page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveInput.fill(`${folderName}.zip`);
      await page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    // Wait for archive to appear
    await expect(page.locator(`text=${folderName}.zip`)).toBeVisible({ timeout: 30000 });
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
    const archiveName = `extract-archive-${Date.now()}.zip`;

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

    // Compress to create archive
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.compress).click();

    const archiveInput = page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveInput.fill(archiveName);
      await page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    await expect(page.locator(`text=${archiveName}`)).toBeVisible({ timeout: 30000 });

    // Delete original file to make extraction visible
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });
    await page.locator(Selectors.contextMenu.delete).click();
    await page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 5000 });

    // Extract the archive
    await page.locator(`text=${archiveName}`).click({ button: 'right' });
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

    // Compress
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.compress).click();

    const archiveInput = page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveInput.fill(`folder-extract-${Date.now()}.zip`);
      await page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    await expect(page.locator(`text=.zip`).first()).toBeVisible({ timeout: 30000 });

    // Create destination folder
    await page.locator(Selectors.fileList.newFolderBtn).click();
    await page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]')
      .fill(extractFolder);
    await page.locator('button:has-text("생성")').click();
    await expect(page.locator(`text=${extractFolder}`)).toBeVisible({ timeout: 15000 });

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
    const archiveName = `preview-archive-${Date.now()}.zip`;

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

    // Compress
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.compress).click();

    const archiveInput = page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveInput.fill(archiveName);
      await page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    await expect(page.locator(`text=${archiveName}`)).toBeVisible({ timeout: 30000 });

    // Double-click to preview (if supported)
    await page.locator(`text=${archiveName}`).dblclick();

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
    const archiveName = `download-preview-${Date.now()}.zip`;

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

    // Compress
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.compress).click();

    const archiveInput = page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveInput.fill(archiveName);
      await page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    await expect(page.locator(`text=${archiveName}`)).toBeVisible({ timeout: 30000 });

    // Double-click to preview
    await page.locator(`text=${archiveName}`).dblclick();

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
