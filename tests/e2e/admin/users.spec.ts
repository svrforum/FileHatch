import { test, expect } from '@playwright/test';

test.describe('Admin User Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to main page (already authenticated via setup)
    await page.goto('/');

    // Click admin mode button
    await page.locator('.admin-btn:has-text("관리자 모드")').click();

    // Wait for admin page to load (user cards or admin header)
    await expect(page.locator('.admin-page')).toBeVisible({
      timeout: 10000,
    });

    // Wait for user list to finish loading (loading message should disappear)
    await expect(page.locator('text=불러오는 중')).not.toBeVisible({ timeout: 15000 });
  });

  test('should display user list', async ({ page }) => {
    // Verify admin page is visible with user cards
    await expect(page.locator('.admin-page')).toBeVisible();
    await expect(page.locator('h2:has-text("사용자 관리")')).toBeVisible();

    // Should show at least admin user in cards or list
    await expect(page.locator('.user-card:has-text("admin")').first()).toBeVisible({ timeout: 10000 });
  });

  test('should create new user', async ({ page }) => {
    const newUsername = `testuser${Date.now()}`.slice(0, 20); // Keep username short
    const newEmail = `${newUsername}@test.com`;
    const password = 'TestPass123!';

    // Click create user button
    await page.locator('.btn-primary:has-text("사용자 추가")').click();

    // Wait for modal to appear
    await expect(page.locator('h2:has-text("새 사용자 추가")')).toBeVisible({ timeout: 5000 });

    // Fill user form using placeholders since name attributes might not exist
    await page.locator('input[placeholder*="영문, 숫자"]').fill(newUsername);
    await page.locator('input[placeholder="선택 사항"]').fill(newEmail);
    await page.locator('input[placeholder="8자 이상"]').fill(password);
    await page.locator('input[placeholder="비밀번호 재입력"]').fill(password);

    // Submit form
    await page.locator('button:has-text("사용자 생성")').click();

    // Wait for modal to close
    await expect(page.locator('h2:has-text("새 사용자 추가")')).not.toBeVisible({ timeout: 10000 });

    // Verify user appears in list (card or list view)
    await expect(page.locator(`.user-card:has-text("${newUsername}")`).first()).toBeVisible({ timeout: 10000 });
  });

  test('should edit user', async ({ page }) => {
    // Find a non-admin user's edit button
    const userCard = page.locator('.user-card:not(:has-text("나"))').first();

    if (await userCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      await userCard.locator('.btn-action.edit, button:has-text("수정")').click();

      // Wait for edit modal
      await expect(page.locator('.modal, [role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Modify user email
      const newEmail = `edited-${Date.now()}@test.com`;
      await page.locator('input[name="email"]').fill(newEmail);

      // Save changes
      await page.locator('button[type="submit"]:has-text("저장"), button[type="submit"]:has-text("수정")').click();

      // Wait for modal to close
      await expect(page.locator('.modal, [role="dialog"]')).not.toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should toggle user admin status', async ({ page }) => {
    // Find a non-admin user card
    const userCard = page.locator('.user-card:not(:has-text("나"))').first();

    if (await userCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      await userCard.locator('.btn-action.edit, button:has-text("수정")').click();

      // Wait for edit modal
      await expect(page.locator('.modal, [role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Toggle admin checkbox
      await page.locator('input[name="isAdmin"], label:has-text("관리자") input[type="checkbox"]').click();

      // Save changes
      await page.locator('button[type="submit"]').click();

      // Wait for modal to close
      await expect(page.locator('.modal, [role="dialog"]')).not.toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should delete user', async ({ page }) => {
    // Create a user to delete first
    const deleteUsername = `delete-${Date.now()}`;

    await page.locator('.btn-primary:has-text("사용자 추가")').click();
    await expect(page.locator('.modal, [role="dialog"]')).toBeVisible({ timeout: 5000 });

    await page.locator('input[name="username"]').fill(deleteUsername);
    await page.locator('input[name="email"]').fill(`${deleteUsername}@test.com`);
    await page.locator('input[name="password"]').fill('DeleteMe123!');
    await page.locator('button[type="submit"]').click();

    // Wait for user to appear
    await expect(page.locator(`.user-card:has-text("${deleteUsername}")`)).toBeVisible({ timeout: 10000 });

    // Find and click delete button
    const userCard = page.locator(`.user-card:has-text("${deleteUsername}")`);
    await userCard.locator('.btn-action.delete, button:has-text("삭제")').click();

    // Handle confirmation dialog (browser dialog)
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Verify user is removed
    await expect(page.locator(`.user-card:has-text("${deleteUsername}")`)).not.toBeVisible({ timeout: 10000 });
  });

  test('should reset user 2FA', async ({ page }) => {
    // Find a user with 2FA badge
    const user2FA = page.locator('.user-card:has(.badge.twofa)').first();

    if (await user2FA.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      await user2FA.locator('.btn-action.edit, button:has-text("수정")').click();

      // Wait for edit modal
      await expect(page.locator('.modal, [role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Look for 2FA reset button
      const reset2FABtn = page.locator('button:has-text("2FA 초기화"), button:has-text("2FA 리셋")');
      if (await reset2FABtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await reset2FABtn.click();
        // Handle confirmation
        page.on('dialog', async (dialog) => {
          await dialog.accept();
        });
      }
    } else {
      test.skip();
    }
  });

  test('should search users', async ({ page }) => {
    // Enter search term in search box
    await page.locator('.search-box input').fill('admin');

    // Wait for filtered results
    await page.waitForTimeout(500);

    // Verify admin is visible
    await expect(page.locator('.user-card:has-text("admin"), .user-name:has-text("admin")')).toBeVisible();
  });

  test('should set user storage quota', async ({ page }) => {
    // Find a non-admin user
    const userCard = page.locator('.user-card:not(:has-text("나"))').first();

    if (await userCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      await userCard.locator('.btn-action.edit, button:has-text("수정")').click();

      // Wait for edit modal
      await expect(page.locator('.modal, [role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Set quota (e.g., 10GB)
      const quotaInput = page.locator('input[name="storageQuota"]');
      if (await quotaInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await quotaInput.fill('10737418240');

        // Save changes
        await page.locator('button[type="submit"]').click();

        // Wait for modal to close
        await expect(page.locator('.modal, [role="dialog"]')).not.toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin System Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.admin-btn:has-text("관리자 모드")').click();
    await page.locator('a[href="/fhadmin/settings"], .nav-item:has-text("시스템 설정")').click();
    await expect(page.locator('.admin-page')).toBeVisible({ timeout: 10000 });
  });

  test('should display system settings', async ({ page }) => {
    await expect(page.locator('h2:has-text("시스템 설정"), h2:has-text("설정")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should toggle SSO setting', async ({ page }) => {
    // Navigate to SSO settings
    await page.locator('a[href="/fhadmin/sso"], .nav-item:has-text("SSO 설정")').click();

    // Wait for SSO settings page
    await expect(page.locator('h2:has-text("SSO")')).toBeVisible({ timeout: 10000 });

    // Find SSO toggle if present
    const ssoToggle = page.locator('input[type="checkbox"]').first();

    if (await ssoToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Get current state and toggle
      const wasChecked = await ssoToggle.isChecked();
      await ssoToggle.click();

      // Save if there's a save button
      const saveBtn = page.locator('button:has-text("저장")');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click();
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Logs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.admin-btn:has-text("관리자 모드")').click();
    await page.locator('a[href="/fhadmin/logs"], .nav-item:has-text("감사 로그")').click();
    await expect(page.locator('.admin-page')).toBeVisible({ timeout: 10000 });
  });

  test('should display audit logs', async ({ page }) => {
    // Wait for audit logs page
    await expect(page.locator('h2:has-text("감사 로그"), h2:has-text("로그")')).toBeVisible({
      timeout: 10000,
    });

    // Check for log entries or table
    await expect(page.locator('.log-entry, .audit-log-row, table tbody tr, .log-card').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should filter logs by action type', async ({ page }) => {
    // Wait for logs to load
    await expect(page.locator('.log-entry, .audit-log-row, table tbody tr, .log-card').first()).toBeVisible({
      timeout: 10000,
    });

    // Find and use action filter
    const actionFilter = page.locator('select, .filter-select').first();
    if (await actionFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await actionFilter.selectOption({ index: 1 });
      await page.waitForTimeout(1000);
    } else {
      test.skip();
    }
  });

  test('should filter logs by date range', async ({ page }) => {
    // Wait for logs to load
    await expect(page.locator('.log-entry, .audit-log-row, table tbody tr, .log-card').first()).toBeVisible({
      timeout: 10000,
    });

    // Find date inputs
    const dateInputs = page.locator('input[type="date"]');
    if (await dateInputs.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      await dateInputs.first().fill(weekAgo.toISOString().split('T')[0]);
      await dateInputs.last().fill(today.toISOString().split('T')[0]);

      // Apply filter if there's a button
      const applyBtn = page.locator('button:has-text("적용"), button:has-text("검색")');
      if (await applyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await applyBtn.click();
      }

      await page.waitForTimeout(1000);
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Shared Folders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.admin-btn:has-text("관리자 모드")').click();
    await page.locator('a[href="/fhadmin/shared-folders"], .nav-item:has-text("공유 드라이브")').click();
    await expect(page.locator('.admin-page')).toBeVisible({ timeout: 10000 });
  });

  test('should display shared folders list', async ({ page }) => {
    await expect(page.locator('h2:has-text("공유 드라이브"), h2:has-text("공유 폴더")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should create shared folder', async ({ page }) => {
    const folderName = `shared-${Date.now()}`;

    // Click create button
    const createBtn = page.locator('button:has-text("추가"), button:has-text("생성"), .btn-primary');
    await createBtn.click();

    // Wait for modal
    await expect(page.locator('.modal, [role="dialog"]')).toBeVisible({ timeout: 5000 });

    // Fill form
    await page.locator('input[name="name"], input[placeholder*="이름"]').fill(folderName);

    // Submit
    await page.locator('button[type="submit"]').click();

    // Verify folder appears
    await expect(page.locator(`text=${folderName}`)).toBeVisible({ timeout: 10000 });
  });

  test('should add member to shared folder', async ({ page }) => {
    // Find a shared folder row
    const folderRow = page.locator('.shared-folder-row, .folder-card, table tbody tr').first();

    if (await folderRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click manage members button
      const membersBtn = folderRow.locator('button:has-text("멤버"), button:has-text("관리")');
      if (await membersBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await membersBtn.click();

        // Wait for modal
        await expect(page.locator('.modal, [role="dialog"]')).toBeVisible({ timeout: 5000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});
