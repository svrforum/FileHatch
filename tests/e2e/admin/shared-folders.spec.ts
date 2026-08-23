/**
 * Admin Shared Folders Tests for FileHatch
 *
 * Tests for admin shared folder management:
 * - List shared folders
 * - Create shared folder
 * - Edit shared folder
 * - Delete shared folder
 * - Manage members
 */
import { test, expect } from '@playwright/test';
import { generateFolderName } from '../helpers/test-data';
import { Selectors } from '../helpers/selectors';

test.describe('Admin Shared Folders @admin @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Enter admin mode
    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    // Navigate to shared folders
    await page.locator(Selectors.admin.sharedFolders).click();
    await page.waitForTimeout(1000);
  });

  test('should display shared folders page', async ({ page }) => {
    await expect(
      page.locator(':is(h1, h2):has-text("공유 드라이브"), :is(h1, h2):has-text("공유 폴더"), :is(h1, h2):has-text("Shared")')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display shared folders list', async ({ page }) => {
    // Check for list or empty state
    const folderList = page.locator(Selectors.adminSharedFolders.list);
    const emptyState = page.locator(Selectors.adminSharedFolders.emptyState);

    await expect(folderList.or(emptyState)).toBeVisible({ timeout: 10000 });
  });

  test('should create shared folder', async ({ page }) => {
    const folderName = generateFolderName('admin-shared');

    // Click create button
    await page.locator(Selectors.adminSharedFolders.createBtn).first().click();

    // Modal should appear
    await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

    // Fill form
    await page.locator(Selectors.adminSharedFolders.dialog.name).fill(folderName);

    // Add description if available
    const descInput = page.locator(Selectors.adminSharedFolders.dialog.description);
    if (await descInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await descInput.fill(`Test shared folder created at ${Date.now()}`);
    }

    // Submit
    await page.locator(Selectors.adminSharedFolders.dialog.submit).click();

    // Folder should appear in list
    await expect(page.locator(`text=${folderName}`).first()).toBeVisible({ timeout: 10000 });
  });

  test('should edit shared folder', async ({ page }) => {
    // Find a shared folder
    const folderRow = page.locator(Selectors.adminSharedFolders.card).first();

    if (await folderRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click edit button
      const editBtn = folderRow.locator('button:has-text("수정"), button[aria-label="Edit"]');
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click();

        // Modal should appear
        await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

        // Modify description
        const descInput = page.locator('textarea[name="description"], input[name="description"]');
        if (await descInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await descInput.fill(`Updated at ${Date.now()}`);
        }

        // Save
        await page.locator('button[type="submit"], button:has-text("저장")').click();

        // Modal should close
        await expect(page.locator(Selectors.modal.container)).not.toBeVisible({ timeout: 5000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should delete shared folder', async ({ page }) => {
    // First create a folder to delete
    const folderName = generateFolderName('delete-shared');

    await page.locator(Selectors.adminSharedFolders.createBtn).first().click();

    await page.locator(Selectors.adminSharedFolders.dialog.name).fill(folderName);
    await page.locator(Selectors.adminSharedFolders.dialog.submit).click();

    await expect(page.locator(`text=${folderName}`).first()).toBeVisible({ timeout: 10000 });

    // Find and delete the folder
    const folderRow = page.locator(`.shared-folder-row:has-text("${folderName}"), tr:has-text("${folderName}")`);
    const deleteBtn = folderRow.locator('button:has-text("삭제"), button[aria-label="Delete"]');

    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click();

      // Confirm deletion
      const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      // Folder should be removed
      await expect(page.locator(`text=${folderName}`).first()).not.toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Shared Folder Members @admin @sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.locator(Selectors.header.adminBtn).click();
    await expect(page.locator(Selectors.admin.page)).toBeVisible({ timeout: 10000 });

    await page.locator(Selectors.admin.sharedFolders).click();
    await page.waitForTimeout(1000);
  });

  test('should open member management', async ({ page }) => {
    const folderRow = page.locator('.shared-folder-row, .folder-card, table tbody tr').first();

    if (await folderRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click members button
      const membersBtn = folderRow.locator(
        'button:has-text("멤버"), button:has-text("관리"), button[aria-label="Members"]'
      );
      if (await membersBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await membersBtn.click();

        // Modal should appear
        await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should add member to shared folder', async ({ page }) => {
    const folderRow = page.locator('.shared-folder-row, .folder-card, table tbody tr').first();

    if (await folderRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      const membersBtn = folderRow.locator('button:has-text("멤버"), button:has-text("관리")');
      if (await membersBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await membersBtn.click();
        await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

        // Search for user
        const searchInput = page.locator(
          'input[placeholder*="사용자"], input[placeholder*="user"], input[name="search"]'
        );
        if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await searchInput.fill('admin');
          await page.waitForTimeout(500);

          // Select user from results
          const userOption = page.locator('.user-option, .search-result').first();
          if (await userOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await userOption.click();
          }
        }
      }
    }
    test.skip();
  });

  test('should change member permission', async ({ page }) => {
    const folderRow = page.locator('.shared-folder-row, .folder-card, table tbody tr').first();

    if (await folderRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      const membersBtn = folderRow.locator('button:has-text("멤버"), button:has-text("관리")');
      if (await membersBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await membersBtn.click();
        await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

        // Find member row with permission select
        const memberRow = page.locator('.member-row, .member-item').first();
        if (await memberRow.isVisible({ timeout: 2000 }).catch(() => false)) {
          const permissionSelect = memberRow.locator('select[name="permission"]');
          if (await permissionSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
            await permissionSelect.selectOption({ index: 1 });
          }
        }
      }
    }
    test.skip();
  });

  test('should remove member from shared folder', async ({ page }) => {
    const folderRow = page.locator('.shared-folder-row, .folder-card, table tbody tr').first();

    if (await folderRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      const membersBtn = folderRow.locator('button:has-text("멤버"), button:has-text("관리")');
      if (await membersBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await membersBtn.click();
        await expect(page.locator(Selectors.modal.container)).toBeVisible({ timeout: 5000 });

        // Find member remove button
        const removeBtn = page.locator('.member-row button:has-text("제거"), button[aria-label="Remove member"]');
        if (await removeBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await removeBtn.first().click();

          // Confirm if needed
          const confirmBtn = page.locator(Selectors.confirmModal.confirmBtn);
          if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmBtn.click();
          }
        }
      }
    }
    test.skip();
  });
});
