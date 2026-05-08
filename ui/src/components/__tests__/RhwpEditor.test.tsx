import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RhwpEditor from '../RhwpEditor'

vi.mock('../../api/files', () => ({
  getFileUrl: (p: string) => `/api/files/content${p}`,
  getAuthToken: () => 'test-token',
  saveBinaryFileContent: vi.fn(async () => undefined),
}))

interface PostedMessage {
  type: string
  id: number
  method: string
  params: Record<string, unknown>
}

// iframe contentWindow 의 postMessage 를 가로채서 부모로 응답을 다시 보낸다.
function setupIframeStub(opts: {
  readyResponse?: { delay?: number; ok?: boolean; error?: string }
  loadFileResponse?: { delay?: number; pageCount?: number; error?: string }
  exportResponse?: { delay?: number; bytes?: number[]; error?: string }
}): { posted: PostedMessage[] } {
  const posted: PostedMessage[] = []

  // HTMLIFrameElement.contentWindow.postMessage 가로채기
  // (descriptor 캡처는 디버그 용도 — afterEach 의 delete 로 cleanup)
  const _origDescriptor = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    'contentWindow',
  )
  void _origDescriptor
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const self = this
      // jsdom 은 외부 URL src 의 iframe 에서 load 이벤트를 발생시키지 않으므로,
      // contentWindow 가 처음 접근될 때 비동기로 load 를 강제 트리거한다.
      // 이렇게 해야 컴포넌트의 iframe.addEventListener('load', ...) 핸들러가 호출되어
      // run() 진입이 가능해진다.
      const tagged = self as HTMLIFrameElement & { __loadFired?: boolean }
      if (!tagged.__loadFired) {
        tagged.__loadFired = true
        setTimeout(() => self.dispatchEvent(new Event('load')), 0)
      }
      return {
        postMessage: (msg: PostedMessage) => {
          posted.push(msg)
          // 적절한 응답 시뮬레이션
          const respond = (
            payload: Partial<{ result: unknown; error: string }>,
            delay = 0,
          ) => {
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: { type: 'rhwp-response', id: msg.id, ...payload },
                }),
              )
            }, delay)
          }
          if (msg.method === 'ready') {
            const r = opts.readyResponse ?? { ok: true }
            if (r.error) respond({ error: r.error }, r.delay)
            else respond({ result: r.ok ?? true }, r.delay)
          } else if (msg.method === 'loadFile') {
            const r = opts.loadFileResponse ?? { pageCount: 1 }
            if (r.error) respond({ error: r.error }, r.delay)
            else respond({ result: { pageCount: r.pageCount ?? 1 } }, r.delay)
          } else if (msg.method === 'exportHwp') {
            const r = opts.exportResponse ?? { bytes: [1, 2, 3] }
            if (r.error) respond({ error: r.error }, r.delay)
            else respond({ result: r.bytes ?? [1, 2, 3] }, r.delay)
          }
          void self
        },
      } as unknown as Window
    },
  })

  // fetch mock — 인증된 same-origin fetch 결과 ArrayBuffer
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  })) as unknown as typeof fetch

  return { posted }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  // contentWindow descriptor 원복
  delete (HTMLIFrameElement.prototype as unknown as { contentWindow?: unknown })
    .contentWindow
})

/**
 * Vitest fake timers + @testing-library/react `waitFor` 는 호환성 문제가 있다.
 * waitFor 내부 setInterval polling 이 fake timer 큐에 쌓이면 영원히 진행 못한다.
 * 그래서 fake timer 로 컴포넌트의 비동기 작업을 모두 처리한 뒤,
 * waitFor / findBy* 호출 직전에 real timers 로 전환한다.
 *
 * (jsdom 의 iframe 'load' 이벤트 미발행 + v0.14.1 의 retry/polling 루프를
 *  단일 테스트 환경에서 안전하게 다루기 위한 실용적 절충)
 */
async function flushFakeAndSwitchToReal(): Promise<void> {
  await vi.runAllTimersAsync()
  vi.useRealTimers()
}

describe('RhwpEditor — B1 (no retry, single shot)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'queueMicrotask'] })
  })

  it('정상 흐름: ready → fetch → loadFile → ready 상태 + pageCount 표시', async () => {
    const { posted } = setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 3 },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
      />,
    )

    // iframe load 이벤트 → ready ping 보냄
    await flushFakeAndSwitchToReal()

    await waitFor(() => {
      expect(screen.getByText('3페이지')).toBeInTheDocument()
    })

    // 정확히 'ready' 1번 + 'loadFile' 1번만 호출되어야 함 (재시도 없음)
    const readyCalls = posted.filter((m) => m.method === 'ready').length
    const loadFileCalls = posted.filter((m) => m.method === 'loadFile').length
    expect(readyCalls).toBe(1)
    expect(loadFileCalls).toBe(1)
  })

  it('loadFile 실패 시 단발 호출만 — 재시도 없음', async () => {
    const { posted } = setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { error: '__wbindgen_malloc undefined' },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
      />,
    )

    await flushFakeAndSwitchToReal()

    await waitFor(() => {
      expect(screen.getByText(/한글 문서를 열 수 없습니다/i)).toBeInTheDocument()
    })

    expect(posted.filter((m) => m.method === 'loadFile').length).toBe(1)
  })

  it('에러 화면에 [다운로드] 버튼 — 클릭 시 onDownload 호출', async () => {
    setupIframeStub({
      readyResponse: { error: 'Request timeout: ready' },
    })
    const onDownload = vi.fn()

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
        onDownload={onDownload}
        readyTimeoutMs={50}
        readyPollIntervalMs={5}
      />,
    )

    await flushFakeAndSwitchToReal()

    const dlBtn = await screen.findByRole('button', { name: /다운로드/ })
    fireEvent.click(dlBtn)
    expect(onDownload).toHaveBeenCalledOnce()
  })

  it('에러 시 onDownload 가 자동으로 호출되지 않음 (사용자 클릭만)', async () => {
    setupIframeStub({
      readyResponse: { error: 'Request timeout: ready' },
    })
    const onDownload = vi.fn()

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
        onDownload={onDownload}
        readyTimeoutMs={50}
        readyPollIntervalMs={5}
      />,
    )

    await flushFakeAndSwitchToReal()
    await screen.findByText(/한글 문서를 열 수 없습니다/i)
    expect(onDownload).not.toHaveBeenCalled()
  })

  it('hasWritePermission=false 일 때 저장 버튼 미렌더', async () => {
    setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
    })

    render(
      <RhwpEditor
        filePath="/shared/foo/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        hasWritePermission={false}
        onClose={() => {}}
      />,
    )

    await flushFakeAndSwitchToReal()
    await screen.findByText('1페이지')

    expect(screen.queryByRole('button', { name: /저장/ })).toBeNull()
  })

  it('hasWritePermission=true (기본) 일 때 저장 버튼 렌더', async () => {
    setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
      />,
    )

    await flushFakeAndSwitchToReal()
    await screen.findByText('1페이지')
    expect(screen.getByRole('button', { name: /저장/ })).toBeInTheDocument()
  })

  it('readOnly=true 일 때 저장 버튼 미렌더 (hasWritePermission 과 무관)', async () => {
    setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        readOnly
        onClose={() => {}}
      />,
    )

    await flushFakeAndSwitchToReal()
    await screen.findByText('1페이지')
    expect(screen.queryByRole('button', { name: /저장/ })).toBeNull()
  })

  it('Ctrl+S → exportHwp + saveBinaryFileContent 호출', async () => {
    const { posted } = setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
      exportResponse: { bytes: [9, 9, 9] },
    })
    const onSaved = vi.fn()

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
        onSaved={onSaved}
      />,
    )

    await flushFakeAndSwitchToReal()
    await screen.findByText('1페이지')

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    // real timers — exportHwp 응답은 stub 의 setTimeout(0) 으로 곧바로 들어옴
    await waitFor(() => {
      expect(posted.some((m) => m.method === 'exportHwp')).toBe(true)
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})
