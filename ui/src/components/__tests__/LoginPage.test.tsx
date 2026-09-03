import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../stores/authStore'
import LoginPage from '../LoginPage'

vi.mock('../../api/auth', async () => {
  const actual = await vi.importActual<typeof import('../../api/auth')>('../../api/auth')
  return {
    ...actual,
    getSSOProviders: vi.fn().mockResolvedValue({
      enabled: false,
      ssoOnlyMode: false,
      providers: [],
    }),
  }
})

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      user: null,
      isLoading: false,
      error: null,
      requires2FA: false,
      requiresSetup: false,
    })
    window.history.replaceState({}, '', '/login')
  })

  it('입력한 비밀번호를 보기/숨김 전환하고 현재 비밀번호 자동완성을 유지한다', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    const passwordInput = screen.getByLabelText('비밀번호')
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')

    await user.type(passwordInput, 'Secret123!')
    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))

    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '비밀번호 숨기기' })).toHaveAttribute('aria-pressed', 'true')
  })
})
