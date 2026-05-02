import { useCallback, useEffect, useRef, useState } from 'react'
import { createEditor, type RhwpEditor as RhwpEditorInstance } from '@rhwp/editor'
import { getFileUrl, getAuthToken, saveBinaryFileContent } from '../api/files'
import './RhwpEditor.css'

interface RhwpEditorProps {
  filePath: string
  fileName: string
  studioUrl: string
  readOnly?: boolean
  onClose: () => void
  onError?: (message: string) => void
  onSaved?: () => void
}

type LoadState = 'loading' | 'ready' | 'error'

function RhwpEditor({
  filePath,
  fileName,
  studioUrl,
  readOnly = false,
  onClose,
  onError,
  onSaved,
}: RhwpEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<RhwpEditorInstance | null>(null)
  const isMountedRef = useRef(true)

  // 콜백을 ref 로 보관해 useEffect 재실행 방지
  const onErrorRef = useRef(onError)
  const onSavedRef = useRef(onSaved)
  onErrorRef.current = onError
  onSavedRef.current = onSaved

  // 에디터 마운트 + 파일 로드
  useEffect(() => {
    isMountedRef.current = true

    const initAndLoad = async () => {
      if (!containerRef.current) return

      try {
        const editor = await createEditor(containerRef.current, {
          studioUrl,
          width: '100%',
          height: '100%',
        })
        if (!isMountedRef.current) {
          editor.destroy()
          return
        }
        editorRef.current = editor

        // 인증된 다운로드 → ArrayBuffer
        const token = getAuthToken()
        const fileUrl = getFileUrl(filePath)
        const resp = await fetch(fileUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!resp.ok) {
          throw new Error(`파일 다운로드 실패: HTTP ${resp.status}`)
        }
        const buffer = await resp.arrayBuffer()
        if (!isMountedRef.current) return

        const result = await editor.loadFile(buffer, fileName)
        if (!isMountedRef.current) return

        setPageCount(result.pageCount)
        setLoadState('ready')
      } catch (err) {
        if (!isMountedRef.current) return
        const msg = err instanceof Error ? err.message : '에디터 로드 실패'
        setErrorMsg(msg)
        setLoadState('error')
        onErrorRef.current?.(msg)
      }
    }

    initAndLoad()

    return () => {
      isMountedRef.current = false
      if (editorRef.current) {
        try {
          editorRef.current.destroy()
        } catch {
          // 무시
        }
        editorRef.current = null
      }
    }
  }, [filePath, fileName, studioUrl])

  // 저장 핸들러
  const handleSave = useCallback(async () => {
    if (!editorRef.current || isSaving || readOnly) return
    setIsSaving(true)
    try {
      const bytes = await editorRef.current.exportHwp()
      const ext = fileName.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'
      const mime = ext === 'hwpx' ? 'application/vnd.hancom.hwpx' : 'application/x-hwp'
      await saveBinaryFileContent(filePath, bytes, mime)
      onSavedRef.current?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장 실패'
      setErrorMsg(msg)
      onErrorRef.current?.(msg)
    } finally {
      setIsSaving(false)
    }
  }, [filePath, fileName, isSaving, readOnly])

  // Ctrl+S / ESC 키바인딩 (Task 5 통합)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!readOnly) handleSave()
      }
      if (e.key === 'Escape') {
        // rhwp 가 변경 이벤트를 노출하지 않으므로 편집 모드에선 항상 확인
        if (!readOnly && loadState === 'ready') {
          if (confirm('편집 내용이 저장되지 않았을 수 있습니다. 닫으시겠습니까?')) {
            onClose()
          }
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, loadState, onClose, readOnly])

  return (
    <div className="rhwp-overlay">
      <div className="rhwp-container">
        <div className="rhwp-header">
          <span className="rhwp-title">{fileName}</span>
          {pageCount !== null && (
            <span className="rhwp-meta">{pageCount}페이지</span>
          )}
          <span className="rhwp-beta-badge">베타</span>
          <div className="rhwp-actions">
            {!readOnly && (
              <button
                className="rhwp-btn-save"
                onClick={handleSave}
                disabled={isSaving || loadState !== 'ready'}
              >
                {isSaving ? '저장 중...' : '저장 (Ctrl+S)'}
              </button>
            )}
            <button className="rhwp-btn-close" onClick={onClose} aria-label="닫기">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="rhwp-body">
          {loadState === 'loading' && (
            <div className="rhwp-loading">
              <div className="rhwp-spinner" />
              <p>한글 문서 로딩 중...</p>
            </div>
          )}
          {loadState === 'error' && (
            <div className="rhwp-error">
              <p>{errorMsg ?? '알 수 없는 오류'}</p>
              <button onClick={onClose}>닫기</button>
            </div>
          )}
          <div
            ref={containerRef}
            className="rhwp-iframe-wrap"
            style={{ display: loadState === 'ready' ? 'block' : 'none' }}
          />
        </div>
      </div>
    </div>
  )
}

export default RhwpEditor
