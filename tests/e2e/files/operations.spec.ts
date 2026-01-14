import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('File Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for file list to load
    await expect(page.locator('[data-testid="file-list"], .file-list')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should display file list', async ({ page }) => {
    // Verify file list is visible
    await expect(page.locator('[data-testid="file-list"], .file-list')).toBeVisible();
  });

  test('should create new folder', async ({ page }) => {
    const folderName = `test-folder-${Date.now()}`;

    // Click new folder button
    await page.locator('[data-testid="new-folder-btn"], button:has-text("새 폴더"), button:has-text("New Folder")').click();

    // Fill folder name in modal
    await page.locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]').fill(folderName);

    // Confirm creation
    await page.locator('button:has-text("만들기"), button:has-text("Create"), button[type="submit"]').click();

    // Verify folder appears in list
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 5000 });
  });

  test('should navigate into folder', async ({ page }) => {
    const folderName = `nav-folder-${Date.now()}`;

    // Create folder first
    await page.locator('[data-testid="new-folder-btn"], button:has-text("새 폴더"), button:has-text("New Folder")').click();
    await page.locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]').fill(folderName);
    await page.locator('button:has-text("만들기"), button:has-text("Create"), button[type="submit"]').click();

    // Wait for folder to appear
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 5000 });

    // Double-click to enter folder
    await page.locator(`text=${folderName}`).dblclick();

    // Verify navigation (breadcrumb or URL should change)
    await expect(page.locator(`[data-testid="breadcrumb"]:has-text("${folderName}"), .breadcrumb:has-text("${folderName}")`).or(page)).toHaveURL(new RegExp(folderName));
  });

  test('should upload file via button', async ({ page }) => {
    const fileName = `test-file-${Date.now()}.txt`;

    // Click upload button and handle file chooser
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), button:has-text("Upload")').click();
    const fileChooser = await fileChooserPromise;

    // Create a test file buffer
    const buffer = Buffer.from('Test file content for E2E testing');

    // Set the file
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer,
    });

    // Wait for upload to complete
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });
  });

  test('should rename file', async ({ page }) => {
    const originalName = `rename-test-${Date.now()}.txt`;
    const newName = `renamed-${Date.now()}.txt`;

    // First upload a file
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), button:has-text("Upload")').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: originalName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Rename test content'),
    });

    // Wait for file to appear
    await expect(page.locator(`text=${originalName}`)).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await page.locator(`text=${originalName}`).click({ button: 'right' });

    // Click rename option
    await page.locator('text=이름 변경, text=Rename').click();

    // Fill new name
    await page.locator('input[value*="rename-test"], input[placeholder*="이름"]').fill(newName);

    // Confirm rename
    await page.locator('button:has-text("확인"), button:has-text("OK"), button[type="submit"]').click();

    // Verify new name appears
    await expect(page.locator(`text=${newName}`)).toBeVisible({ timeout: 5000 });

    // Verify old name is gone
    await expect(page.locator(`text=${originalName}`)).not.toBeVisible();
  });

  test('should delete file', async ({ page }) => {
    const fileName = `delete-test-${Date.now()}.txt`;

    // Upload a file first
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), button:has-text("Upload")').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Delete test content'),
    });

    // Wait for file to appear
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await page.locator(`text=${fileName}`).click({ button: 'right' });

    // Click delete option
    await page.locator('text=삭제, text=Delete').click();

    // Confirm deletion
    await page.locator('button:has-text("확인"), button:has-text("삭제"), button:has-text("Delete")').click();

    // Verify file is gone
    await expect(page.locator(`text=${fileName}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('should select multiple files', async ({ page }) => {
    // Create two test files
    const file1 = `multi-select-1-${Date.now()}.txt`;
    const file2 = `multi-select-2-${Date.now()}.txt`;

    // Upload first file
    let fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), button:has-text("Upload")').click();
    let fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file1,
      mimeType: 'text/plain',
      buffer: Buffer.from('Multi-select test 1'),
    });
    await expect(page.locator(`text=${file1}`)).toBeVisible({ timeout: 30000 });

    // Upload second file
    fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), button:has-text("Upload")').click();
    fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file2,
      mimeType: 'text/plain',
      buffer: Buffer.from('Multi-select test 2'),
    });
    await expect(page.locator(`text=${file2}`)).toBeVisible({ timeout: 30000 });

    // Ctrl+click to select multiple
    await page.locator(`text=${file1}`).click();
    await page.locator(`text=${file2}`).click({ modifiers: ['Control'] });

    // Verify multi-select bar appears
    await expect(page.locator('[data-testid="multi-select-bar"], .multi-select-bar, .selection-bar')).toBeVisible({
      timeout: 5000,
    });
  });

  test('should download file', async ({ page }) => {
    const fileName = `download-test-${Date.now()}.txt`;
    const fileContent = 'Download test content';

    // Upload a file first
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), button:has-text("Upload")').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContent),
    });

    // Wait for file to appear
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await page.locator(`text=${fileName}`).click({ button: 'right' });

    // Start download
    const downloadPromise = page.waitForEvent('download');
    await page.locator('text=다운로드, text=Download').click();
    const download = await downloadPromise;

    // Verify download started
    expect(download.suggestedFilename()).toContain('download-test');
  });
});

test.describe('Drag and Drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="file-list"], .file-list')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should upload file via drag and drop', async ({ page }) => {
    const fileName = `drag-drop-${Date.now()}.txt`;

    // Create a DataTransfer with a file
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

    // Add file to DataTransfer
    await page.evaluate(
      ([dt, name]) => {
        const file = new File(['Drag and drop content'], name, { type: 'text/plain' });
        dt.items.add(file);
      },
      [dataTransfer, fileName]
    );

    // Get the drop zone
    const dropZone = page.locator('[data-testid="drop-zone"], .drop-zone, .file-list');

    // Dispatch dragenter
    await dropZone.dispatchEvent('dragenter', { dataTransfer });

    // Dispatch drop
    await dropZone.dispatchEvent('drop', { dataTransfer });

    // Verify file appears (may take time for upload)
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });
  });
});

test.describe('File Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="file-list"], .file-list')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should search for files', async ({ page }) => {
    // Create a file with unique name
    const uniqueName = `searchable-${Date.now()}.txt`;

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-testid="upload-btn"], button:has-text("업로드"), button:has-text("Upload")').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: uniqueName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Searchable content'),
    });

    await expect(page.locator(`text=${uniqueName}`)).toBeVisible({ timeout: 30000 });

    // Open search
    await page.locator('[data-testid="search-btn"], button:has-text("검색"), button[aria-label="Search"]').click();

    // Enter search term
    await page.locator('input[placeholder*="검색"], input[placeholder*="search"], input[type="search"]').fill('searchable');

    // Wait for results
    await expect(page.locator(`text=${uniqueName}`)).toBeVisible({ timeout: 5000 });
  });
});
