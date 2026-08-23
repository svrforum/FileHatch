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

/** Brings `name` into the DOM and returns once it is visible. */
export async function revealFile(page: Page, name: string): Promise<void> {
  const filter = await filterBox(page);
  if (filter) {
    await filter.fill(name);
  }
  await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 15000 });
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
    const filter = await filterBox(page);
    if (filter) {
      await filter.fill('');
      await filter.fill(name);
    } else {
      await page.locator(Selectors.fileList.refreshBtn).click().catch(() => undefined);
    }
    await expect(page.locator(`text=${name}`)).toHaveCount(0, { timeout: 3000 });
  }).toPass({ timeout: 30000 });
}

/** Clears whichever filter is active so the full listing is shown again. */
export async function clearFileFilter(page: Page): Promise<void> {
  const filter = await filterBox(page);
  if (filter) {
    await filter.fill('');
  }
}
