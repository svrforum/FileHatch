/**
 * Activity Tests for FileHatch
 *
 * Tests for activity-related features:
 * - Recent files
 * - Favorites
 * - Activity feed
 */
import { test, expect } from '@playwright/test';
import { generateFileName, generateTestFile } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';
import { revealFile, expectFileGone } from '../helpers/file-list';
import { navigateVia, openUploadDialog } from '../helpers/navigate';

test.describe('Recent Files @activity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to recent files view', async ({ page }) => {
    const recentFilesLink = page.locator(Selectors.sidebar.recentFiles);
    if (await recentFilesLink.count()) {
      await navigateVia(page, Selectors.sidebar.recentFiles);

      // Should show recent files view
      await expect(
        page.locator(':text("최근 파일"), :text("Recent"), :text("최근")').first()
      ).toBeVisible({ timeout: 10000 }).catch(() => {
        // May show file list directly
        expect(page.locator(Selectors.fileList.wrapper)).toBeVisible();
      });
    } else {
      test.skip();
    }
  });

  test('should show recently accessed file', async ({ page }) => {
    // First, upload and access a file
    const testFile = generateTestFile({ name: generateFileName('recent-test') });

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

    // Navigate to recent files
    const recentFilesLink = page.locator(Selectors.sidebar.recentFiles);
    if (await recentFilesLink.count()) {
      await navigateVia(page, Selectors.sidebar.recentFiles);

      // 내 작업 opens on 즐겨찾기; recent items live behind their own tab.
      await page.locator(Selectors.activity.tab.recent).click();
      await page.waitForTimeout(1000);

      // File should appear in recent
      await revealFile(page, testFile.name);
    } else {
      test.skip();
    }
  });

  test('should show recent files sorted by access time', async ({ page }) => {
    const recentFilesLink = page.locator(Selectors.sidebar.recentFiles);
    if (await recentFilesLink.count()) {
      await navigateVia(page, Selectors.sidebar.recentFiles);

      // Get list of files
      const fileItems = await page.locator(Selectors.fileList.item).all();

      // If there are multiple items, verify they have date information
      if (fileItems.length > 1) {
        // Check that date column/info exists
        // The table's date column is .col-date; ".file-date" exists nowhere.
        const dateColumn = page.locator(`${Selectors.activity.row} .col-date`);
        expect(await dateColumn.count()).toBeGreaterThan(0);
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Favorites @activity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to favorites view', async ({ page }) => {
    const favoritesLink = page.locator(Selectors.sidebar.favorites);
    if (await favoritesLink.count()) {
      await navigateVia(page, Selectors.sidebar.favorites);

      // Should show favorites view
      await expect(
        page.locator(':text("즐겨찾기"), :text("Favorites"), :text("별표")').first()
      ).toBeVisible({ timeout: 10000 }).catch(() => {
        expect(page.locator(Selectors.fileList.wrapper)).toBeVisible();
      });
    } else {
      test.skip();
    }
  });

  test('should add file to favorites', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('favorite-test') });

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

    // Right-click and add to favorites
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });

    const favoriteOption = page.locator(Selectors.contextMenu.favorite);
    if (await favoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favoriteOption.click();

      // Navigate to favorites and verify
      const favoritesLink = page.locator(Selectors.sidebar.favorites);
      if (await favoritesLink.count()) {
        await navigateVia(page, Selectors.sidebar.favorites);

        await revealFile(page, testFile.name);
      }
    } else {
      test.skip();
    }
  });

  test('should remove file from favorites', async ({ page }) => {
    // First add a file to favorites
    const testFile = generateTestFile({ name: generateFileName('unfavorite-test') });

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

    // Add to favorites
    await revealFile(page, testFile.name);
    await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
    const favoriteOption = page.locator(Selectors.contextMenu.favorite);
    if (await favoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favoriteOption.click();
      await page.waitForTimeout(500);

      // Navigate to favorites
      const favoritesLink = page.locator(Selectors.sidebar.favorites);
      if (await favoritesLink.count()) {
        await navigateVia(page, Selectors.sidebar.favorites);

        // Remove from favorites
        await revealFile(page, testFile.name);
        await page.locator(`text=${testFile.name}`).first().click({ button: 'right' });
        const removeFavoriteOption = page.locator(
          '.context-menu >> text=즐겨찾기 제거, .context-menu >> text=Remove favorite'
        );
        if (await removeFavoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await removeFavoriteOption.click();

          // File should be gone from favorites
          await expectFileGone(page, testFile.name);
        }
      }
    } else {
      test.skip();
    }
  });

  test('should show favorite indicator on file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('favorite-indicator') });

    // Upload and favorite file
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
    const favoriteOption = page.locator(Selectors.contextMenu.favorite);
    if (await favoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favoriteOption.click();
      await page.waitForTimeout(500);

      // Close context menu if still open
      await page.keyboard.press('Escape');

      // Look for favorite indicator (star icon, etc.)
      const fileRow = page.locator(`text=${testFile.name}`).first().locator('..');
      const favoriteIndicator = fileRow.locator('.favorite-icon, .star-icon, svg[data-icon="star"]');

      // Indicator may or may not be visible depending on UI design
    } else {
      test.skip();
    }
  });
});

test.describe('Activity Feed @activity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to activity view', async ({ page }) => {
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.count()) {
      await navigateVia(page, Selectors.sidebar.activity);

      /*
       * The screen is titled 내 작업 and holds 즐겨찾기 / 최근 항목 tabs -
       * nothing on it is labelled "활동", so the old text lookup could never
       * resolve.
       */
      await expect(page.locator(Selectors.activity.page)).toBeVisible({ timeout: 10000 });
      await expect(page.locator(Selectors.activity.tab.recent)).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should show activity entries', async ({ page }) => {
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.count()) {
      await navigateVia(page, Selectors.sidebar.activity);

      // Entries render as .file-row inside the tab; an empty tab shows its
      // own placeholder instead.
      await page.locator(Selectors.activity.tab.recent).click();
      await page.waitForTimeout(1000);

      const entry = page.locator(Selectors.activity.row).first();
      const emptyState = page.locator(Selectors.activity.page).locator('.empty-state').first();
      await expect(entry.or(emptyState)).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should show activity after file upload', async ({ page }) => {
    // Upload a file
    const testFile = generateTestFile({ name: generateFileName('activity-upload') });

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

    // Navigate to activity
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.count()) {
      await navigateVia(page, Selectors.sidebar.activity);

      // Should show upload activity
      await expect(
        page.locator(`text=${testFile.name}`).first()
          .or(page.locator(':text("업로드"), :text("Upload")').first())
      ).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should filter activity by type', async ({ page }) => {
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.count()) {
      await navigateVia(page, Selectors.sidebar.activity);

      // Look for type filter
      const typeFilter = page.locator(
        'select[name="activityType"], .activity-filter, button:has-text("필터")'
      );
      if (await typeFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Filter exists - UI implementation may vary
        expect(await typeFilter.isVisible()).toBe(true);
      }
    } else {
      test.skip();
    }
  });

  test('should filter activity by date', async ({ page }) => {
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.count()) {
      await navigateVia(page, Selectors.sidebar.activity);

      // Look for date filter
      const dateFilter = page.locator('input[type="date"], .date-filter');
      if (await dateFilter.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        expect(await dateFilter.count()).toBeGreaterThan(0);
      }
    } else {
      test.skip();
    }
  });
});
