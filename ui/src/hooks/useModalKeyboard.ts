import { useEffect, useCallback, useRef } from 'react'

interface UseModalKeyboardOptions {
  isOpen: boolean
  onConfirm?: () => void
  onCancel?: () => void
  /** Set to true if the modal has an input field that should receive focus */
  hasInput?: boolean
  /** Disable Enter key confirmation (useful for forms with inputs) */
  disableEnterConfirm?: boolean
}

/**
 * Hook for handling keyboard shortcuts in modals
 * - Enter: Confirm action (unless disableEnterConfirm is true)
 * - Escape: Cancel/Close modal
 *
 * @returns confirmButtonRef - Ref to attach to the confirm button for auto-focus
 */
export function useModalKeyboard({
  isOpen,
  onConfirm,
  onCancel,
  hasInput = false,
  disableEnterConfirm = false,
}: UseModalKeyboardOptions) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if user is typing in an input/textarea
    const target = e.target as HTMLElement
    const isInputFocused = target.tagName === 'INPUT' ||
                          target.tagName === 'TEXTAREA' ||
                          target.isContentEditable

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel?.()
    } else if (e.key === 'Enter' && !disableEnterConfirm) {
      // For inputs, only trigger on Ctrl+Enter or if not focused on input
      if (isInputFocused) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          onConfirm?.()
        }
        // Regular Enter in input - don't prevent default (allow form submission)
      } else {
        e.preventDefault()
        onConfirm?.()
      }
    }
  }, [onCancel, onConfirm, disableEnterConfirm])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)

      // Auto-focus: input field or confirm button
      if (!hasInput) {
        setTimeout(() => confirmButtonRef.current?.focus(), 50)
      }

      return () => {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [isOpen, handleKeyDown, hasInput])

  return { confirmButtonRef }
}

export default useModalKeyboard
