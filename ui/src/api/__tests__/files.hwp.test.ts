import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isHwpSupported, saveBinaryFileContent } from '../files'

describe('isHwpSupported', () => {
  it.each([
    ['hwp', true],
    ['hwpx', true],
    ['HWP', true],
    ['.hwp', true],
    ['.HWPX', true],
    ['docx', false],
    ['pdf', false],
    [undefined, false],
    ['', false],
  ])('확장자 %s → %s', (ext, expected) => {
    expect(isHwpSupported(ext)).toBe(expected)
  })
})

describe('saveBinaryFileContent', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('PUT /api/files/content/<path> 에 바이너리 본문 + Content-Type 으로 호출', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    global.fetch = fetchMock

    const data = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) // OLE2 매직 바이트
    await saveBinaryFileContent('/home/user/a b/sample.hwp', data, 'application/x-hwp')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/content/home/user/a%20b/sample.hwp')
    expect(opts.method).toBe('PUT')
    expect(opts.headers['Content-Type']).toBe('application/x-hwp')
    expect(opts.body).toBeInstanceOf(Uint8Array)
  })

  it('실패 시 서버 에러 메시지를 throw', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: '권한 없음' }),
    } as Response)

    await expect(
      saveBinaryFileContent('/x.hwp', new Uint8Array(0), 'application/x-hwp'),
    ).rejects.toThrow('권한 없음')
  })
})
