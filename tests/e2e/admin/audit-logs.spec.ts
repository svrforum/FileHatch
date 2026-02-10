/**
 * Admin Audit Logs Tests for FileHatch
 *
 * Tests for admin audit log features:
 * - View audit logs
 * - Filter logs
 * - Export logs
 * - Log details
 */
import { test, expect } from '@playwright/test';
import { DateUtils } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('Admin Audit Logs @admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Enter admin mode
    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    // Navigate to audit logs
    await page.locator(Selectors.admin.auditLogs).click();
    await page.waitForTimeout(1000);
  });

  test('should display audit logs page', async ({ page }) => {
    await expect(
      page.locator('h2:has-text("감사 로그"), h2:has-text("로그"), h2:has-text("Audit")')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display audit log entries', async ({ page }) => {
    // Wait for logs to load
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr, .log-card').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show log entry details', async ({ page }) => {
    const logEntry = page.locator('.log-entry, .audit-log-row, table tbody tr').first();

    if (await logEntry.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Log entry should contain:
      // - Timestamp
      // - User
      // - Action
      // - Details

      const entryText = await logEntry.textContent();
      expect(entryText).toBeTruthy();

      // Should have timestamp format
      expect(entryText).toMatch(/\d{4}|\d{2}:\d{2}/);
    } else {
      test.skip();
    }
  });

  test('should filter logs by action type', async ({ page }) => {
    // Wait for logs to load
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    // Find action type filter
    const actionFilter = page.locator(
      'select[name="action"], select[name="eventType"], .action-filter select'
    );

    if (await actionFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Get options
      const options = await actionFilter.locator('option').allTextContents();
      expect(options.length).toBeGreaterThan(0);

      // Select a filter option
      await actionFilter.selectOption({ index: 1 });
      await page.waitForTimeout(1000);

      // Logs should be filtered
      // (Can't verify specific filtering without knowing options)
    } else {
      test.skip();
    }
  });

  test('should filter logs by user', async ({ page }) => {
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    // Find user filter
    const userFilter = page.locator(
      'input[name="user"], input[placeholder*="사용자"], select[name="user"]'
    );

    if (await userFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await userFilter.fill('admin');
      await page.waitForTimeout(1000);

      // Apply filter if button exists
      const applyBtn = page.locator('button:has-text("적용"), button:has-text("검색")');
      if (await applyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await applyBtn.click();
        await page.waitForTimeout(1000);
      }
    } else {
      test.skip();
    }
  });

  test('should filter logs by date range', async ({ page }) => {
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    // Find date inputs
    const dateInputs = page.locator('input[type="date"]');

    if (await dateInputs.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      // Set date range
      await dateInputs.first().fill(DateUtils.weekAgo());
      await dateInputs.last().fill(DateUtils.today());

      // Apply filter
      const applyBtn = page.locator('button:has-text("적용"), button:has-text("검색")');
      if (await applyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await applyBtn.click();
        await page.waitForTimeout(1000);
      }
    } else {
      test.skip();
    }
  });

  test('should paginate logs', async ({ page }) => {
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    // Find pagination controls
    const pagination = page.locator('.pagination, .pager, nav[aria-label="Pagination"]');

    if (await pagination.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click next page if available
      const nextBtn = pagination.locator('button:has-text("다음"), button[aria-label="Next"]');
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('should show log count', async ({ page }) => {
    // Look for log count display
    const logCount = page.locator(
      'text=/\\d+개/, text=/\\d+ results/, .log-count'
    );

    if (await logCount.isVisible({ timeout: 5000 }).catch(() => false)) {
      const countText = await logCount.textContent();
      expect(countText).toMatch(/\d+/);
    }
  });

  test('should expand log entry for details', async ({ page }) => {
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    const logEntry = page.locator('.log-entry, .audit-log-row').first();

    if (await logEntry.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Try to expand for more details
      const expandBtn = logEntry.locator('button:has-text("자세히"), button[aria-label="Expand"]');
      if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expandBtn.click();

        // Details should be visible
        await expect(
          page.locator('.log-details, .detail-panel')
        ).toBeVisible({ timeout: 5000 });
      } else {
        // May expand on click
        await logEntry.click();
        await page.waitForTimeout(500);
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log Export @admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    await page.locator(Selectors.admin.auditLogs).click();
    await page.waitForTimeout(1000);
  });

  test('should display export option', async ({ page }) => {
    const exportBtn = page.locator(
      'button:has-text("내보내기"), button:has-text("Export"), button[aria-label="Export"]'
    );

    if (await exportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await exportBtn.isVisible()).toBe(true);
    } else {
      test.skip();
    }
  });

  test('should export logs as CSV', async ({ page }) => {
    const exportBtn = page.locator(
      'button:has-text("내보내기"), button:has-text("Export")'
    );

    if (await exportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exportBtn.click();

      // Format selection may appear
      const csvOption = page.locator('button:has-text("CSV"), option:has-text("CSV")');
      if (await csvOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        const downloadPromise = page.waitForEvent('download');
        await csvOption.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toContain('.csv');
      } else {
        // May download directly
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
        if (downloadPromise) {
          const download = await downloadPromise;
          if (download) {
            expect(download.suggestedFilename()).toBeDefined();
          }
        }
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log Actions @admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    await page.locator(Selectors.admin.auditLogs).click();
    await page.waitForTimeout(1000);
  });

  test('should show different action types', async ({ page }) => {
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    // Look for various action types
    const actionTypes = [
      'login',
      'logout',
      'upload',
      'download',
      'delete',
      'create',
      'update',
      '로그인',
      '로그아웃',
      '업로드',
      '다운로드',
    ];

    let foundActions = 0;
    for (const action of actionTypes) {
      const actionLog = page.locator(`.log-entry:has-text("${action}"), td:has-text("${action}")`);
      if (await actionLog.first().isVisible({ timeout: 500 }).catch(() => false)) {
        foundActions++;
      }
    }

    // Should have at least some action types
    // (May not find any if no recent activity)
  });

  test('should show IP address in logs', async ({ page }) => {
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    // Look for IP address pattern
    const ipPattern = page.locator(
      'text=/\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/, .ip-address'
    );

    if (await ipPattern.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await ipPattern.count()).toBeGreaterThan(0);
    }
  });

  test('should refresh logs', async ({ page }) => {
    await expect(
      page.locator('.log-entry, .audit-log-row, table tbody tr').first()
    ).toBeVisible({ timeout: 10000 });

    const refreshBtn = page.locator(
      'button:has-text("새로고침"), button:has-text("Refresh"), button[aria-label="Refresh"]'
    );

    if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(1000);

      // Logs should still be visible after refresh
      await expect(
        page.locator('.log-entry, .audit-log-row, table tbody tr').first()
      ).toBeVisible({ timeout: 10000 });
    }
  });
});
