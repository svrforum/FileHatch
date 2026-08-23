import { Page, expect } from '@playwright/test';
import { Selectors } from './selectors';

/**
 * Brings `name` into the DOM and returns once it is visible.
 *
 * The file list is virtualised: only about 25 rows exist in the DOM at a time.
 * Runs accumulate files, so a freshly uploaded one sorted near the end of the
 * alphabet is simply never rendered, and `expect(text=name).toBeVisible()`
 * fails for reasons that have nothing to do with what the test is checking.
 *
 * Filtering the current folder collapses the list to the match, which works
 * no matter how much data previous runs left behind.
 */
export async function revealFile(page: Page, name: string): Promise<void> {
  const filter = page.locator(Selectors.fileList.localSearchInput);

  if (!(await filter.isVisible().catch(() => false))) {
    await page.locator(Selectors.fileList.localSearchToggle).click();
    await expect(filter).toBeVisible({ timeout: 5000 });
  }

  await filter.fill(name);
  await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 15000 });
}

/** Clears the folder filter so the full listing is shown again. */
export async function clearFileFilter(page: Page): Promise<void> {
  const filter = page.locator(Selectors.fileList.localSearchInput);
  if (await filter.isVisible().catch(() => false)) {
    await filter.fill('');
  }
}
