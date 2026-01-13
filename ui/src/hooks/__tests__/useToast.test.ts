import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToast } from '../useToast'
import { useToastStore } from '../../stores/toastStore'

describe('useToast', () => {
  beforeEach(() => {
    // Reset the zustand store before each test
    const state = useToastStore.getState()
    state.toasts.forEach(toast => state.removeToast(toast.id))
  })

  it('should initialize with empty toasts array', () => {
    const { result } = renderHook(() => useToast())
    expect(result.current.toasts).toEqual([])
  })

  it('should add a toast with addToast', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.addToast('Test message', 'success')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Test message')
    expect(result.current.toasts[0].type).toBe('success')
  })

  it('should add multiple toasts', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.addToast('First', 'success')
      result.current.addToast('Second', 'error')
      result.current.addToast('Third', 'info')
    })

    expect(result.current.toasts).toHaveLength(3)
    expect(result.current.toasts[0].message).toBe('First')
    expect(result.current.toasts[1].message).toBe('Second')
    expect(result.current.toasts[2].message).toBe('Third')
  })

  it('should remove a toast by id', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.addToast('Test message', 'success')
    })

    const toastId = result.current.toasts[0].id

    act(() => {
      result.current.removeToast(toastId)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('should not remove non-existent toast', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.addToast('Test message', 'success')
    })

    act(() => {
      result.current.removeToast('non-existent-id')
    })

    expect(result.current.toasts).toHaveLength(1)
  })

  it('should add success toast with showSuccess', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.showSuccess('Success message')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].type).toBe('success')
    expect(result.current.toasts[0].message).toBe('Success message')
  })

  it('should add error toast with showError', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.showError('Error message')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].type).toBe('error')
    expect(result.current.toasts[0].message).toBe('Error message')
  })

  it('should add info toast with showInfo', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.showInfo('Info message')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].type).toBe('info')
    expect(result.current.toasts[0].message).toBe('Info message')
  })

  it('should add warning toast with showWarning', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.showWarning('Warning message')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].type).toBe('warning')
    expect(result.current.toasts[0].message).toBe('Warning message')
  })

  it('should generate unique ids for toasts', async () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.addToast('First', 'success')
    })

    // Small delay to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 5))

    act(() => {
      result.current.addToast('Second', 'success')
    })

    const ids = result.current.toasts.map(t => t.id)
    expect(new Set(ids).size).toBe(2) // All ids should be unique
  })
})
