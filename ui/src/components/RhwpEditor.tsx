import { useCallback, useEffect, useRef, useState } from 'react'
import { getFileUrl, getAuthToken, saveBinaryFileContent } from '../api/files'
import './RhwpEditor.css'

// rhwp-studio 와 통신 전략 (rhwp v0.7.x 한계 회피):
//
// 1. rhwp-studio 의 message 핸들러는 wasm.initialize() 완료 전에 등록되어
//    'ready' ping 은 즉시 true 응답하지만 'loadFile' 은 wasm 미초기화 상태로
//    호출 시 __wbindgen_malloc undefined 또는 timeout 으로 실패한다.
//    → 'pageCount' probe 로 wasm 준비 완료를 polling 한다 (정상 응답하면 ready).
//
// 2. ?url= query 방식은 외부 CDN(edwardkim.github.io HTTPS) → LAN(localhost HTTP)
//    의 cross-origin fetch 가 Chrome Private Network Access 정책으로 차단된다.
//    → 부모(우리)가 same-origin fetch 후 postMessage 로 buffer 전달 (PNA 회피).

interface RhwpEditorProps {
  filePath: string
  fileName: string
  studioUrl: string
  readOnly?: boolean
  onClose: () => void
  onError?: (message: string) => void
  onSaved?: () => void
  /** 로드 실패 시 호출되는 fallback (보통 다운로드로 전환) */
  onFallbackDownload?: () => void
  /** 테스트 전용 — wasm readiness polling 간격 (기본 500ms) */
  readyPollIntervalMs?: number
  /** 테스트 전용 — wasm readiness 최대 대기 시간 (기본 60초) */
  readyTimeoutMs?: number
}

interface RhwpResponse {
  type: 'rhwp-response'
  id: number
  result?: unknown
  error?: string
}

let requestIdCounter = 0

type LoadState = 'loading' | 'ready' | 'error'

function RhwpEditor({
  filePath,
  fileName,
  studioUrl,
  readOnly = false,
  onClose,
  onError,
  onSaved,
  onFallbackDownload,
  readyPollIntervalMs = 500,
  readyTimeoutMs = 60000,
}: RhwpEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('한글 문서 로딩 준비 중...')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef(
    new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
  )
  const isMountedRef = useRef(true)

  const onErrorRef = useRef(onError)
  const onSavedRef = useRef(onSaved)
  const onFallbackRef = useRef(onFallbackDownload)
  onErrorRef.current = onError
  onSavedRef.current = onSaved
  onFallbackRef.current = onFallbackDownload

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
        pendingRef.current.set(id, {
          resolve: (v) => resolve(v as T),
          reject,
        })
        const cw = iframeRef.current?.contentWindow
        if (!cw) {
          pendingRef.current.delete(id)
          reject(new Error('iframe 미준비'))
          return
        }
        cw.postMessage({ type: 'rhwp-request', id, method, params }, '*')
        setTimeout(() => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id)
            reject(new Error(`Request timeout: ${method}`))
          }
        }, timeoutMs)
      })
    },
    [],
  )

  // 메인 흐름: iframe 로드 → wasm 준비 polling → 인증 다운로드 → loadFile
  useEffect(() => {
    isMountedRef.current = true

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms))

    // wbindgen race 에러인지 — wasm 미초기화 신호
    const isWbindgenRace = (msg: string): boolean =>
      msg.includes('__wbindgen_malloc') ||
      msg.includes('Request timeout') ||
      msg.includes('wasm') ||
      (msg.includes('undefined') && msg.includes('reading'))

    // loadFile 을 실제로 시도하면서 wbindgen race 면 재시도, 다른 에러면 즉시 throw.
    // pageCount 같은 단순 getter 는 미초기화 상태에서도 0 을 반환할 수 있어 probe 로 부적절.
    // 실제 loadFile path 가 wasm-bindgen FFI 를 통과하므로 가장 확실한 readiness 검증.
    const tryLoadFileWithRetry = async (
      bytes: number[],
    ): Promise<{ pageCount: number }> => {
      const deadline = Date.now() + readyTimeoutMs
      let attempt = 0
      let lastErr: Error | null = null
      while (Date.now() < deadline) {
        if (!isMountedRef.current) throw new Error('cancelled')
        attempt++
        if (attempt > 1) {
          setStatusMsg(`한글 엔진 초기화 중... (재시도 ${attempt})`)
        }
        try {
          return await sendRequest<{ pageCount: number }>(
            'loadFile',
            { data: bytes, fileName },
            12000,
          )
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e))
          lastErr = err
          if (!isWbindgenRace(err.message)) throw err
          // wasm 미초기화로 인한 race — 잠시 대기 후 재시도
          await sleep(readyPollIntervalMs * Math.min(attempt, 6))
        }
      }
      throw lastErr ?? new Error('한글 엔진 초기화 시간 초과')
    }

    const run = async () => {
      try {
        // 1) iframe 의 'ready' ping (handler 등록 여부 확인 — wasm 과는 무관)
        // iframe load 이벤트 후 즉시 시작. _waitReady 와 유사하지만 더 빨리 진입.
        setStatusMsg('rhwp-studio 로딩 중...')
        const readyDeadline = Date.now() + 30000
        let pingOk = false
        while (Date.now() < readyDeadline) {
          if (!isMountedRef.current) return
          try {
            const r = await sendRequest<boolean>('ready', {}, 1000)
            if (r === true) {
              pingOk = true
              break
            }
          } catch {
            // 아직 응답 안 함 — iframe 로딩 중
          }
          await sleep(300)
        }
        if (!pingOk) throw new Error('rhwp-studio 가 응답하지 않습니다.')

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

        // 3) loadFile 직접 시도 + wbindgen race 시 retry 로 wasm 초기화 대기
        setStatusMsg('한글 문서 로드 중...')
        const bytes = Array.from(new Uint8Array(buffer))
        const result = await tryLoadFileWithRetry(bytes)
        if (!isMountedRef.current) return

        setPageCount(result?.pageCount ?? null)
        setLoadState('ready')
      } catch (err) {
        if (!isMountedRef.current) return
        const msg = err instanceof Error ? err.message : '에디터 로드 실패'
        setErrorMsg(msg)
        setLoadState('error')
        onErrorRef.current?.(msg)
        // 에디터 로드 실패 시 자동 fallback (보통 다운로드로 전환)
        if (onFallbackRef.current) {
          onFallbackRef.current()
        }
      }
    }

    // iframe 의 load 이벤트가 발생한 후 진행 (contentWindow 가 사용 가능해야 postMessage)
    const iframe = iframeRef.current
    if (!iframe) return

    const onIframeLoad = () => {
      if (isMountedRef.current) run()
    }
    iframe.addEventListener('load', onIframeLoad)

    // 이미 로드됐을 수도 있음 (캐시 hit)
    if (iframe.contentWindow && iframe.contentDocument?.readyState === 'complete') {
      onIframeLoad()
    }

    return () => {
      isMountedRef.current = false
      iframe.removeEventListener('load', onIframeLoad)
      pendingRef.current.clear()
    }
  }, [filePath, fileName, studioUrl, sendRequest, readyPollIntervalMs, readyTimeoutMs])

  // 저장 핸들러
  const handleSave = useCallback(async () => {
    if (isSaving || readOnly || loadState !== 'ready') return
    setIsSaving(true)
    try {
      const result = await sendRequest<number[] | Uint8Array>('exportHwp', {}, 30000)
      const bytes = result instanceof Uint8Array ? result : new Uint8Array(result || [])
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
  }, [filePath, fileName, isSaving, readOnly, loadState, sendRequest])

  // Ctrl+S / ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!readOnly) handleSave()
      }
      if (e.key === 'Escape') {
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
              <p>{statusMsg}</p>
            </div>
          )}
          {loadState === 'error' && (
            <div className="rhwp-error">
              <p>{errorMsg ?? '알 수 없는 오류'}</p>
              <button onClick={onClose}>닫기</button>
            </div>
          )}
          <iframe
            ref={iframeRef}
            className="rhwp-iframe"
            // 상대 경로 (/rhwp/) 를 절대 URL 로 변환 — same-origin 이어서 PNA 회피
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
