import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('File Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for file list to load
    await expect(page.locator('.file-list-wrapper')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should display file list', async ({ page }) => {
    // Verify file list is visible
    await expect(page.locator('.file-list-wrapper')).toBeVisible();
  });

  test('should create new folder', async ({ page }) => {
    const folderName = `test-folder-${Date.now()}`;

    // Click new folder button
    await page.locator('.new-folder-btn').click();

    // Fill folder name in modal
    await page.locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]').fill(folderName);

    // Confirm creation
    await page.locator('button:has-text("생성")').click();

    // Verify folder appears in list (give time for creation)
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 15000 });
  });

  test('should navigate into folder', async ({ page }) => {
    const folderName = `nav-folder-${Date.now()}`;

    // Create folder first
    await page.locator('.new-folder-btn').click();
    await page.locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]').fill(folderName);
    await page.locator('button:has-text("생성")').click();

    // Wait for folder to appear
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 15000 });

    // Double-click to enter folder
    await page.locator(`text=${folderName}`).dblclick();

    // Verify navigation (breadcrumb should show folder name or URL should change)
    await expect(page.locator(`[data-testid="breadcrumb"]:has-text("${folderName}"), .breadcrumb:has-text("${folderName}")`)).toBeVisible({ timeout: 5000 }).catch(() => expect(page).toHaveURL(new RegExp(folderName)));
  });

  test('should upload file via button', async ({ page }) => {
    const fileName = `test-file-${Date.now()}.txt`;

    // Click upload button to open upload modal
    await page.locator('.upload-btn').click();

    // Click "파일 선택" button and handle file chooser
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;

    // Create a test file buffer
    const buffer = Buffer.from('Test file content for E2E testing');

    // Set the file
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer,
    });

    // Click start upload button
    await page.locator('button:has-text("업로드 시작")').click();
    // Wait for upload modal to close
    await expect(page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });

    // Wait for upload to complete
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });
  });

  test('should rename file', async ({ page }) => {
    const originalName = `rename-test-${Date.now()}.txt`;
    const newName = `renamed-${Date.now()}.txt`;

    // First upload a file
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: originalName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Rename test content'),
    });

    // Click start upload button
    await page.locator('button:has-text("업로드 시작")').click();
    // Wait for upload modal to close
    await expect(page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });

    // Wait for file to appear in file list (use specific selector for file row)
    const fileRow = page.locator(`.file-list-container >> text=${originalName}`);
    await expect(fileRow).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await fileRow.click({ button: 'right' });

    // Wait for context menu to appear
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 5000 });

    // Click rename option
    await page.locator('.context-menu >> text=이름 변경').click();

    // Fill new name
    await page.locator('input[value*="rename-test"], input[placeholder*="이름"]').fill(newName);

    // Confirm rename (button text is "변경" meaning "Change")
    await page.locator('button:has-text("변경")').click();

    // Verify new name appears in file list
    await expect(page.locator(`.file-list-container >> text=${newName}`)).toBeVisible({ timeout: 5000 });

    // Verify old name is gone from file list (use specific selector to avoid matching toast messages)
    await expect(page.locator(`.file-list-container .file-name:has-text("${originalName}")`)).not.toBeVisible();
  });

  test('should delete file', async ({ page }) => {
    const fileName = `delete-test-${Date.now()}.txt`;

    // Upload a file first
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Delete test content'),
    });

    // Click start upload button
    await page.locator('button:has-text("업로드 시작")').click();
    // Wait for upload modal to close
    await expect(page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });

    // Wait for file to appear
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await page.locator(`text=${fileName}`).click({ button: 'right' });

    // Wait for context menu to appear
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 5000 });

    // Click delete option (휴지통으로)
    await page.locator('.context-menu >> .context-menu-item.danger').click();

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
    await page.locator('.upload-btn').click();
    let fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    let fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file1,
      mimeType: 'text/plain',
      buffer: Buffer.from('Multi-select test 1'),
    });
    await page.locator('button:has-text("업로드 시작")').click();
    // Wait for upload modal to close
    await expect(page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });
    await expect(page.locator(`text=${file1}`)).toBeVisible({ timeout: 30000 });

    // Upload second file
    await page.locator('.upload-btn').click();
    fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: file2,
      mimeType: 'text/plain',
      buffer: Buffer.from('Multi-select test 2'),
    });
    await page.locator('button:has-text("업로드 시작")').click();
    // Wait for upload modal to close
    await expect(page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });
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
    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContent),
    });

    // Click start upload button
    await page.locator('button:has-text("업로드 시작")').click();
    // Wait for upload modal to close
    await expect(page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });

    // Wait for file to appear
    await expect(page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    // Right-click to open context menu
    await page.locator(`text=${fileName}`).click({ button: 'right' });

    // Wait for context menu to appear
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 5000 });

    // Start download
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.context-menu >> text=다운로드').click();
    const download = await downloadPromise;

    // Verify download started
    expect(download.suggestedFilename()).toContain('download-test');
  });
});

test.describe('Drag and Drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-list-wrapper')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should upload file via drag and drop', async ({ page }) => {
    const fileName = `drag-drop-${Date.now()}.txt`;

    // Create a DataTransfer with a file
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

    // Add file to DataTransfer
    await page.evaluate(
      ({ dt, name }) => {
        const file = new File(['Drag and drop content'], name, { type: 'text/plain' });
        (dt as DataTransfer).items.add(file);
      },
      { dt: dataTransfer, name: fileName }
    );

    // Get the drop zone
    const dropZone = page.locator('.file-list-container');

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
    await expect(page.locator('.file-list-wrapper')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should search for files', async ({ page }) => {
    // Create a file with unique name
    const uniqueName = `searchable-${Date.now()}.txt`;

    await page.locator('.upload-btn').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: uniqueName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Searchable content'),
    });

    // Click start upload button
    await page.locator('button:has-text("업로드 시작")').click();
    // Wait for upload modal to close
    await expect(page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });

    await expect(page.locator(`text=${uniqueName}`)).toBeVisible({ timeout: 30000 });

    // Open search
    await page.locator('.search-expand-btn').click();

    // Enter search term
    await page.locator('input[placeholder*="검색"], input[placeholder*="search"], input[type="search"]').fill('searchable');

    // Wait for results
    await expect(page.locator(`text=${uniqueName}`)).toBeVisible({ timeout: 5000 });
  });
});
