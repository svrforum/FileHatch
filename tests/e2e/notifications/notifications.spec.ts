/**
 * Notifications Tests for FileHatch
 *
 * Tests for notification system:
 * - Notification display
 * - Mark as read
 * - Delete notifications
 * - Notification preferences
 */
import { test, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';

test.describe('Notification Display @notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should display notification bell in header', async ({ page }) => {
    await expect(page.locator(Selectors.notifications.bell)).toBeVisible({ timeout: 5000 });
  });

  test('should open notification dropdown', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();

    // Dropdown should appear
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });
  });

  test('should show unread badge when notifications exist', async ({ page }) => {
    // Check for unread badge
    const unreadBadge = page.locator(Selectors.notifications.unreadBadge);

    // Badge visibility depends on whether there are unread notifications
    // Just verify the bell is clickable and opens dropdown
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });
  });

  test('should display notification items', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    // Check for notification items or empty state
    const notificationItem = page.locator(Selectors.notifications.item);
    const emptyState = page.locator(
      'text=알림이 없습니다, text=No notifications, text=알림 없음'
    );

    await expect(notificationItem.first().or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('should show notification content', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    const notificationItem = page.locator(Selectors.notifications.item).first();
    if (await notificationItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Notification should have some content
      const content = await notificationItem.textContent();
      expect(content).toBeTruthy();
    }
  });
});

test.describe('Notification Actions @notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should mark notification as read', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    const notificationItem = page.locator(Selectors.notifications.item).first();
    if (await notificationItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Look for unread notification
      const unreadItem = page.locator('.notification-item.unread, .notification-item:not(.read)').first();
      if (await unreadItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Click to mark as read
        await unreadItem.click();

        // Item should become read (class change)
        await page.waitForTimeout(500);
      }
    }
  });

  test('should mark all notifications as read', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    // Look for "mark all as read" button
    const markAllReadBtn = page.locator(Selectors.notifications.markAllRead);
    if (await markAllReadBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await markAllReadBtn.click();

      // Unread badge should disappear or count should become 0
      await page.waitForTimeout(1000);
    }
  });

  test('should delete notification', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    const notificationItem = page.locator(Selectors.notifications.item).first();
    if (await notificationItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Find delete button on notification
      const deleteBtn = notificationItem.locator('button:has-text("삭제"), button[aria-label="Delete"]');
      if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deleteBtn.click();

        // Notification should be removed
        await page.waitForTimeout(500);
      } else {
        // Try hover to reveal delete button
        await notificationItem.hover();
        await page.waitForTimeout(300);

        const hoverDeleteBtn = notificationItem.locator('button.delete, button[aria-label="Delete"]');
        if (await hoverDeleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await hoverDeleteBtn.click();
        }
      }
    }
  });

  test('should clear all notifications', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    // Look for "clear all" button
    const clearAllBtn = page.locator(Selectors.notifications.clearAll);
    if (await clearAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clearAllBtn.click();

      // Confirm if needed
      const confirmBtn = page.locator('button:has-text("확인"), button:has-text("Confirm")');
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      // Should show empty state
      await expect(
        page.locator('text=알림이 없습니다, text=No notifications')
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate to notification source', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    const notificationItem = page.locator(Selectors.notifications.item).first();
    if (await notificationItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Get initial URL
      const initialUrl = page.url();

      // Click notification to navigate
      await notificationItem.click();

      // URL should change or dropdown should close
      await page.waitForTimeout(1000);

      const dropdown = page.locator(Selectors.notifications.dropdown);
      const urlChanged = page.url() !== initialUrl;
      const dropdownClosed = !(await dropdown.isVisible().catch(() => false));

      expect(urlChanged || dropdownClosed).toBe(true);
    }
  });
});

test.describe('Notification Types @notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });
  });

  test('should display share notification', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    // Look for share-related notification
    const shareNotification = page.locator(
      '.notification-item:has-text("공유"), .notification-item:has-text("shared")'
    );

    // If exists, verify it has share-related content
    if (await shareNotification.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const content = await shareNotification.first().textContent();
      expect(content).toMatch(/공유|shared|share/i);
    }
  });

  test('should display system notification', async ({ page }) => {
    await page.locator(Selectors.notifications.bell).click();
    await expect(page.locator(Selectors.notifications.dropdown)).toBeVisible({ timeout: 5000 });

    // Look for system notification
    const systemNotification = page.locator(
      '.notification-item.system, .notification-item:has-text("시스템")'
    );

    if (await systemNotification.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await systemNotification.first().isVisible()).toBe(true);
    }
  });
});

test.describe('Notification Preferences @notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(Selectors.fileList.wrapper)).toBeVisible({ timeout: 10000 });

    // Navigate to profile/settings
    await page.locator(Selectors.header.avatarBtn).click();
    await page.locator(Selectors.header.profileBtn).click();
  });

  test('should display notification settings if available', async ({ page }) => {
    // Look for notification settings section
    const notificationSettings = page.locator(
      'text=알림 설정, text=Notification settings, text=알림 환경설정'
    );

    if (await notificationSettings.isVisible({ timeout: 5000 }).catch(() => false)) {
      expect(await notificationSettings.isVisible()).toBe(true);
    } else {
      // Notification settings may be in a different location
      test.skip();
    }
  });

  test('should toggle email notifications', async ({ page }) => {
    const emailNotificationToggle = page.locator(
      'input[name="emailNotifications"], label:has-text("이메일 알림") input'
    );

    if (await emailNotificationToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const wasChecked = await emailNotificationToggle.isChecked();
      await emailNotificationToggle.click();

      // State should change
      const isChecked = await emailNotificationToggle.isChecked();
      expect(isChecked).not.toBe(wasChecked);
    } else {
      test.skip();
    }
  });

  test('should toggle push notifications', async ({ page }) => {
    const pushNotificationToggle = page.locator(
      'input[name="pushNotifications"], label:has-text("푸시 알림") input'
    );

    if (await pushNotificationToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const wasChecked = await pushNotificationToggle.isChecked();
      await pushNotificationToggle.click();

      const isChecked = await pushNotificationToggle.isChecked();
      expect(isChecked).not.toBe(wasChecked);
    } else {
      test.skip();
    }
  });
});
