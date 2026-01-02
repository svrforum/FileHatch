import { useState, useCallback, useRef, useEffect } from 'react'
import { searchFiles, FileInfo } from '../api/files'

interface UseLocalSearchOptions {
  currentPath: string
  debounceMs?: number
  limit?: number
  disabled?: boolean
}

interface UseLocalSearchReturn {
  query: string
  results: FileInfo[]
  isSearching: boolean
  showSearch: boolean
  inputRef: React.RefObject<HTMLInputElement>
  setQuery: (query: string) => void
  openSearch: () => void
  closeSearch: () => void
  clearSearch: () => void
}

/**
 * Hook for managing local file search with debouncing
 */
export function useLocalSearch({
  currentPath,
  debounceMs = 300,
  limit = 100,
  disabled = false,
}: UseLocalSearchOptions): UseLocalSearchReturn {
  const [query, setQueryState] = useState('')
  const [results, setResults] = useState<FileInfo[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Clear search when path changes
  useEffect(() => {
    setQueryState('')
    setResults([])
    setShowSearch(false)
  }, [currentPath])

  // Handle Ctrl+F shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey) && !disabled) {
        e.preventDefault()
        setShowSearch(true)
        setTimeout(() => inputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape' && showSearch) {
        // Inline close logic to avoid dependency issues
        setShowSearch(false)
        setQueryState('')
        setResults([])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSearch, disabled])

  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery)

    // Clear existing timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!newQuery.trim()) {
      setResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)

    // Debounced search
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await searchFiles(newQuery, {
          path: currentPath,
          limit,
          matchType: 'name',
        })
        setResults(response.results)
      } catch (error) {
        console.error('Search failed:', error)
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, debounceMs)
  }, [currentPath, limit, debounceMs])

  const openSearch = useCallback(() => {
    setShowSearch(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const closeSearch = useCallback(() => {
    setShowSearch(false)
    setQueryState('')
    setResults([])
  }, [])

  const clearSearch = useCallback(() => {
    setQueryState('')
    setResults([])
  }, [])

  return {
    query,
    results,
    isSearching,
    showSearch,
    inputRef,
    setQuery,
    openSearch,
    closeSearch,
    clearSearch,
  }
}

export default useLocalSearch
