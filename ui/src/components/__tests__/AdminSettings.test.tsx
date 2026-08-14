import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../stores/authStore'
import AdminSettings from '../AdminSettings'

const adminUser = {
  id: 'admin-id',
  username: 'admin',
  provider: 'local',
  isAdmin: true,
  isActive: true,
  hasSmb: false,
  has2fa: false,
  setupCompleted: true,
  storageQuota: 0,
  storageUsed: 0,
  createdAt: '2026-08-06T00:00:00Z',
}

describe('AdminSettings 비밀번호 정책', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 'test-token', user: adminUser })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ settings: [] }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('필수 문자 종류를 클릭하면 최소 문자 종류 수를 선택 개수로 동기화한다', async () => {
    const user = userEvent.setup()
    render(<AdminSettings />)

    await screen.findByRole('heading', { name: '비밀번호 정책' })
    await user.click(screen.getByRole('checkbox', { name: '대문자 필수' }))
    expect(screen.getByRole('radio', { name: '1종' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('checkbox', { name: '소문자 필수' }))
    await user.click(screen.getByRole('checkbox', { name: '숫자 필수' }))
    expect(screen.getByRole('radio', { name: '3종' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('checkbox', { name: '소문자 필수' }))
    expect(screen.getByRole('radio', { name: '2종' })).toHaveAttribute('aria-checked', 'true')
  })

  it('최소 문자 종류 수를 버튼으로 직접 선택할 수 있다', async () => {
    const user = userEvent.setup()
    render(<AdminSettings />)

    await screen.findByRole('heading', { name: '비밀번호 정책' })
    await user.click(screen.getByRole('radio', { name: '4종' }))

    expect(screen.getByRole('radio', { name: '4종' })).toHaveAttribute('aria-checked', 'true')
  })
})
