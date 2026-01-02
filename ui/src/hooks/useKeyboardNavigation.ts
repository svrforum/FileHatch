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

      const navigateTo = (newIndex: number) => {
        if (newIndex >= 0 && newIndex < files.length) {
          setFocusedIndex(newIndex)
          setSelectedFile(files[newIndex])
          setSelectedFiles(new Set([files[newIndex].path]))
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          if (viewMode === 'grid') {
            const cols = getGridColumns()
            navigateTo(Math.min(focusedIndex + cols, files.length - 1))
          } else {
            navigateTo(Math.min(focusedIndex + 1, files.length - 1))
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (viewMode === 'grid') {
            const cols = getGridColumns()
            navigateTo(Math.max(focusedIndex - cols, 0))
          } else {
            navigateTo(Math.max(focusedIndex - 1, 0))
          }
          break
        case 'ArrowLeft':
          if (viewMode === 'grid') {
            e.preventDefault()
            navigateTo(Math.max(focusedIndex - 1, 0))
          }
          break
        case 'ArrowRight':
          if (viewMode === 'grid') {
            e.preventDefault()
            navigateTo(Math.min(focusedIndex + 1, files.length - 1))
          }
          break
        case 'Enter':
          // Don't handle Enter when a modal is open (modal handles its own Enter)
          if (modalsOpen) return
          e.preventDefault()
          if (focusedIndex >= 0 && focusedIndex < files.length) {
            onDoubleClick(files[focusedIndex])
          }
          break
        case 'Delete':
          // Don't handle Delete when a modal is open
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
          // Cmd/Ctrl+Backspace: Delete files
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
            // Plain Backspace: Go to parent folder
            e.preventDefault()
            onGoBack()
          }
          break
        case 'Escape':
          if (!modalsOpen) {
            setSelectedFile(null)
            setSelectedFiles(new Set())
            setFocusedIndex(-1)
          }
          break
        case 'a':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            setSelectedFiles(new Set(files.map(f => f.path)))
          }
          break
        case 'c':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onCopy()
          }
          break
        case 'x':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onCut()
          }
          break
        case 'v':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onPaste()
          }
          break
        case 'F2':
          e.preventDefault()
          if (selectedFile) {
            onRename(selectedFile)
          }
          break
        case 'z':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onUndo()
          }
          break
        case 'y':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onRedo()
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
