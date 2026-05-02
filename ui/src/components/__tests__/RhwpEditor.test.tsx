import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import RhwpEditor from '../RhwpEditor'

// API 모킹
vi.mock('../../api/files', () => ({
  getFileUrl: (p: string) => `/api/files/${p}`,
  getAuthToken: () => 'test-token',
  saveBinaryFileContent: vi.fn(),
}))

import { saveBinaryFileContent } from '../../api/files'

const mockSave = saveBinaryFileContent as ReturnType<typeof vi.fn>

describe.skip('RhwpEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('iframe src 에 url + filename + token query 가 포함됨', () => {
    render(
      <RhwpEditor
        filePath="/home/user/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
      />
    )

    const iframe = document.querySelector('.rhwp-iframe') as HTMLIFrameElement | null
    expect(iframe).toBeTruthy()
    const src = iframe!.src
    expect(src).toContain('https://edwardkim.github.io/rhwp/')
    expect(src).toContain('url=')
    expect(src).toContain('filename=sample.hwp')
    expect(src).toContain('token%3Dtest-token')
  })

  it('헤더에 파일명과 베타 배지가 보임', () => {
    render(
      <RhwpEditor
        filePath="/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('sample.hwp')).toBeInTheDocument()
    expect(screen.getByText('베타')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /저장/ })).toBeInTheDocument()
  })

  it('readOnly=true 일 때 저장 버튼이 렌더링되지 않음', () => {
    render(
      <RhwpEditor
        filePath="/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        readOnly
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /저장/ })).not.toBeInTheDocument()
  })

  it('저장 버튼 클릭 시 iframe 에 exportHwp 메시지 전송 후 saveBinaryFileContent 호출', async () => {
    mockSave.mockResolvedValue(undefined)
    const onSaved = vi.fn()

    render(
      <RhwpEditor
        filePath="/home/user/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )

    // iframe.contentWindow 모킹 — 우리가 메시지 보내면 즉시 응답
    const iframe = document.querySelector('.rhwp-iframe') as HTMLIFrameElement
    const fakePostMessage = vi.fn((msg: { id: number; method: string }) => {
      // exportHwp 응답 시뮬레이션
      if (msg.method === 'exportHwp') {
        setTimeout(() => {
          window.postMessage(
            { type: 'rhwp-response', id: msg.id, result: [1, 2, 3, 4] },
            '*',
          )
        }, 0)
      }
    })
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => ({ postMessage: fakePostMessage }),
    })

    const btn = screen.getByRole('button', { name: /저장/ })
    btn.click()

    await waitFor(() => {
      expect(fakePostMessage).toHaveBeenCalled()
      expect(mockSave).toHaveBeenCalledWith(
        '/home/user/sample.hwp',
        expect.any(Uint8Array),
        'application/x-hwp',
      )
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('hwpx 확장자는 application/vnd.hancom.hwpx MIME 으로 저장', async () => {
    mockSave.mockResolvedValue(undefined)

    render(
      <RhwpEditor
        filePath="/foo.hwpx"
        fileName="foo.hwpx"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
      />
    )

    const iframe = document.querySelector('.rhwp-iframe') as HTMLIFrameElement
    const fakePostMessage = vi.fn((msg: { id: number; method: string }) => {
      if (msg.method === 'exportHwp') {
        setTimeout(() => {
          window.postMessage(
            { type: 'rhwp-response', id: msg.id, result: [9, 8, 7] },
            '*',
          )
        }, 0)
      }
    })
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => ({ postMessage: fakePostMessage }),
    })

    const btn = screen.getByRole('button', { name: /저장/ })
    btn.click()

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        '/foo.hwpx',
        expect.any(Uint8Array),
        'application/vnd.hancom.hwpx',
      )
    })
  })
})
