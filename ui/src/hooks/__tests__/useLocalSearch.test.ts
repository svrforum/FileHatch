import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalSearch } from '../useLocalSearch'
import type { SearchResponse, FileInfo } from '../../api/files'

// Mock the API
vi.mock('../../api/files', () => ({
  searchFiles: vi.fn(),
  FileInfo: {},
}))

import { searchFiles } from '../../api/files'

const mockSearchFiles = searchFiles as ReturnType<typeof vi.fn<typeof searchFiles>>

// Helper to create complete mock search responses
const createMockResponse = (results: FileInfo[] = [], total: number = 0): SearchResponse => ({
  results,
  total,
  query: 'test',
  page: 1,
  limit: 100,
  hasMore: false,
  matchType: 'name' as const,
})

describe('useLocalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSearchFiles.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home' })
    )

    expect(result.current.query).toBe('')
    expect(result.current.results).toEqual([])
    expect(result.current.isSearching).toBe(false)
    expect(result.current.showSearch).toBe(false)
  })

  it('should open search when openSearch is called', () => {
    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home' })
    )

    act(() => {
      result.current.openSearch()
    })

    expect(result.current.showSearch).toBe(true)
  })

  it('should close search and clear query when closeSearch is called', () => {
    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home' })
    )

    act(() => {
      result.current.openSearch()
      result.current.setQuery('test')
    })

    act(() => {
      result.current.closeSearch()
    })

    expect(result.current.showSearch).toBe(false)
    expect(result.current.query).toBe('')
    expect(result.current.results).toEqual([])
  })

  it('should clear query when clearSearch is called', () => {
    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home' })
    )

    act(() => {
      result.current.setQuery('test')
    })

    act(() => {
      result.current.clearSearch()
    })

    expect(result.current.query).toBe('')
    expect(result.current.results).toEqual([])
  })

  it('should debounce search calls', async () => {
    mockSearchFiles.mockResolvedValue(createMockResponse())

    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home', debounceMs: 300 })
    )

    act(() => {
      result.current.setQuery('test')
    })

    // Should be searching but no API call yet
    expect(result.current.isSearching).toBe(true)
    expect(mockSearchFiles).not.toHaveBeenCalled()

    // Advance timers past debounce
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Now API should be called
    expect(mockSearchFiles).toHaveBeenCalledWith('test', {
      path: '/home',
      limit: 100,
      matchType: 'name',
    })
  })

  it('should cancel previous search on rapid input', async () => {
    mockSearchFiles.mockResolvedValue(createMockResponse())

    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home', debounceMs: 300 })
    )

    act(() => {
      result.current.setQuery('t')
    })

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    act(() => {
      result.current.setQuery('te')
    })

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    act(() => {
      result.current.setQuery('tes')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Only the last query should be searched
    expect(mockSearchFiles).toHaveBeenCalledTimes(1)
    expect(mockSearchFiles).toHaveBeenCalledWith('tes', expect.any(Object))
  })

  it('should not search with empty query', () => {
    mockSearchFiles.mockResolvedValue(createMockResponse())

    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home' })
    )

    act(() => {
      result.current.setQuery('   ')
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockSearchFiles).not.toHaveBeenCalled()
    expect(result.current.isSearching).toBe(false)
  })

  it('should update results after successful search', async () => {
    const mockResults: FileInfo[] = [
      { path: '/home/file1.txt', name: 'file1.txt', isDir: false, size: 100, modTime: '2024-01-01' },
      { path: '/home/file2.txt', name: 'file2.txt', isDir: false, size: 200, modTime: '2024-01-01' },
    ]
    mockSearchFiles.mockResolvedValue(createMockResponse(mockResults, 2))

    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home' })
    )

    await act(async () => {
      result.current.setQuery('file')
      vi.advanceTimersByTime(300)
      // Wait for the promise to resolve
      await vi.runAllTimersAsync()
    })

    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].name).toBe('file1.txt')
  })

  it('should handle search errors gracefully', async () => {
    mockSearchFiles.mockRejectedValue(new Error('Network error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home' })
    )

    await act(async () => {
      result.current.setQuery('test')
      vi.advanceTimersByTime(300)
      await vi.runAllTimersAsync()
    })

    expect(result.current.isSearching).toBe(false)
    expect(result.current.results).toEqual([])
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('should reset when path changes', () => {
    const { result, rerender } = renderHook(
      ({ path }) => useLocalSearch({ currentPath: path }),
      { initialProps: { path: '/home' } }
    )

    act(() => {
      result.current.openSearch()
      result.current.setQuery('test')
    })

    // Change path
    rerender({ path: '/other' })

    expect(result.current.query).toBe('')
    expect(result.current.results).toEqual([])
    expect(result.current.showSearch).toBe(false)
  })

  it('should respect custom limit', async () => {
    mockSearchFiles.mockResolvedValue(createMockResponse())

    const { result } = renderHook(() =>
      useLocalSearch({ currentPath: '/home', limit: 50 })
    )

    act(() => {
      result.current.setQuery('test')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(mockSearchFiles).toHaveBeenCalledWith('test', expect.objectContaining({
      limit: 50,
    }))
  })
})
