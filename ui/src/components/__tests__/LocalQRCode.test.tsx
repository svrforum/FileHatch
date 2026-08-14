import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalQRCode from '../LocalQRCode'

const toDataURL = vi.fn()

vi.mock('qrcode', () => ({
  toDataURL,
}))

describe('LocalQRCode', () => {
  beforeEach(() => {
    toDataURL.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('외부 네트워크 요청 없이 브라우저에서 QR 코드를 생성한다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    toDataURL.mockResolvedValue('data:image/png;base64,local-qr-code')

    render(<LocalQRCode value="otpauth://totp/FileHatch:user?secret=test" alt="2FA QR 코드" />)

    expect(screen.getByRole('status')).toHaveTextContent('QR 코드를 생성하는 중입니다.')
    const image = await screen.findByRole('img', { name: '2FA QR 코드' })

    expect(image).toHaveAttribute('src', 'data:image/png;base64,local-qr-code')
    expect(toDataURL).toHaveBeenCalledWith(
      'otpauth://totp/FileHatch:user?secret=test',
      expect.objectContaining({ width: 200 }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('생성 실패 시 수동 입력 안내를 표시한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toDataURL.mockRejectedValue(new Error('generation failed'))

    render(<LocalQRCode value="otpauth://totp/FileHatch:user?secret=test" alt="2FA QR 코드" />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('비밀키를 수동으로 입력해 주세요.')
    })
  })
})
