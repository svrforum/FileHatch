/**
 * Issue #36 (v0.14.4) regression tests.
 *
 * The previous v0.14.3 fix added in-batch dedup to addFiles, but the folder
 * drop handler in useFileUploadDragDrop called addFiles ONCE PER FILE — so
 * the in-batch dedup was effectively bypassed and N stacked startAllUploads
 * timers fired in parallel, racing inside checkAndStartUpload.
 *
 * These tests pin the v0.14.4 fixes:
 *  - rapid-fire addFiles calls coalesce into a single startAllUploads timer
 *  - concurrent checkAndStartUpload calls for the same id are de-duplicated
 *    so checkFileExists is invoked only once per item
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock network-touching modules BEFORE importing the store.
const checkFileExistsMock = vi.fn(async (_path: string, _filename: string) => ({ exists: false }))
const getStorageUsageMock = vi.fn(async () => ({ quota: 0, totalUsed: 0 }))

vi.mock('../../api/files', () => ({
  checkFileExists: (path: string, filename: string) => checkFileExistsMock(path, filename),
  getStorageUsage: () => getStorageUsageMock(),
  formatFileSize: (n: number) => `${n} B`,
}))

// tus.Upload constructor is invoked from startUpload — give it inert behavior so
// no real XHR is fired and tests stay fast and deterministic.
const tusStartMock = vi.fn()
vi.mock('tus-js-client', () => ({
  Upload: class {
    options: Record<string, unknown>
    constructor(_file: File, options: Record<string, unknown>) {
      this.options = options
    }
    start = tusStartMock
    abort = vi.fn(async () => {})
    url: string | null = null
  },
}))

import { useUploadStore } from '../uploadStore'

function makeFile(name: string, size = 100): File {
  // jsdom File: arbitrary bytes so size > 0 (the store filters out zero-byte files).
  return new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })
}

function resetStore(): void {
  // Clear queue + transient state. We don't expose a reset action, so manipulate state directly.
  useUploadStore.setState({
    items: [],
    downloads: [],
    interruptedUploads: [],
    isPanelOpen: false,
    duplicateFile: null,
    overwriteAll: false,
  })
}

describe('uploadStore — Issue #36 v0.14.4 fixes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
    checkFileExistsMock.mockReset()
    checkFileExistsMock.mockResolvedValue({ exists: false })
    getStorageUsageMock.mockReset()
    getStorageUsageMock.mockResolvedValue({ quota: 0, totalUsed: 0 })
    tusStartMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid-fire addFiles calls into a single startAllUploads invocation', () => {
    const startSpy = vi.spyOn(useUploadStore.getState(), 'startAllUploads').mockImplementation(async () => {})

    // Simulate the folder-drop pattern: many addFiles calls in the same tick.
    for (let i = 0; i < 50; i++) {
      useUploadStore.getState().addFiles([makeFile(`f${i}.txt`)], `/home/me/dir${i % 5}`)
    }

    // Before the timer fires nothing has been called yet.
    expect(startSpy).not.toHaveBeenCalled()

    // Advance the coalescing window. Even after 50 addFiles calls, only the
    // last-scheduled timer survives — so startAllUploads runs exactly once.
    vi.advanceTimersByTime(150)

    expect(startSpy).toHaveBeenCalledTimes(1)
    startSpy.mockRestore()
  })

  it('dedups identical files within a single addFiles batch', () => {
    const dup = makeFile('same.txt', 100)
    const dupAgain = makeFile('same.txt', 100)
    const other = makeFile('other.txt', 200)

    useUploadStore.getState().addFiles([dup, dupAgain, other], '/home/me/folder')

    expect(useUploadStore.getState().items).toHaveLength(2)
    expect(useUploadStore.getState().items.map(i => i.file.name).sort()).toEqual(['other.txt', 'same.txt'])
  })

  it('dedups files added in two separate calls when the first is still pending', () => {
    useUploadStore.getState().addFiles([makeFile('a.txt', 100)], '/home/me/folder')
    // Same file (name+size+path) added again before the first completes — must not enqueue twice.
    useUploadStore.getState().addFiles([makeFile('a.txt', 100)], '/home/me/folder')

    expect(useUploadStore.getState().items).toHaveLength(1)
  })

  it('checkAndStartUpload is re-entrancy safe: parallel calls invoke checkFileExists at most once per id', async () => {
    // Real timers — the quota check awaits Promise.race against a real
    // setTimeout, and we want microtasks to flow naturally.
    vi.useRealTimers()
    let resolveCheck!: (v: { exists: boolean }) => void
    checkFileExistsMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveCheck = resolve
        })
    )

    useUploadStore.getState().addFiles([makeFile('one.txt', 100)], '/home/me/folder')
    const id = useUploadStore.getState().items[0].id

    // Fire many concurrent checkAndStartUpload calls. The synchronous prelude
    // of the first call sets the in-flight guard before any await, so the
    // remaining nine must bail out immediately without invoking checkFileExists.
    const calls = Array.from({ length: 10 }, () => useUploadStore.getState().checkAndStartUpload(id))

    // checkFileExists is reached only after the quota Promise.race resolves —
    // wait until the mock has been called instead of guessing how many
    // microtask flushes are required.
    await vi.waitFor(() => {
      expect(checkFileExistsMock).toHaveBeenCalled()
    })

    // Pinned: exactly one invocation, no matter how many concurrent starts fired.
    expect(checkFileExistsMock).toHaveBeenCalledTimes(1)

    // Unblock and let the start path complete cleanly so the finally clause
    // releases the in-flight guard for subsequent tests.
    resolveCheck({ exists: false })
    await Promise.all(calls)
  })

  it('cancelAllUploads during in-flight checkFileExists does not resurrect the duplicate modal', async () => {
    // Pin the v0.14.3 stillQueued guard at uploadStore checkAndStartUpload —
    // a user clicking "전체 취소" while a CheckFileExists round-trip is in
    // flight must not see a phantom duplicate prompt for an already-cancelled
    // item once the response finally arrives.
    vi.useRealTimers()
    let resolveCheck!: (v: { exists: boolean }) => void
    checkFileExistsMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveCheck = resolve
        })
    )

    useUploadStore.getState().addFiles([makeFile('one.txt', 100)], '/home/me/folder')
    const id = useUploadStore.getState().items[0].id

    const startCall = useUploadStore.getState().checkAndStartUpload(id)

    // Wait until checkFileExists is being awaited.
    await vi.waitFor(() => {
      expect(checkFileExistsMock).toHaveBeenCalled()
    })

    // User clicks 전체 취소: queue empties, duplicate prompt cleared.
    await useUploadStore.getState().cancelAllUploads()
    expect(useUploadStore.getState().items).toHaveLength(0)

    // Server now reports the file exists. Without the stillQueued guard, this
    // would set duplicateFile and show the modal for a non-existent item.
    resolveCheck({ exists: true })
    await startCall

    expect(useUploadStore.getState().duplicateFile).toBeNull()
    expect(useUploadStore.getState().items).toHaveLength(0)
  })

  it('cancelAllUploads drops items in pending/uploading/duplicate/paused', async () => {
    useUploadStore.getState().addFiles(
      [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')],
      '/home/me/folder'
    )
    expect(useUploadStore.getState().items).toHaveLength(3)

    await useUploadStore.getState().cancelAllUploads()

    expect(useUploadStore.getState().items).toHaveLength(0)
    expect(useUploadStore.getState().duplicateFile).toBeNull()
  })
})
