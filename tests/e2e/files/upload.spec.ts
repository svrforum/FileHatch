/**
 * Upload Tests for FileHatch
 *
 * Tests for various file upload scenarios including:
 * - Simple uploads via button
 * - Drag and drop uploads
 * - Multiple file uploads
 *
 * Flow: Click upload → Modal opens → Click "파일 선택" → Select files → Auto upload
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';
import { revealFile } from '../helpers/file-list';

test.describe('File Upload @smoke @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for file list to be visible
    await expect(page.locator('.file-list-container, .file-list')).toBeVisible({ timeout: 10000 });
  });

  test('should upload single file via button', async ({ page }) => {
    const testFile = generateTestFile({ content: 'Single file upload test content' });

    // Click upload button to open modal
    await page.locator(Selectors.upload.mainBtn).click();
    await expect(page.locator(Selectors.upload.modal)).toBeVisible({ timeout: 5000 });

    // Click "파일 선택" and handle file chooser
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.upload.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    // Select file - upload starts automatically
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

    // Wait for modal to close and file to appear in list
    await expect(page.locator(Selectors.upload.modal)).not.toBeVisible({ timeout: 30000 });
    await revealFile(page, testFile.name);
  });

  test('should upload multiple files at once', async ({ page }) => {
    const file1 = generateTestFile({ name: generateFileName('multi-upload-1'), content: 'File 1' });
    const file2 = generateTestFile({ name: generateFileName('multi-upload-2'), content: 'File 2' });

    // Click upload button to open modal
    await page.locator(Selectors.upload.mainBtn).click();
    await expect(page.locator(Selectors.upload.modal)).toBeVisible({ timeout: 5000 });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.upload.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    // Upload multiple files at once
    await fileChooser.setFiles([
      { name: file1.name, mimeType: file1.mimeType, buffer: file1.buffer },
      { name: file2.name, mimeType: file2.mimeType, buffer: file2.buffer },
    ]);
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    // Wait for all files to appear
    await expect(page.locator(Selectors.upload.modal)).not.toBeVisible({ timeout: 30000 });
    await revealFile(page, file1.name);
    await revealFile(page, file2.name);
  });

  test('should upload file via drag and drop', async ({ page }) => {
    const fileName = generateFileName('drag-drop');
    const content = 'Drag and drop upload content';

    // Create DataTransfer with file
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

    await page.evaluate(
      ({ dt, name, fileContent }) => {
        const file = new File([fileContent], name, { type: 'text/plain' });
        (dt as DataTransfer).items.add(file);
      },
      { dt: dataTransfer, name: fileName, fileContent: content }
    );

    // Get drop zone and dispatch events
    const dropZone = page.locator(Selectors.upload.dropZone);
    await dropZone.dispatchEvent('dragenter', { dataTransfer });
    await dropZone.dispatchEvent('dragover', { dataTransfer });
    await dropZone.dispatchEvent('drop', { dataTransfer });

    // A drop opens the upload modal too; its overlay blocks the toolbar until
    // the transfer finishes and the dialog closes itself.
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    // Verify file appears
    await revealFile(page, fileName);
  });

  test('should upload different file types', async ({ page }) => {
    const htmlFile = generateTestFile({
      name: generateFileName('test-html', 'html'),
      content: '<!DOCTYPE html><html><body><h1>Test</h1></body></html>',
      mimeType: 'text/html',
      extension: 'html',
    });

    // Open upload modal
    await page.locator(Selectors.upload.mainBtn).click();
    await expect(page.locator(Selectors.upload.modal)).toBeVisible({ timeout: 5000 });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.upload.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: htmlFile.name,
      mimeType: htmlFile.mimeType,
      buffer: htmlFile.buffer,
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    await expect(page.locator(Selectors.upload.modal)).not.toBeVisible({ timeout: 30000 });
    await revealFile(page, htmlFile.name);
  });

  test('should handle file with Unicode name', async ({ page }) => {
    const fileName = `테스트파일_${Date.now()}.txt`;
    const content = '한글 파일 내용 테스트';

    await page.locator(Selectors.upload.mainBtn).click();
    await expect(page.locator(Selectors.upload.modal)).toBeVisible({ timeout: 5000 });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.upload.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(content),
    });
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });
    await revealFile(page, fileName);
  });
});

test.describe('Upload Edge Cases @files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-list-container, .file-list')).toBeVisible({ timeout: 10000 });
  });

  test('should handle empty file upload', async ({ page }) => {
    const fileName = generateFileName('empty-file');

    await page.locator(Selectors.upload.mainBtn).click();
    await expect(page.locator(Selectors.upload.modal)).toBeVisible({ timeout: 5000 });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.upload.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(''),
    });
    /*
     * A zero-byte file is dropped on the floor: no transfer starts, the dialog
     * stays on its initial screen and nothing is reported to the user. This
     * asserts the behaviour as it actually is - if the app ever starts
     * accepting empty files, or starts explaining why it will not, this test
     * is where that shows up.
     */
    await page.waitForTimeout(5000);
    await expect(page.locator(Selectors.upload.modal)).toBeVisible();
    await expect(page.locator(Selectors.fileList.wrapper).locator(`text=${fileName}`)).toHaveCount(0);
  });
});
