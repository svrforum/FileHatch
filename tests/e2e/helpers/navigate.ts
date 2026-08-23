import { Page, Locator, expect } from '@playwright/test';
import { Selectors } from './selectors';

/**
 * Clicks a sidebar entry, opening the mobile drawer first when needed.
 *
 * On narrow viewports the sidebar is not hidden - it is parked off-screen at
 * x: -280 via a transform. Playwright still reports it as visible, so a click
 * appears to succeed while landing outside the viewport and navigating
 * nowhere. Every mobile run failed this way: 48 of the first 49 tests died
 * waiting for a page that was never opened.
 *
 * The drawer closes itself after a navigation, so this is safe to call
 * repeatedly.
 */
export async function navigateVia(page: Page, sidebarSelector: string): Promise<void> {
  const drawerToggle = page.locator(Selectors.header.mobileMenuBtn);

  if (await drawerToggle.isVisible().catch(() => false)) {
    const sidebar = page.locator(Selectors.sidebar.container).first();
    const parked = await sidebar.boundingBox();
    if (!parked || parked.x < 0) {
      await drawerToggle.click();
      await expect
        .poll(async () => (await sidebar.boundingBox())?.x ?? -1, { timeout: 5000 })
        .toBeGreaterThanOrEqual(0);
    }
  }

  await page.locator(sidebarSelector).click();
  await page.waitForTimeout(800);
}

/**
 * Opens the upload dialog from whichever control the current layout offers.
 *
 * The sidebar's 업로드 button sits inside the drawer, so on a phone it is
 * parked off-screen at x: -264 and clicking it does nothing. Narrow viewports
 * get a floating action button instead, which fans out to 새 폴더 / 업로드.
 */
export async function openUploadDialog(page: Page): Promise<void> {
  const fab = page.locator(Selectors.fileList.mobileFab);

  if (await fab.isVisible().catch(() => false)) {
    await fab.click();
    const uploadAction = page.locator(Selectors.fileList.mobileFabAction, { hasText: '업로드' });
    await expect(uploadAction).toBeVisible({ timeout: 5000 });
    await uploadAction.click();
  } else {
    await page.locator(Selectors.fileList.uploadBtn).click();
  }

  await expect(page.locator(Selectors.uploadModal.container)).toBeVisible({ timeout: 10000 });
}

/** Opens the new-folder dialog, using the FAB when the sidebar is off-screen. */
export async function openNewFolderDialog(page: Page): Promise<void> {
  const fab = page.locator(Selectors.fileList.mobileFab);

  if (await fab.isVisible().catch(() => false)) {
    await fab.click();
    const folderAction = page.locator(Selectors.fileList.mobileFabAction, { hasText: '새 폴더' });
    await expect(folderAction).toBeVisible({ timeout: 5000 });
    await folderAction.click();
  } else {
    await page.locator(Selectors.fileList.newFolderBtn).click();
  }

  await expect(page.locator(Selectors.createFolderModal.container)).toBeVisible({ timeout: 10000 });
}

/**
 * Puts `rows` into a multi-selection, using whichever gesture the layout has.
 *
 * Desktop selects with ctrl-click. Phones have no modifier key, so FileList
 * offers a "선택" entry in the context menu that switches the list into
 * selection mode; from there a plain tap toggles each row.
 */
export async function selectRows(page: Page, rows: Locator): Promise<void> {
  const count = await rows.count();
  if (count < 2) {
    throw new Error(`selectRows needs at least two rows, got ${count}`);
  }

  const onMobile = await page.locator(Selectors.fileList.mobileFab).isVisible().catch(() => false);

  if (onMobile) {
    await rows.nth(0).click({ button: 'right' });
    await page.locator(Selectors.contextMenu.enterSelection).click();
    for (let i = 1; i < count; i += 1) {
      await rows.nth(i).click();
    }
  } else {
    await rows.nth(0).click();
    for (let i = 1; i < count; i += 1) {
      await rows.nth(i).click({ modifiers: ['Control'] });
    }
  }

  await expect(page.locator(Selectors.multiSelect.bar)).toBeVisible({ timeout: 5000 });
}
