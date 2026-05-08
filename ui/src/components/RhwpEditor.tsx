import { useCallback, useEffect, useRef, useState } from 'react'
import { getFileUrl, getAuthToken, saveBinaryFileContent } from '../api/files'
import './RhwpEditor.css'

// rhwp-studio 와 통신 전략 (rhwp v0.7.10+ 전제):
//
// 1. upstream PR #581 fix 로 'ready' 응답이 wasm.initialize() 완료를 보장.
//    재시도 / wbindgen race 회피 코드는 v0.15.0 에서 제거됨.
// 2. ?url= query 방식은 외부 CDN(edwardkim.github.io HTTPS) → LAN(localhost HTTP)
//    의 cross-origin fetch 가 Chrome Private Network Access 정책으로 차단된다.
//    → 부모(우리)가 same-origin fetch 후 postMessage 로 buffer 전달 (PNA 회피).

interface RhwpEditorProps {
  filePath: string
  fileName: string
  studioUrl: string
  readOnly?: boolean
  /** shared folder 등 권한 제어 — false 면 저장 버튼 미표시 (기본 true) */
  hasWritePermission?: boolean
  onClose: () => void
  onError?: (message: string) => void
  onSaved?: () => void
  /** 사용자가 에러 화면의 [다운로드] 버튼 클릭 시 호출 (자동 호출 아님) */
  onDownload?: () => void
  /** 테스트 전용 — ready polling deadline (기본 30000ms) */
  readyTimeoutMs?: number
  /** 테스트 전용 — ready polling 간격 (기본 300ms) */
  readyPollIntervalMs?: number
}

interface RhwpResponse {
  type: 'rhwp-response'
  id: number
  result?: unknown
  error?: string
}

let requestIdCounter = 0

type LoadState = 'loading' | 'ready' | 'error'

function humanizeError(raw: string): string {
  if (raw.includes('HTTP 401') || raw.includes('HTTP 403')) {
    return '파일에 접근할 권한이 없습니다.'
  }
  if (raw.includes('HTTP 404')) {
    return '파일을 찾을 수 없습니다.'
  }
  if (/HTTP 5\d\d/.test(raw)) {
    return '서버에서 파일을 가져오는 중 오류가 발생했습니다.'
  }
  if (raw.includes('Request timeout: ready')) {
    return '한글 뷰어가 응답하지 않습니다. 브라우저를 새로고침해 주세요.'
  }
  if (raw.includes('Request timeout: loadFile')) {
    return '한글 문서 처리 시간이 초과되었습니다.'
  }
  return raw || '한글 문서를 처리할 수 없습니다.'
}

function RhwpEditor({
  filePath,
  fileName,
  studioUrl,
  readOnly = false,
  hasWritePermission = true,
  onClose,
  onError,
  onSaved,
  onDownload,
  readyTimeoutMs = 30000,
  readyPollIntervalMs = 300,
}: RhwpEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('rhwp-studio 로딩 중...')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef(
    new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
  )
  const isMountedRef = useRef(true)

  const onErrorRef = useRef(onError)
  const onSavedRef = useRef(onSaved)
  onErrorRef.current = onError
  onSavedRef.current = onSaved

  // postMessage 응답 라우터
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as RhwpResponse | undefined
      if (data?.type !== 'rhwp-response' || data.id == null) return
      const resolver = pendingRef.current.get(data.id)
      if (!resolver) return
      pendingRef.current.delete(data.id)
      if (data.error) resolver.reject(new Error(data.error))
      else resolver.resolve(data.result)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // iframe 으로 요청 → 응답 promise
  const sendRequest = useCallback(
    <T,>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const id = ++requestIdCounter
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        pendingRef.current.set(id, {
          resolve: (v) => {
            if (timeoutHandle !== null) clearTimeout(timeoutHandle)
            resolve(v as T)
          },
          reject: (e) => {
            if (timeoutHandle !== null) clearTimeout(timeoutHandle)
            reject(e)
          },
        })
        const cw = iframeRef.current?.contentWindow
        if (!cw) {
          pendingRef.current.delete(id)
          reject(new Error('iframe 미준비'))
          return
        }
        cw.postMessage({ type: 'rhwp-request', id, method, params }, '*')
        timeoutHandle = setTimeout(() => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id)
            reject(new Error(`Request timeout: ${method}`))
          }
        }, timeoutMs)
      })
    },
    [],
  )

  // 메인 흐름: iframe load → ready polling → 인증 fetch → loadFile 단발
  //
  // ready 단계는 polling 이 필요하다. 이유: `iframe.load` 이벤트는 HTML/자산
  // 로드 완료 시점에 fire 되지만 그 시점에는 rhwp-studio 의 message 핸들러가
  // 아직 등록되지 않았다 (JS 가 실행되어야 등록됨). 이 미스매치 때문에 단발
  // ping 은 응답을 못 받는다. 짧은 timeout 으로 polling 하면 핸들러 등록
  // 직후에 응답을 받을 수 있다.
  //
  // upstream rhwp v0.7.10 의 race fix 는 별개 — 'ready' 응답이 wasm.initialize()
  // 완료를 보장한다. 우리가 polling 으로 보장하는 건 "핸들러 자체의 등록".
  // 즉, polling 으로 핸들러 reachability + 핸들러가 wasm 준비 보장 = 안전.
  //
  // hasRun: 한 마운트에서 두 번 이상 run() 호출되지 않도록. iframe.load 가
  // 폰트/SW 등으로 여러 번 fire 되어도 한 번만 실행.
  useEffect(() => {
    isMountedRef.current = true
    let hasRun = false

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms))

    const pollReady = async (deadlineMs: number, pollIntervalMs: number) => {
      const deadline = Date.now() + deadlineMs
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return
        try {
          const r = await sendRequest<boolean>('ready', {}, 1000)
          if (r === true) return
        } catch {
          // 아직 응답 안 함 (handler 미등록) — 잠시 대기 후 재시도
        }
        await sleep(pollIntervalMs)
      }
      throw new Error('Request timeout: ready')
    }

    const run = async () => {
      try {
        // 1) ready polling — 핸들러 등록까지 1s 단위 ping (deadline 30s)
        setStatusMsg('rhwp-studio 로딩 중...')
        await pollReady(readyTimeoutMs, readyPollIntervalMs)
        if (!isMountedRef.current) return

        // 2) 인증된 same-origin fetch → ArrayBuffer (PNA 회피)
        setStatusMsg('파일 다운로드 중...')
        const token = getAuthToken()
        const fileUrl = getFileUrl(filePath)
        const resp = await fetch(fileUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!resp.ok) throw new Error(`파일 다운로드 실패: HTTP ${resp.status}`)
        const buffer = await resp.arrayBuffer()
        if (!isMountedRef.current) return

        // 3) loadFile 단발 (재시도 없음)
        setStatusMsg('한글 문서 로드 중...')
        const bytes = Array.from(new Uint8Array(buffer))
        const result = await sendRequest<{ pageCount: number }>(
          'loadFile',
          { data: bytes, fileName },
          15000,
        )
        if (!isMountedRef.current) return

        setPageCount(result?.pageCount ?? null)
        setLoadState('ready')
      } catch (err) {
        if (!isMountedRef.current) return
        const raw = err instanceof Error ? err.message : '에디터 로드 실패'
        const friendly = humanizeError(raw)
        setErrorMsg(friendly)
        setLoadState('error')
        onErrorRef.current?.(friendly)
        // 자동 다운로드 fallback 제거 — 사용자가 에러 화면의 [다운로드] 버튼 클릭 시에만
      }
    }

    const iframe = iframeRef.current
    if (!iframe) return

    const onIframeLoad = () => {
      if (!isMountedRef.current || hasRun) return
      hasRun = true
      run()
    }
    iframe.addEventListener('load', onIframeLoad)

    if (iframe.contentWindow && iframe.contentDocument?.readyState === 'complete') {
      onIframeLoad()
    }

    return () => {
      isMountedRef.current = false
      iframe.removeEventListener('load', onIframeLoad)
      pendingRef.current.clear()
    }
  }, [filePath, fileName, studioUrl, sendRequest, readyTimeoutMs, readyPollIntervalMs])

  const showSaveButton = !readOnly && hasWritePermission

  // 저장 핸들러
  const handleSave = useCallback(async () => {
    if (isSaving || !showSaveButton || loadState !== 'ready') return
    setIsSaving(true)
    try {
      const result = await sendRequest<number[] | Uint8Array>('exportHwp', {}, 30000)
      const bytes = result instanceof Uint8Array ? result : new Uint8Array(result || [])
      const ext = fileName.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'
      const mime = ext === 'hwpx' ? 'application/vnd.hancom.hwpx' : 'application/x-hwp'
      await saveBinaryFileContent(filePath, bytes, mime)
      onSavedRef.current?.()
    } catch (err) {
      const raw = err instanceof Error ? err.message : '저장 실패'
      const friendly = humanizeError(raw)
      setErrorMsg(friendly)
      onErrorRef.current?.(friendly)
    } finally {
      setIsSaving(false)
    }
  }, [filePath, fileName, isSaving, showSaveButton, loadState, sendRequest])

  // Ctrl+S / ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (showSaveButton) handleSave()
      }
      if (e.key === 'Escape') {
        if (showSaveButton && loadState === 'ready') {
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
  }, [handleSave, loadState, onClose, showSaveButton])

  const handleDownload = useCallback(() => {
    onDownload?.()
    onClose()
  }, [onDownload, onClose])

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
            {showSaveButton && (
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
              <p>{statusMsg}</p>
            </div>
          )}
          {loadState === 'error' && (
            <div className="rhwp-error">
              <p className="rhwp-error-title">한글 문서를 열 수 없습니다.</p>
              <p className="rhwp-error-detail">{errorMsg}</p>
              <div className="rhwp-error-actions">
                {onDownload && (
                  <button className="rhwp-btn-save" onClick={handleDownload}>
                    다운로드
                  </button>
                )}
                <button className="rhwp-btn-cancel" onClick={onClose}>
                  닫기
                </button>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            className="rhwp-iframe"
            src={new URL(studioUrl, window.location.origin).href}
            allow="clipboard-read; clipboard-write"
            title={fileName}
            style={{ display: loadState === 'ready' ? 'block' : 'none' }}
          />
        </div>
      </div>
    </div>
  )
}

export default RhwpEditor
