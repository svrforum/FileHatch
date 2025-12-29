// 파일 작업 히스토리 훅 (실행취소/다시실행)
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { renameItem, copyItem, moveItem, moveToTrash } from '../api/files'
import { HistoryAction } from '../components/filelist/types'

type ToastType = 'success' | 'error' | 'info'

interface UseFileHistoryProps {
  addToast: (message: string, type: ToastType) => void
}

export function useFileHistory({ addToast }: UseFileHistoryProps) {
  const queryClient = useQueryClient()
  const [historyState, setHistoryState] = useState<{
    actions: HistoryAction[]
    index: number
  }>({ actions: [], index: -1 })

  const addToHistory = useCallback((action: HistoryAction) => {
    setHistoryState(prev => ({
      actions: [...prev.actions.slice(0, prev.index + 1), action],
      index: prev.index + 1
    }))
  }, [])

  const handleUndo = useCallback(async () => {
    if (historyState.index < 0 || historyState.actions.length === 0) {
      addToast('실행취소할 작업이 없습니다', 'info')
      return
    }

    const action = historyState.actions[historyState.index]
    try {
      switch (action.type) {
        case 'move':
          if (action.destPaths && action.destPaths.length > 0) {
            for (let i = 0; i < action.destPaths.length; i++) {
              const destPath = action.destPaths[i]
              const originalDir = action.sourcePaths[i].split('/').slice(0, -1).join('/')
              await moveItem(destPath, originalDir)
            }
          }
          break
        case 'rename':
          if (action.oldName && action.newName && action.destPaths?.[0]) {
            await renameItem(action.destPaths[0], action.oldName)
          }
          break
        case 'delete':
          addToast('삭제는 휴지통에서 복원해주세요', 'info')
          return
        case 'copy':
          if (action.destPaths && action.destPaths.length > 0) {
            for (const destPath of action.destPaths) {
              await moveToTrash(destPath)
            }
          }
          break
      }

      setHistoryState(prev => ({ ...prev, index: prev.index - 1 }))
      queryClient.invalidateQueries({ queryKey: ['files'] })
      addToast('실행취소되었습니다', 'success')
    } catch {
      addToast('실행취소에 실패했습니다', 'error')
    }
  }, [historyState, queryClient, addToast])

  const handleRedo = useCallback(async () => {
    if (historyState.index >= historyState.actions.length - 1) {
      addToast('다시실행할 작업이 없습니다', 'info')
      return
    }

    const action = historyState.actions[historyState.index + 1]
    try {
      switch (action.type) {
        case 'move':
          if (action.destination) {
            for (const sourcePath of action.sourcePaths) {
              await moveItem(sourcePath, action.destination)
            }
          }
          break
        case 'rename':
          if (action.oldName && action.newName && action.sourcePaths[0]) {
            await renameItem(action.sourcePaths[0], action.newName)
          }
          break
        case 'copy':
          if (action.destination) {
            for (const sourcePath of action.sourcePaths) {
              await copyItem(sourcePath, action.destination)
            }
          }
          break
        case 'delete':
          addToast('삭제는 다시실행할 수 없습니다', 'info')
          return
      }

      setHistoryState(prev => ({ ...prev, index: prev.index + 1 }))
      queryClient.invalidateQueries({ queryKey: ['files'] })
      addToast('다시실행되었습니다', 'success')
    } catch {
      addToast('다시실행에 실패했습니다', 'error')
    }
  }, [historyState, queryClient, addToast])

  return {
    historyState,
    addToHistory,
    handleUndo,
    handleRedo,
  }
}
