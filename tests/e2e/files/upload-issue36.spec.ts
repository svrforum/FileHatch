/**
 * Issue #36 Regression Tests
 *
 * Reproduces and verifies fixes for the four symptoms reported in
 * GitHub issue #36 ("파일 업로드 시, 이상 현상"):
 *   (1) Duplicate dialog message clarity (target path is displayed)
 *   (2) "Cancel" wording vs. "Cancel all" — single-file cancel must NOT
 *       silently re-trigger the rest of the queue
 *   (3) Filename collision must NOT accumulate "[1]/[2]/[3]/[4]" copies
 *       when the same file is queued multiple times in a single batch
 *   (4) File list must remain scrollable when the folder contains many files
 */
import { test, expect } from '@playwright/test'
import { generateFileName, generateTestFile } from '../helpers/test-data'
import { Selectors } from '../helpers/selectors'
import { revealFile } from '../helpers/file-list'

const UPLOAD_TIMEOUT = 30_000

async function openUploadModal(page: import('@playwright/test').Page) {
  await page.locator(Selectors.upload.mainBtn).click()
  await expect(page.locator(Selectors.upload.modal)).toBeVisible({ timeout: 5_000 })
}

async function pickAndSetFiles(
  page: import('@playwright/test').Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  const chooserPromise = page.waitForEvent('filechooser')
  await page.locator(Selectors.upload.selectFileBtn).click()
  const chooser = await chooserPromise
  await chooser.setFiles(files)
}

async function uploadSingleFile(
  page: import('@playwright/test').Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await openUploadModal(page)
  await pickAndSetFiles(page, [file])
  await expect(page.locator(Selectors.upload.modal)).not.toBeVisible({ timeout: UPLOAD_TIMEOUT })
  await revealFile(page, file.name)
}

test.describe('Issue #36 — duplicate dialog and queue handling @files @regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.file-list-container, .file-list')).toBeVisible({ timeout: 10_000 })
  })

  test('(symptom 1) duplicate modal shows the target path so users can identify the conflict', async ({ page }) => {
    const file = generateTestFile({ name: generateFileName('issue36-path'), content: 'first' })

    // Upload once so the next upload will hit the duplicate path.
    await uploadSingleFile(page, file)

    // Re-upload the same file — duplicate modal should appear.
    await openUploadModal(page)
    await pickAndSetFiles(page, [file])

    const targetPath = page.getByTestId('duplicate-target-path')
    await expect(targetPath).toBeVisible({ timeout: 10_000 })
    // The hint must include some absolute-looking path so the user can locate
    // the existing file (rather than being told only the filename).
    await expect(targetPath).toContainText(/\//)

    // Skip this conflict so we don't pollute the workspace. Direct DOM click
    // bypasses Playwright's hit-test heuristics that fight the slide-in animation.
    await page.getByTestId('duplicate-cancel-one').evaluate((el: HTMLElement) => el.click())
  })

  test('(symptom 2) "전체 취소" aborts the entire batch instead of silently progressing', async ({ page }) => {
    // Pre-create one file that will be the duplicate.
    const dupName = generateFileName('issue36-batch-dup')
    const dupFile = generateTestFile({ name: dupName, content: 'pre-existing' })
    await uploadSingleFile(page, dupFile)

    // Now select three files at once: the duplicate + two fresh files.
    // The duplicate triggers the modal; the user clicks "전체 취소".
    const fresh1 = generateTestFile({ name: generateFileName('issue36-batch-fresh1'), content: 'a' })
    const fresh2 = generateTestFile({ name: generateFileName('issue36-batch-fresh2'), content: 'b' })

    await openUploadModal(page)
    await pickAndSetFiles(page, [
      { name: dupFile.name, mimeType: dupFile.mimeType, buffer: dupFile.buffer },
      { name: fresh1.name, mimeType: fresh1.mimeType, buffer: fresh1.buffer },
      { name: fresh2.name, mimeType: fresh2.mimeType, buffer: fresh2.buffer },
    ])

    const cancelAll = page.getByTestId('duplicate-cancel-all')
    await expect(cancelAll).toBeVisible({ timeout: 10_000 })
    // Bypass Playwright's hit-test plus the modal slide-in animation by
    // directly dispatching the click. The click handler on the button is
    // what we want to verify, not the pointer-event geometry.
    await cancelAll.evaluate((el: HTMLElement) => el.click())

    // Modal must close and the duplicate dialog must NOT come back for the
    // remaining files. Allow a moment for the queue to settle.
    await expect(page.getByTestId('duplicate-cancel-all')).not.toBeVisible({ timeout: 5_000 })

    // After "전체 취소" the fresh files must NOT have been uploaded. Reload
    // and confirm by listing the folder.
    await page.goto('/')
    await expect(page.locator('.file-list-container, .file-list')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator(`text=${fresh1.name}`).first()).toHaveCount(0)
    await expect(page.locator(`text=${fresh2.name}`).first()).toHaveCount(0)
  })

  test('(symptom 3) selecting the same file four times in one batch enqueues it only once', async ({ page }) => {
    // The reported "[1]/[2]/[3]/[4]" duplication is caused either by the
    // client queuing the same file multiple times or by tus retries fanning
    // out into separate completion events. The store-level dedup we added
    // covers the queue-side cause; here we drive it through the UI by
    // simulating four selections of the exact same file in one filechooser
    // call. The end state must contain exactly one copy on disk.
    const same = generateTestFile({ name: generateFileName('issue36-quad'), content: 'unique' })

    await openUploadModal(page)
    const chooserPromise = page.waitForEvent('filechooser')
    await page.locator(Selectors.upload.selectFileBtn).click()
    const chooser = await chooserPromise
    // Most file pickers de-dup the file list itself; setFiles with four
    // identical entries lets us at least confirm the upload pipeline does
    // not produce numbered copies.
    await chooser.setFiles([
      { name: same.name, mimeType: same.mimeType, buffer: same.buffer },
      { name: same.name, mimeType: same.mimeType, buffer: same.buffer },
      { name: same.name, mimeType: same.mimeType, buffer: same.buffer },
      { name: same.name, mimeType: same.mimeType, buffer: same.buffer },
    ])

    // The store dedups within a batch, so only one upload should run.
    // Allow up to UPLOAD_TIMEOUT for the single upload to complete and the
    // modal's auto-close timer (1s after all-completed) to fire. If a
    // duplicate dialog appears for any reason, that itself is a regression
    // (the same file should not have been queued more than once).
    await expect(page.getByTestId('duplicate-cancel-one')).toHaveCount(0)
    await expect(page.locator(Selectors.upload.modal)).not.toBeVisible({ timeout: UPLOAD_TIMEOUT })
    await page.goto('/')
    await expect(page.locator('.file-list-container, .file-list')).toBeVisible({ timeout: 10_000 })

    // The base name should appear at most once. Crucially, no "[1]"/"[2]"
    // numbered copies should have leaked into the folder.
    // Strip the extension and match plain "<base>[" — we don't need a regex,
    // any DOM text containing that prefix is a numbered duplicate.
    const baseNoExt = same.name.replace(/\.[^.]+$/, '')
    const numbered = page.locator(`text=${baseNoExt}[`).first()
    await expect(numbered).toHaveCount(0)
  })
})

test.describe('Issue #36 — file list scroll @files @regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.file-list-container, .file-list')).toBeVisible({ timeout: 10_000 })
  })

  test('(symptom 4) file list scroll container has a non-zero height (no virtual collapse)', async ({ page }) => {
    // We do not need 100+ files to verify the regression — the bug is purely
    // a CSS/layout one: the virtual scroll container collapses to height: 0
    // when the parent flex chain breaks. Load whichever folder is shown by
    // default and assert the layout invariants directly.
    const containerSelector = '.file-table-body, .file-table-body-virtual'
    const handle = page.locator(containerSelector).first()
    await expect(handle).toBeVisible({ timeout: 10_000 })

    const box = await handle.boundingBox()
    expect(box, 'file table body must have a bounding box').not.toBeNull()
    expect(box!.height).toBeGreaterThan(120)
  })
})

