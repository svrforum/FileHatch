import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import RhwpEditor from '../RhwpEditor'

// @rhwp/editor 모킹
vi.mock('@rhwp/editor', () => ({
  createEditor: vi.fn(),
}))

// API 모킹
vi.mock('../../api/files', () => ({
  getFileUrl: (p: string) => `/api/files/${p}`,
  getAuthToken: () => 'test-token',
  saveBinaryFileContent: vi.fn(),
}))

import { createEditor } from '@rhwp/editor'
import { saveBinaryFileContent } from '../../api/files'

const mockCreateEditor = createEditor as ReturnType<typeof vi.fn>
const mockSave = saveBinaryFileContent as ReturnType<typeof vi.fn>

function makeFakeEditor() {
  return {
    loadFile: vi.fn().mockResolvedValue({ pageCount: 3 }),
    pageCount: vi.fn().mockResolvedValue(3),
    getPageSvg: vi.fn(),
    exportHwp: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    element: document.createElement('iframe'),
    destroy: vi.fn(),
  }
}

describe('RhwpEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // fetch 모킹 — 인증된 다운로드 시뮬레이션
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)
  })

  it('마운트 시 createEditor + loadFile 을 호출하고 페이지 수를 표시', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)

    render(
      <RhwpEditor
        filePath="/home/user/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(mockCreateEditor).toHaveBeenCalledTimes(1)
      expect(fake.loadFile).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText('3페이지')).toBeInTheDocument()
    expect(screen.getByText('베타')).toBeInTheDocument()
  })

  it('저장 버튼 클릭 시 exportHwp + saveBinaryFileContent 를 호출', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)
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

    const btn = await screen.findByText(/저장/, { exact: false })
    btn.click()

    await waitFor(() => {
      expect(fake.exportHwp).toHaveBeenCalledTimes(1)
      expect(mockSave).toHaveBeenCalledWith(
        '/home/user/sample.hwp',
        expect.any(Uint8Array),
        'application/x-hwp',
      )
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('readOnly=true 일 때 저장 버튼이 렌더링되지 않음', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)

    render(
      <RhwpEditor
        filePath="/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        readOnly
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(mockCreateEditor).toHaveBeenCalled())
    expect(screen.queryByText(/저장/)).not.toBeInTheDocument()
  })

  it('createEditor 실패 시 에러 메시지 표시 + onError 콜백', async () => {
    mockCreateEditor.mockRejectedValue(new Error('iframe load failed'))
    const onError = vi.fn()

    render(
      <RhwpEditor
        filePath="/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
        onError={onError}
      />
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('iframe load failed')
    })
    expect(await screen.findByText('iframe load failed')).toBeInTheDocument()
  })

  it('hwpx 확장자는 application/vnd.hancom.hwpx MIME 으로 저장', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)
    mockSave.mockResolvedValue(undefined)

    render(
      <RhwpEditor
        filePath="/foo.hwpx"
        fileName="foo.hwpx"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
      />
    )

    const btn = await screen.findByText(/저장/, { exact: false })
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
