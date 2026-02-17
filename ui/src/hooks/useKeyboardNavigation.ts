// 파일 목록 키보드 네비게이션 훅
import { useEffect, useRef } from 'react'
import { FileInfo } from '../api/files'

interface UseKeyboardNavigationProps {
  displayFiles: FileInfo[]
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  selectedFile: FileInfo | null
  setSelectedFile: (file: FileInfo | null) => void
  selectedFiles: Set<string>
  setSelectedFiles: (files: Set<string>) => void
  viewMode: 'list' | 'grid'
  containerRef: React.RefObject<HTMLDivElement | null>
  fileRowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  // Modal states for ESC handling
  modalsOpen: boolean
  // Navigation
  canGoBack: boolean
  onGoBack: () => void
  // Handlers
  onDoubleClick: (file: FileInfo) => void
  onDelete: (file: FileInfo) => void
  onBulkDelete: () => void
  onRename: (file: FileInfo) => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onUndo: () => void
  onRedo: () => void
}

export function useKeyboardNavigation({
  displayFiles,
  focusedIndex,
  setFocusedIndex,
  selectedFile,
  setSelectedFile,
  selectedFiles,
  setSelectedFiles,
  viewMode,
  containerRef,
  fileRowRefs,
  modalsOpen,
  canGoBack,
  onGoBack,
  onDoubleClick,
  onDelete,
  onBulkDelete,
  onRename,
  onCopy,
  onCut,
  onPaste,
  onUndo,
  onRedo,
}: UseKeyboardNavigationProps) {
  // Type-ahead search state
  const searchBuffer = useRef('')
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Shift+Arrow multi-select anchor
  const selectionAnchorRef = useRef<number>(-1)

  // Type-ahead search handler
  useEffect(() => {
    const handleTypeAhead = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length !== 1) return

      const pressedKey = e.key.toLowerCase()

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }

      searchTimeoutRef.current = setTimeout(() => {
        searchBuffer.current = ''
      }, 500)

      if (displayFiles.length > 0) {
        const isSameChar = searchBuffer.current.length === 1 && pressedKey === searchBuffer.current
        const accumulatedBuffer = isSameChar ? pressedKey : searchBuffer.current + pressedKey

        const getMatchingIndices = (searchStr: string) => {
          const indices: number[] = []
          displayFiles.forEach((file, index) => {
            if (file.name.toLowerCase().startsWith(searchStr)) {
              indices.push(index)
            }
          })
          return indices
        }

        let matchingIndices = getMatchingIndices(accumulatedBuffer)
        let useBuffer = accumulatedBuffer

        if (matchingIndices.length === 0 && accumulatedBuffer.length > 1) {
          matchingIndices = getMatchingIndices(pressedKey)
          useBuffer = pressedKey
        }

        searchBuffer.current = useBuffer

        if (matchingIndices.length > 0) {
          let targetIndex: number

          if (isSameChar && matchingIndices.length > 1) {
            const currentIndex = matchingIndices.indexOf(focusedIndex)
            if (currentIndex >= 0 && currentIndex < matchingIndices.length - 1) {
              targetIndex = matchingIndices[currentIndex + 1]
            } else {
              targetIndex = matchingIndices[0]
            }
          } else {
            targetIndex = matchingIndices[0]
          }

          const file = displayFiles[targetIndex]
          setSelectedFile(file)
          setSelectedFiles(new Set([file.path]))
          setFocusedIndex(targetIndex)
          const fileEl = fileRowRefs.current.get(file.path)
          fileEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      }
    }

    document.addEventListener('keydown', handleTypeAhead)
    return () => document.removeEventListener('keydown', handleTypeAhead)
  }, [displayFiles, focusedIndex, setFocusedIndex, setSelectedFile, setSelectedFiles, fileRowRefs])

  // Navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const files = displayFiles || []

      // Handle Ctrl/Meta modifier shortcuts first — these must work even in empty folders
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 'a':
            if (files.length > 0) {
              e.preventDefault()
              setSelectedFiles(new Set(files.map(f => f.path)))
            }
            return
          case 'c':
            e.preventDefault()
            onCopy()
            return
          case 'x':
            e.preventDefault()
            onCut()
            return
          case 'v':
            e.preventDefault()
            onPaste()
            return
          case 'z':
            e.preventDefault()
            onUndo()
            return
          case 'y':
            e.preventDefault()
            onRedo()
            return
        }
      }

      // Escape works even in empty folders
      if (e.key === 'Escape') {
        if (!modalsOpen) {
          setSelectedFile(null)
          setSelectedFiles(new Set())
          setFocusedIndex(-1)
          selectionAnchorRef.current = -1
        }
        return
      }

      // Remaining navigation keys require files
      if (files.length === 0) return

      const getGridColumns = () => {
        const gridElement = containerRef.current?.querySelector('.file-grid') as HTMLElement
        if (!gridElement) return 1
        const gridStyle = window.getComputedStyle(gridElement)
        const columnsStr = gridStyle.getPropertyValue('grid-template-columns')
        const columns = columnsStr.split(' ').filter(s => s.trim() !== '').length
        if (columns <= 1) {
          const firstCard = gridElement.querySelector('.file-card') as HTMLElement
          if (firstCard) {
            const cardWidth = firstCard.offsetWidth + 16
            const gridWidth = gridElement.clientWidth
            return Math.max(1, Math.floor(gridWidth / cardWidth))
          }
        }
        return columns || 1
      }

      const navigateTo = (newIndex: number, shiftKey: boolean = false) => {
        if (newIndex < 0 || newIndex >= files.length) return
        setFocusedIndex(newIndex)
        if (shiftKey) {
          const anchor = selectionAnchorRef.current >= 0
            ? selectionAnchorRef.current : focusedIndex
          if (selectionAnchorRef.current < 0) selectionAnchorRef.current = focusedIndex
          const start = Math.min(anchor, newIndex)
          const end = Math.max(anchor, newIndex)
          const newSet = new Set<string>()
          for (let i = start; i <= end; i++) newSet.add(files[i].path)
          setSelectedFiles(newSet)
        } else {
          selectionAnchorRef.current = newIndex
          setSelectedFile(files[newIndex])
          setSelectedFiles(new Set([files[newIndex].path]))
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          if (viewMode === 'grid') {
            const cols = getGridColumns()
            navigateTo(Math.min(focusedIndex + cols, files.length - 1), e.shiftKey)
          } else {
            navigateTo(Math.min(focusedIndex + 1, files.length - 1), e.shiftKey)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (viewMode === 'grid') {
            const cols = getGridColumns()
            navigateTo(Math.max(focusedIndex - cols, 0), e.shiftKey)
          } else {
            navigateTo(Math.max(focusedIndex - 1, 0), e.shiftKey)
          }
          break
        case 'ArrowLeft':
          if (viewMode === 'grid') {
            e.preventDefault()
            navigateTo(Math.max(focusedIndex - 1, 0), e.shiftKey)
          }
          break
        case 'ArrowRight':
          if (viewMode === 'grid') {
            e.preventDefault()
            navigateTo(Math.min(focusedIndex + 1, files.length - 1), e.shiftKey)
          }
          break
        case 'Enter':
          if (modalsOpen) return
          e.preventDefault()
          if (focusedIndex >= 0 && focusedIndex < files.length) {
            onDoubleClick(files[focusedIndex])
          }
          break
        case 'Delete':
          if (modalsOpen) return
          e.preventDefault()
          if (selectedFiles.size > 0) {
            const filesToDelete = files.filter(f => selectedFiles.has(f.path))
            if (filesToDelete.length === 1) {
              onDelete(filesToDelete[0])
            } else if (filesToDelete.length > 1) {
              onBulkDelete()
            }
          } else if (selectedFile) {
            onDelete(selectedFile)
          }
          break
        case 'Backspace':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            if (selectedFiles.size > 0) {
              const filesToDelete = files.filter(f => selectedFiles.has(f.path))
              if (filesToDelete.length === 1) {
                onDelete(filesToDelete[0])
              } else if (filesToDelete.length > 1) {
                onBulkDelete()
              }
            } else if (selectedFile) {
              onDelete(selectedFile)
            }
          } else if (canGoBack) {
            e.preventDefault()
            onGoBack()
          }
          break
        case 'F2':
          e.preventDefault()
          if (selectedFile) {
            onRename(selectedFile)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    displayFiles, focusedIndex, selectedFile, selectedFiles, viewMode,
    containerRef, modalsOpen, canGoBack,
    setFocusedIndex, setSelectedFile, setSelectedFiles,
    onDoubleClick, onDelete, onBulkDelete, onRename,
    onCopy, onCut, onPaste, onUndo, onRedo, onGoBack
  ])
}
