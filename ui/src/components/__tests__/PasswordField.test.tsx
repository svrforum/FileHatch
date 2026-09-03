import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PasswordField from '../PasswordField'

describe('PasswordField', () => {
  it('보기 버튼으로 입력 형식과 접근성 상태를 전환한다', async () => {
    const user = userEvent.setup()
    render(<PasswordField label="새 비밀번호" value="Secret123!" onChange={vi.fn()} />)

    const input = screen.getByLabelText('새 비밀번호')
    const toggle = screen.getByRole('button', { name: '새 비밀번호 보기' })
    expect(input).toHaveAttribute('type', 'password')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '새 비밀번호 숨기기' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('값이 초기화되면 다시 숨김 상태가 된다', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PasswordField label="비밀번호" value="Secret123!" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))

    rerender(<PasswordField label="비밀번호" value="" onChange={vi.fn()} />)

    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('type', 'password')
  })
})
