import { test, expect } from '@playwright/test';

test.describe('Admin User Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin panel
    await page.goto('/');

    // Click admin menu
    await page.locator('[data-testid="admin-menu"], a:has-text("관리"), a:has-text("Admin")').click();

    // Go to users section
    await page.locator('a:has-text("사용자"), a:has-text("Users")').click();

    // Wait for user list
    await expect(page.locator('[data-testid="user-list"], .user-list, table')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should display user list', async ({ page }) => {
    // Verify user list is visible
    await expect(page.locator('[data-testid="user-list"], .user-list, table')).toBeVisible();

    // Should show at least admin user
    await expect(page.locator('text=admin')).toBeVisible();
  });

  test('should create new user', async ({ page }) => {
    const newUsername = `testuser-${Date.now()}`;
    const newEmail = `${newUsername}@test.com`;

    // Click create user button
    await page.locator('button:has-text("사용자 추가"), button:has-text("Add User"), button:has-text("Create")').click();

    // Fill user form
    await page.locator('input[name="username"], input[placeholder*="사용자명"]').fill(newUsername);
    await page.locator('input[name="email"], input[type="email"]').fill(newEmail);
    await page.locator('input[name="password"], input[type="password"]').first().fill('TestPass123!');

    // Submit form
    await page.locator('button[type="submit"], button:has-text("만들기"), button:has-text("Create")').click();

    // Verify user appears in list
    await expect(page.locator(`text=${newUsername}`)).toBeVisible({ timeout: 5000 });
  });

  test('should edit user', async ({ page }) => {
    // Find a non-admin user to edit or create one
    const targetUser = page.locator('tr:not(:has-text("admin"))').first();

    if (await targetUser.isVisible()) {
      // Click edit button
      await targetUser.locator('button:has-text("수정"), button:has-text("Edit"), button[aria-label="Edit"]').click();

      // Modify user email
      const newEmail = `edited-${Date.now()}@test.com`;
      await page.locator('input[name="email"], input[type="email"]').fill(newEmail);

      // Save changes
      await page.locator('button[type="submit"], button:has-text("저장"), button:has-text("Save")').click();

      // Verify success message or updated data
      await expect(page.locator('text=성공, text=Success, text=updated').or(page.locator(`text=${newEmail}`))).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('should toggle user admin status', async ({ page }) => {
    // Find a non-admin user
    const targetUser = page.locator('tr:not(:has-text("admin"))').first();

    if (await targetUser.isVisible()) {
      // Click edit button
      await targetUser.locator('button:has-text("수정"), button:has-text("Edit")').click();

      // Toggle admin checkbox
      await page.locator('input[name="isAdmin"], input[type="checkbox"]:near(:text("관리자"))').click();

      // Save changes
      await page.locator('button[type="submit"], button:has-text("저장")').click();

      // Verify change was saved
      await expect(page.locator('text=성공, text=Success')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should delete user', async ({ page }) => {
    // Create a user to delete first
    const deleteUsername = `delete-user-${Date.now()}`;

    await page.locator('button:has-text("사용자 추가"), button:has-text("Add User")').click();
    await page.locator('input[name="username"]').fill(deleteUsername);
    await page.locator('input[name="email"]').fill(`${deleteUsername}@test.com`);
    await page.locator('input[name="password"]').first().fill('DeleteMe123!');
    await page.locator('button[type="submit"]').click();

    // Wait for user to appear
    await expect(page.locator(`text=${deleteUsername}`)).toBeVisible({ timeout: 5000 });

    // Find and delete the user
    const userRow = page.locator(`tr:has-text("${deleteUsername}")`);
    await userRow.locator('button:has-text("삭제"), button:has-text("Delete")').click();

    // Confirm deletion
    await page.locator('button:has-text("확인"), button:has-text("Confirm"), button:has-text("삭제")').click();

    // Verify user is removed
    await expect(page.locator(`text=${deleteUsername}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('should reset user 2FA', async ({ page }) => {
    // Find a user with 2FA enabled (if any)
    const user2FA = page.locator('tr:has-text("2FA"), tr:has([data-2fa="enabled"])').first();

    if (await user2FA.isVisible()) {
      // Click reset 2FA button
      await user2FA.locator('button:has-text("2FA 리셋"), button:has-text("Reset 2FA")').click();

      // Confirm reset
      await page.locator('button:has-text("확인"), button:has-text("Confirm")').click();

      // Verify success
      await expect(page.locator('text=성공, text=Success, text=reset')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should search users', async ({ page }) => {
    // Enter search term
    await page.locator('input[placeholder*="검색"], input[type="search"]').fill('admin');

    // Wait for filtered results
    await page.waitForTimeout(500); // Debounce

    // Verify admin is visible
    await expect(page.locator('text=admin')).toBeVisible();
  });

  test('should set user storage quota', async ({ page }) => {
    // Find a non-admin user
    const targetUser = page.locator('tr:not(:has-text("admin"))').first();

    if (await targetUser.isVisible()) {
      // Click edit button
      await targetUser.locator('button:has-text("수정"), button:has-text("Edit")').click();

      // Set quota (e.g., 10GB)
      await page.locator('input[name="storageQuota"], input[placeholder*="용량"]').fill('10737418240');

      // Save changes
      await page.locator('button[type="submit"]').click();

      // Verify success
      await expect(page.locator('text=성공, text=Success')).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Admin System Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="admin-menu"], a:has-text("관리")').click();
    await page.locator('a:has-text("설정"), a:has-text("Settings")').click();
  });

  test('should display system settings', async ({ page }) => {
    await expect(page.locator('h1:has-text("설정"), h1:has-text("Settings")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should toggle SSO setting', async ({ page }) => {
    // Find SSO toggle
    const ssoToggle = page.locator('input[name="ssoEnabled"], input:near(:text("SSO"))');

    if (await ssoToggle.isVisible()) {
      // Get current state
      const wasChecked = await ssoToggle.isChecked();

      // Toggle
      await ssoToggle.click();

      // Save
      await page.locator('button:has-text("저장"), button:has-text("Save")').click();

      // Verify change
      await expect(ssoToggle).toBeChecked({ checked: !wasChecked });
    }
  });
});

test.describe('Admin Audit Logs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="admin-menu"], a:has-text("관리")').click();
    await page.locator('a:has-text("로그"), a:has-text("Logs")').click();
  });

  test('should display audit logs', async ({ page }) => {
    await expect(page.locator('[data-testid="audit-logs"], .audit-logs, table')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should filter logs by action type', async ({ page }) => {
    // Select action filter
    await page.locator('select[name="action"], select:near(:text("액션"))').selectOption('login');

    // Verify filtered results
    await expect(page.locator('td:has-text("login")')).toBeVisible({ timeout: 5000 });
  });

  test('should filter logs by date range', async ({ page }) => {
    // Set date range (last 7 days)
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    await page.locator('input[name="startDate"], input[type="date"]').first().fill(weekAgo.toISOString().split('T')[0]);
    await page.locator('input[name="endDate"], input[type="date"]').last().fill(today.toISOString().split('T')[0]);

    // Apply filter
    await page.locator('button:has-text("적용"), button:has-text("Apply")').click();

    // Verify results are shown
    await expect(page.locator('[data-testid="audit-logs"] tr, .audit-logs tr')).toHaveCount.greaterThan(0);
  });
});

test.describe('Admin Shared Folders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="admin-menu"], a:has-text("관리")').click();
    await page.locator('a:has-text("공유 폴더"), a:has-text("Shared Folders")').click();
  });

  test('should display shared folders list', async ({ page }) => {
    await expect(page.locator('[data-testid="shared-folders"], .shared-folders, table')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should create shared folder', async ({ page }) => {
    const folderName = `shared-${Date.now()}`;

    // Click create button
    await page.locator('button:has-text("추가"), button:has-text("Create"), button:has-text("Add")').click();

    // Fill form
    await page.locator('input[name="name"], input[placeholder*="이름"]').fill(folderName);

    // Submit
    await page.locator('button[type="submit"]').click();

    // Verify folder appears
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 5000 });
  });

  test('should add member to shared folder', async ({ page }) => {
    // Find a shared folder
    const sharedFolder = page.locator('[data-testid="shared-folder-row"], tr').first();

    if (await sharedFolder.isVisible()) {
      // Click manage members
      await sharedFolder.locator('button:has-text("멤버"), button:has-text("Members")').click();

      // Add member
      await page.locator('button:has-text("추가"), button:has-text("Add")').click();

      // Select user
      await page.locator('select[name="userId"], input[placeholder*="사용자"]').selectOption({ index: 1 });

      // Set permission
      await page.locator('select[name="permission"]').selectOption('write');

      // Submit
      await page.locator('button[type="submit"]').click();

      // Verify member added
      await expect(page.locator('text=성공, text=added')).toBeVisible({ timeout: 5000 });
    }
  });
});
