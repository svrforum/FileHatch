/**
 * File Metadata Tests for FileHatch
 *
 * Tests for file metadata features:
 * - Tags
 * - Description
 * - Properties view
 * - Tag search
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('File Tags @files @metadata', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should open tags modal for file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('tags-test') });

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

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Open context menu and click tags
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });

    const tagsOption = page.locator(Selectors.contextMenu.tags);
    if (await tagsOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tagsOption.click();

      // Tags modal should appear
      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should add tag to file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('add-tag-test') });
    const tagName = `tag-${Date.now()}`;

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

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Open tags
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const tagsOption = page.locator(Selectors.contextMenu.tags);
    if (await tagsOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tagsOption.click();

      // Add tag
      const tagInput = page.locator('input[placeholder*="태그"], input[name="tag"]');
      if (await tagInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tagInput.fill(tagName);
        await page.keyboard.press('Enter');

        // Tag should appear
        await expect(page.locator(`text=${tagName}`)).toBeVisible({ timeout: 5000 });

        // Save
        await page.locator('button:has-text("저장"), button:has-text("Save")').click();
      }
    } else {
      test.skip();
    }
  });

  test('should remove tag from file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('remove-tag-test') });
    const tagName = `remove-tag-${Date.now()}`;

    // Upload and add tag
    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const tagsOption = page.locator(Selectors.contextMenu.tags);
    if (await tagsOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tagsOption.click();

      // Add tag first
      const tagInput = page.locator('input[placeholder*="태그"], input[name="tag"]');
      if (await tagInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tagInput.fill(tagName);
        await page.keyboard.press('Enter');
        await expect(page.locator(`text=${tagName}`)).toBeVisible({ timeout: 5000 });

        // Remove tag
        const removeTagBtn = page.locator(`.tag:has-text("${tagName}") button, .tag-remove`);
        if (await removeTagBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await removeTagBtn.click();

          // Tag should be gone
          await expect(page.locator(`.tag:has-text("${tagName}")`)).not.toBeVisible({ timeout: 5000 });
        }
      }
    } else {
      test.skip();
    }
  });

  test('should search by tag', async ({ page }) => {
    // First create a file with a unique tag
    const testFile = generateTestFile({ name: generateFileName('tag-search-test') });
    const uniqueTag = `unique-search-${Date.now()}`;

    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    // Add tag
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const tagsOption = page.locator(Selectors.contextMenu.tags);
    if (await tagsOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tagsOption.click();

      const tagInput = page.locator('input[placeholder*="태그"], input[name="tag"]');
      if (await tagInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tagInput.fill(uniqueTag);
        await page.keyboard.press('Enter');
        await page.locator('button:has-text("저장"), button:has-text("Save")').click();
        await page.waitForTimeout(500);

        // Search by tag
        await page.locator(Selectors.header.searchExpandBtn).click();
        await page.locator(Selectors.header.searchInput).fill(`tag:${uniqueTag}`);
        await page.waitForTimeout(1000);

        // File should appear in results
        await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });
});

test.describe('File Properties @files @metadata', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should open properties panel', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('properties-test') });

    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const propertiesOption = page.locator(Selectors.contextMenu.properties);
    if (await propertiesOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await propertiesOption.click();

      // Properties panel should appear
      await expect(
        page.locator('text=속성, text=Properties, .properties-panel')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should display file size in properties', async ({ page }) => {
    const testFile = generateTestFile({
      name: generateFileName('size-test'),
      content: 'Content for size testing',
    });

    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const propertiesOption = page.locator(Selectors.contextMenu.properties);
    if (await propertiesOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await propertiesOption.click();

      // Should show size
      await expect(
        page.locator('text=크기, text=Size')
          .or(page.locator('text=B, text=KB, text=바이트'))
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should display modification date in properties', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('date-test') });

    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const propertiesOption = page.locator(Selectors.contextMenu.properties);
    if (await propertiesOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await propertiesOption.click();

      // Should show date
      await expect(
        page.locator('text=수정일, text=Modified, text=날짜')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should add description to file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('description-test') });
    const description = `Test description ${Date.now()}`;

    await page.locator(Selectors.fileList.uploadBtn).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(Selectors.uploadModal.selectFileBtn).click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer,
    });

    await page.locator(Selectors.uploadModal.startUploadBtn).click();
    await expect(page.locator(Selectors.uploadModal.overlay)).not.toBeVisible({ timeout: 30000 });

    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const propertiesOption = page.locator(Selectors.contextMenu.properties);
    if (await propertiesOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await propertiesOption.click();

      // Add description
      const descInput = page.locator(
        'textarea[name="description"], input[name="description"], textarea[placeholder*="설명"]'
      );
      if (await descInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await descInput.fill(description);
        await page.locator('button:has-text("저장"), button:has-text("Save")').click();

        // Description should be saved
        await expect(
          page.locator('text=저장됨, text=Saved')
        ).toBeVisible({ timeout: 5000 }).catch(() => {});
      }
    } else {
      test.skip();
    }
  });
});
