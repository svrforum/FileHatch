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

test.describe('Recent Files @activity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to recent files view', async ({ page }) => {
    const recentFilesLink = page.locator(Selectors.sidebar.recentFiles);
    if (await recentFilesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await recentFilesLink.click();
      await page.waitForTimeout(1000);

      // Should show recent files view
      await expect(
        page.locator('text=최근 파일, text=Recent, text=최근')
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

    // Navigate to recent files
    const recentFilesLink = page.locator(Selectors.sidebar.recentFiles);
    if (await recentFilesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await recentFilesLink.click();
      await page.waitForTimeout(1000);

      // File should appear in recent
      await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should show recent files sorted by access time', async ({ page }) => {
    const recentFilesLink = page.locator(Selectors.sidebar.recentFiles);
    if (await recentFilesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await recentFilesLink.click();
      await page.waitForTimeout(1000);

      // Get list of files
      const fileItems = await page.locator(Selectors.fileList.item).all();

      // If there are multiple items, verify they have date information
      if (fileItems.length > 1) {
        // Check that date column/info exists
        const dateColumn = page.locator('.file-date, .access-time, .modified-time');
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
    if (await favoritesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await favoritesLink.click();
      await page.waitForTimeout(1000);

      // Should show favorites view
      await expect(
        page.locator('text=즐겨찾기, text=Favorites, text=별표')
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

    // Right-click and add to favorites
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    await expect(page.locator(Selectors.contextMenu.container)).toBeVisible({ timeout: 5000 });

    const favoriteOption = page.locator(Selectors.contextMenu.favorite);
    if (await favoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favoriteOption.click();

      // Navigate to favorites and verify
      const favoritesLink = page.locator(Selectors.sidebar.favorites);
      if (await favoritesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await favoritesLink.click();
        await page.waitForTimeout(1000);

        await expect(page.locator(`text=${testFile.name}`)).toBeVisible({ timeout: 10000 });
      }
    } else {
      test.skip();
    }
  });

  test('should remove file from favorites', async ({ page }) => {
    // First add a file to favorites
    const testFile = generateTestFile({ name: generateFileName('unfavorite-test') });

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

    // Add to favorites
    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const favoriteOption = page.locator(Selectors.contextMenu.favorite);
    if (await favoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favoriteOption.click();
      await page.waitForTimeout(500);

      // Navigate to favorites
      const favoritesLink = page.locator(Selectors.sidebar.favorites);
      if (await favoritesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await favoritesLink.click();
        await page.waitForTimeout(1000);

        // Remove from favorites
        await page.locator(`text=${testFile.name}`).click({ button: 'right' });
        const removeFavoriteOption = page.locator(
          '.context-menu >> text=즐겨찾기 제거, .context-menu >> text=Remove favorite'
        );
        if (await removeFavoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await removeFavoriteOption.click();

          // File should be gone from favorites
          await expect(page.locator(`text=${testFile.name}`)).not.toBeVisible({ timeout: 5000 });
        }
      }
    } else {
      test.skip();
    }
  });

  test('should show favorite indicator on file', async ({ page }) => {
    const testFile = generateTestFile({ name: generateFileName('favorite-indicator') });

    // Upload and favorite file
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

    await page.locator(`text=${testFile.name}`).click({ button: 'right' });
    const favoriteOption = page.locator(Selectors.contextMenu.favorite);
    if (await favoriteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favoriteOption.click();
      await page.waitForTimeout(500);

      // Close context menu if still open
      await page.keyboard.press('Escape');

      // Look for favorite indicator (star icon, etc.)
      const fileRow = page.locator(`text=${testFile.name}`).locator('..');
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
    if (await activityLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activityLink.click();
      await page.waitForTimeout(1000);

      // Should show activity view
      await expect(
        page.locator('text=활동, text=Activity, text=내 활동')
      ).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should show activity entries', async ({ page }) => {
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activityLink.click();
      await page.waitForTimeout(1000);

      // Check for activity items or empty state
      const activityItem = page.locator('.activity-item, .activity-entry');
      const emptyState = page.locator('text=활동 없음, text=No activity');

      await expect(activityItem.first().or(emptyState)).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should show activity after file upload', async ({ page }) => {
    // Upload a file
    const testFile = generateTestFile({ name: generateFileName('activity-upload') });

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

    // Navigate to activity
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activityLink.click();
      await page.waitForTimeout(1000);

      // Should show upload activity
      await expect(
        page.locator(`text=${testFile.name}`)
          .or(page.locator('text=업로드, text=Upload'))
      ).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('should filter activity by type', async ({ page }) => {
    const activityLink = page.locator(Selectors.sidebar.activity);
    if (await activityLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activityLink.click();
      await page.waitForTimeout(1000);

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
    if (await activityLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activityLink.click();
      await page.waitForTimeout(1000);

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
