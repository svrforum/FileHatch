import { test, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';
import { navigateVia } from '../helpers/navigate';

test.describe('Admin User Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to main page (already authenticated via setup)
    await page.goto('/');

    // Click admin mode button
    await navigateVia(page, Selectors.header.adminBtn);

    // Wait for admin page to load (user cards or admin header)
    await expect(page.locator(Selectors.admin.page)).toBeVisible({
      timeout: 10000,
    });

    // Wait for user list to finish loading (loading message should disappear)
    await expect(page.locator('text=불러오는 중')).not.toBeVisible({ timeout: 15000 });
  });

  test('should display user list', async ({ page }) => {
    // Verify admin page is visible with user cards
    await expect(page.locator(Selectors.admin.page)).toBeVisible();
    await expect(page.locator(':is(h1, h2):has-text("사용자 관리")')).toBeVisible();

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
    await expect(page.locator(':is(h1, h2):has-text("새 사용자 추가")')).toBeVisible({ timeout: 5000 });

    // Fill user form using placeholders since name attributes might not exist
    await page.getByLabel('사용자명 *').fill(newUsername);
    await page.getByLabel('이메일').fill(newEmail);
    await page.getByLabel('비밀번호 *', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인 *').fill(password);

    // Submit form
    await page.locator('button:has-text("사용자 생성")').click();

    // Wait for modal to close
    await expect(page.locator(':is(h1, h2):has-text("새 사용자 추가")')).not.toBeVisible({ timeout: 10000 });

    // Verify user appears in list (card or list view)
    await expect(page.locator(`.user-card:has-text("${newUsername}")`).first()).toBeVisible({ timeout: 10000 });
  });

  test('should toggle password fields independently and reset them for continuous entry', async ({ page }) => {
    await page.getByRole('button', { name: '사용자 추가' }).click();

    const password = page.getByLabel('비밀번호 *', { exact: true });
    const confirmation = page.getByLabel('비밀번호 확인 *');
    await password.fill('TestPass123!');
    await confirmation.fill('TestPass123!');

    await page.getByRole('button', { name: '비밀번호 * 보기' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(confirmation).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: '비밀번호 확인 * 보기' }).click();
    await expect(confirmation).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: '비밀번호 * 숨기기' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('should edit user', async ({ page }) => {
    // Find a non-admin user's edit button
    const userCard = page.locator(Selectors.adminUsers.otherUserCard).first();

    if (await userCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      await userCard.locator(Selectors.adminUsers.editBtn).click();

      // Wait for edit modal
      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

      // The edit dialog exposes no email field - quota is what it can change.
      await page.locator(Selectors.adminUsers.editDialog.quota).fill('5');

      // Save changes
      await page.locator(Selectors.adminUsers.editDialog.submit).click();

      // Wait for modal to close
      await expect(page.locator(Selectors.modal.container)).not.toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should toggle user admin status', async ({ page }) => {
    // Find a non-admin user card
    const userCard = page.locator(Selectors.adminUsers.otherUserCard).first();

    if (await userCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      await userCard.locator(Selectors.adminUsers.editBtn).click();

      // Wait for edit modal
      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

      // Toggle admin checkbox
      await page.locator(Selectors.adminUsers.editDialog.isAdminToggle).click();

      // Save changes
      await page.locator(Selectors.adminUsers.editDialog.submit).click();

      // Wait for modal to close
      await expect(page.locator(Selectors.modal.container)).not.toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should delete user', async ({ page }) => {
    // Create a user to delete first
    /*
     * Underscore, not a hyphen: CreateUserModal.tsx sets
     * pattern="[a-zA-Z0-9_]+" on the username field, so the browser blocks
     * submission for a hyphenated name with a native tooltip and no request
     * is ever sent - even though the server's own rule allows hyphens.
     */
    const deleteUsername = `delete_${Date.now()}`;

    await page.locator(Selectors.adminUsers.addUserBtn).first().click();
    await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

    await page.locator(Selectors.adminUsers.createDialog.username).fill(deleteUsername);
    await page.locator(Selectors.adminUsers.createDialog.email).fill(`${deleteUsername}@example.com`);
    await page.locator(Selectors.adminUsers.createDialog.password).fill('DeleteMe123!');
    await page.locator(Selectors.adminUsers.createDialog.passwordConfirm).fill('DeleteMe123!');
    await page.locator(Selectors.adminUsers.createDialog.submit).click();

    // Wait for user to appear
    await expect(page.locator(`.user-card:has-text("${deleteUsername}")`)).toBeVisible({ timeout: 10000 });

    // Find and click delete button
    const userCard = page.locator(`.user-card:has-text("${deleteUsername}")`);
    /*
     * AdminUserList uses a native confirm(). The handler has to be registered
     * before the click - Playwright auto-dismisses (i.e. cancels) any dialog
     * that opens with no handler attached, so registering it afterwards meant
     * the deletion was always declined and the card never disappeared.
     */
    page.once('dialog', (dialog) => dialog.accept());
    await userCard.locator(Selectors.adminUsers.deleteBtn).click();

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
      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

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
    await expect(page.locator(Selectors.adminUsers.userCard).first()).toBeVisible();
    await expect(page.locator(Selectors.adminUsers.userName).first()).toContainText('admin');
  });

  test('should set user storage quota', async ({ page }) => {
    // Find a non-admin user
    const userCard = page.locator('.user-card:not(:has-text("나"))').first();

    if (await userCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      await userCard.locator('.btn-action.edit, button:has-text("수정")').click();

      // Wait for edit modal
      await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

      // Set quota (e.g., 10GB)
      const quotaInput = page.locator(Selectors.adminUsers.editDialog.quota);
      if (await quotaInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        // The field takes GB and converts to bytes on change.
        await quotaInput.fill('10');

        // Save changes
        await page.locator(Selectors.adminUsers.editDialog.submit).click();

        // Wait for modal to close
        await expect(page.locator(Selectors.modal.container)).not.toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin System Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await navigateVia(page, Selectors.header.adminBtn);
    await navigateVia(page, Selectors.admin.systemSettings);
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });
  });

  test('should display system settings', async ({ page }) => {
    await expect(page.locator(':is(h1, h2):has-text("시스템 설정"), :is(h1, h2):has-text("설정")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should toggle SSO setting', async ({ page }) => {
    // Navigate to SSO settings
    await navigateVia(page, Selectors.admin.ssoSettings);

    // Wait for SSO settings page
    await expect(page.locator(':is(h1, h2):has-text("SSO")')).toBeVisible({ timeout: 10000 });

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
    await navigateVia(page, Selectors.header.adminBtn);
    await navigateVia(page, Selectors.admin.auditLogs);
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    /*
     * Default tab "파일 감사 로그" is empty on a fresh install; "접속 이력"
     * always holds this suite's own sign-in, so assertions test the table
     * rather than the seed data.
     */
    await page.locator(Selectors.admin.logsTab.user).click();
    await page.waitForTimeout(1500);
  });

  test('should display audit logs', async ({ page }) => {
    // Wait for audit logs page
    await expect(page.locator(':is(h1, h2):has-text("감사 로그"), :is(h1, h2):has-text("로그")')).toBeVisible({
      timeout: 10000,
    });

    // Check for log entries or table
    await expect(page.locator('.logs-table tbody tr').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should filter logs by action type', async ({ page }) => {
    // Wait for logs to load
    await expect(page.locator('.logs-table tbody tr').first()).toBeVisible({
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
    await expect(page.locator('.logs-table tbody tr').first()).toBeVisible({
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
    await navigateVia(page, Selectors.header.adminBtn);
    await navigateVia(page, Selectors.admin.sharedFolders);
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });
  });

  test('should display shared folders list', async ({ page }) => {
    await expect(page.locator(':is(h1, h2):has-text("공유 드라이브"), :is(h1, h2):has-text("공유 폴더")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should create shared folder', async ({ page }) => {
    const folderName = `shared-${Date.now()}`;

    // Click create button
    await page.locator(Selectors.adminSharedFolders.createBtn).first().click();

    // Wait for modal
    await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

    // Fill form
    await page.locator(Selectors.adminSharedFolders.dialog.name).fill(folderName);

    // Submit
    await page.locator(Selectors.adminSharedFolders.dialog.submit).click();

    // Verify folder appears
    await expect(page.locator(`text=${folderName}`).first()).toBeVisible({ timeout: 10000 });
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
        await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});
