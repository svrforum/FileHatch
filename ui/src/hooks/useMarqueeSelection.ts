// 마키(드래그) 선택 훅
import { useState, useCallback } from 'react'
import { FileInfo } from '../api/files'

interface UseMarqueeSelectionProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  fileRowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  displayFiles: FileInfo[]
  setSelectedFiles: (files: Set<string>) => void
  setSelectedFile: (file: FileInfo | null) => void
}

interface MarqueeState {
  isSelecting: boolean
  start: { x: number; y: number } | null
  end: { x: number; y: number } | null
}

export function useMarqueeSelection({
  containerRef,
  fileRowRefs,
  displayFiles,
  setSelectedFiles,
  setSelectedFile,
}: UseMarqueeSelectionProps) {
  const [marqueeState, setMarqueeState] = useState<MarqueeState>({
    isSelecting: false,
    start: null,
    end: null,
  })

  const handleMarqueeStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.file-row, .file-card, .multi-select-bar, .context-menu, .modal')) return
    if (e.button !== 0) return

    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left + container.scrollLeft
    const y = e.clientY - rect.top + container.scrollTop

    setMarqueeState({
      isSelecting: true,
      start: { x, y },
      end: { x, y },
    })

    if (!e.ctrlKey && !e.metaKey) {
      setSelectedFiles(new Set())
      setSelectedFile(null)
    }
  }, [containerRef, setSelectedFiles, setSelectedFile])

  const handleMarqueeMove = useCallback((e: React.MouseEvent) => {
    if (!marqueeState.isSelecting || !marqueeState.start) return

    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left + container.scrollLeft
    const y = e.clientY - rect.top + container.scrollTop

    setMarqueeState(prev => ({ ...prev, end: { x, y } }))

    const minX = Math.min(marqueeState.start.x, x)
    const maxX = Math.max(marqueeState.start.x, x)
    const minY = Math.min(marqueeState.start.y, y)
    const maxY = Math.max(marqueeState.start.y, y)

    const newSelection = new Set<string>()
    fileRowRefs.current.forEach((element, path) => {
      const elemRect = element.getBoundingClientRect()
      const elemLeft = elemRect.left - rect.left + container.scrollLeft
      const elemTop = elemRect.top - rect.top + container.scrollTop
      const elemRight = elemLeft + elemRect.width
      const elemBottom = elemTop + elemRect.height

      if (!(elemRight < minX || elemLeft > maxX || elemBottom < minY || elemTop > maxY)) {
        newSelection.add(path)
      }
    })

    setSelectedFiles(newSelection)
    if (newSelection.size > 0) {
      const firstPath = Array.from(newSelection)[0]
      const file = displayFiles.find(f => f.path === firstPath)
      if (file) setSelectedFile(file)
    }
  }, [marqueeState.isSelecting, marqueeState.start, containerRef, fileRowRefs, displayFiles, setSelectedFiles, setSelectedFile])

  const handleMarqueeEnd = useCallback(() => {
    setMarqueeState({
      isSelecting: false,
      start: null,
      end: null,
    })
  }, [])

  const marqueeStyle = marqueeState.start && marqueeState.end ? {
    left: Math.min(marqueeState.start.x, marqueeState.end.x),
    top: Math.min(marqueeState.start.y, marqueeState.end.y),
    width: Math.abs(marqueeState.end.x - marqueeState.start.x),
    height: Math.abs(marqueeState.end.y - marqueeState.start.y),
  } : null

  return {
    isMarqueeSelecting: marqueeState.isSelecting,
    marqueeStyle,
    handleMarqueeStart,
    handleMarqueeMove,
    handleMarqueeEnd,
  }
}
