import { Page, Locator, expect } from '@playwright/test';
import { Selectors } from './selectors';

/**
 * Returns the filter box for whichever list is on screen, opening it first if
 * the toolbar keeps it collapsed. Null when the current view has no filter.
 *
 * The file list is virtualised - roughly 25 rows exist in the DOM at a time.
 * Runs accumulate files and trash entries, so a freshly created one is often
 * never rendered, and asserting on it fails for reasons unrelated to what the
 * test is checking. Filtering collapses the list to the match, which holds no
 * matter how much data previous runs left behind.
 */
async function filterBox(page: Page): Promise<Locator | null> {
  const trashFilter = page.locator(Selectors.trash.searchInput);
  if (await trashFilter.isVisible().catch(() => false)) {
    return trashFilter;
  }

  const listFilter = page.locator(Selectors.fileList.localSearchInput);
  if (await listFilter.isVisible().catch(() => false)) {
    return listFilter;
  }

  const toggle = page.locator(Selectors.fileList.localSearchToggle);
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await expect(listFilter).toBeVisible({ timeout: 5000 });
    return listFilter;
  }

  return null;
}

/** The list currently on screen - trash view or the file browser. */
function listScope(page: Page): Locator {
  return page.locator(`${Selectors.trash.container}, ${Selectors.fileList.wrapper}`).first();
}

/** Brings `name` into the DOM and returns once it is visible. */
export async function revealFile(page: Page, name: string): Promise<void> {
  const filter = await filterBox(page);
  if (filter) {
    await filter.fill(name);
  }
  await expect(listScope(page).locator(`text=${name}`).first()).toBeVisible({ timeout: 15000 });
}

/**
 * Asserts `name` is no longer in the current view.
 *
 * Deletions and restores run as background transfer jobs, and while a filter is
 * active the list does not re-query when one finishes - the row lingers until
 * the query is re-entered. Re-applying it forces the refetch, so this waits on
 * the server's actual state rather than a stale render.
 */
export async function expectFileGone(page: Page, name: string): Promise<void> {
  await expect(async () => {
    /*
     * Best-effort refresh. Emptying the trash removes the filter box along
     * with the rows, so neither control is guaranteed to still be there - and
     * a throw here would keep retrying until the deadline even though the
     * assertion below would already pass.
     */
    try {
      const filter = await filterBox(page);
      if (filter) {
        await filter.fill('');
        await filter.fill(name);
      } else {
        await page.locator(Selectors.fileList.refreshBtn).click({ timeout: 2000 });
      }
    } catch {
      // nothing to refresh - fall through to the assertion
    }
    /*
     * Scope to the list: the sidebar's transfer panel and toast both echo the
     * file name after a delete or restore, so a page-wide count never reaches
     * zero even when the row itself is gone.
     */
    /*
     * Count rows, not text. A trash row repeats the name inside its original
     * path, and the sidebar transfer panel echoes it after a delete, so a
     * text-based count never settles at zero even once the row is gone.
     */
    await expect(
      page.locator(`${Selectors.trash.item}, ${Selectors.fileList.row}`).filter({ hasText: name })
    ).toHaveCount(0, { timeout: 3000 });
  }).toPass({ timeout: 30000 });
}

/** Clears whichever filter is active so the full listing is shown again. */
export async function clearFileFilter(page: Page): Promise<void> {
  const filter = await filterBox(page);
  if (filter) {
    await filter.fill('');
  }
}

/** The trash row for `name`, revealed first so it exists in the DOM. */
export async function trashRow(page: Page, name: string): Promise<Locator> {
  await revealFile(page, name);

  /*
   * Let the filtered list settle before handing the row back. Typing into the
   * filter re-renders the list, and a click dispatched into the old node in
   * that window is simply lost - the button reports no error and no request
   * ever reaches the server.
   */
  const rows = page.locator(Selectors.trash.item, { hasText: name });
  await expect(rows).toHaveCount(1, { timeout: 10000 });
  await page.waitForTimeout(300);

  return rows.first();
}

/**
 * Restores `name` from the trash.
 *
 * Targets the row that holds the name rather than the first row on screen -
 * with the filter not yet applied, `.first()` restores whatever unrelated
 * entry happens to be at the top and the test's own file stays put.
 */
export async function restoreFromTrash(page: Page, name: string): Promise<void> {
  const row = await trashRow(page, name);
  const button = row.locator('button.restore-btn');
  await expect(button, `restore button for ${name}`).toBeVisible({ timeout: 5000 });
  await button.click();
  await expect(page.locator(Selectors.trash.item, { hasText: name }),
    `${name} should leave the trash after restore`).toHaveCount(0, { timeout: 20000 });
}

/** Permanently deletes `name` from the trash, accepting the confirmation. */
export async function purgeFromTrash(page: Page, name: string): Promise<void> {
  const row = await trashRow(page, name);
  const button = row.locator('button.delete-btn');
  await expect(button, `permanent-delete button for ${name}`).toBeVisible({ timeout: 5000 });
  await button.click();

  // Trash.tsx always confirms a permanent delete, so wait for the dialog
  // rather than treating it as optional and racing past it.
  const confirm = page.locator(Selectors.confirmModal.confirmBtn);
  await expect(confirm, 'permanent-delete confirmation').toBeVisible({ timeout: 10000 });
  await confirm.click();
  await expect(page.locator(Selectors.trash.item, { hasText: name }),
    `${name} should leave the trash after a permanent delete`).toHaveCount(0, { timeout: 20000 });
}
