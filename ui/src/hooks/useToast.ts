import { useToastStore, ToastType } from '../stores/toastStore'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

export interface UseToastReturn {
  toasts: Toast[]
  addToast: (message: string, type: Toast['type']) => void
  removeToast: (id: string) => void
  showSuccess: (message: string) => void
  showError: (message: string) => void
  showInfo: (message: string) => void
  showWarning: (message: string) => void
}

/**
 * Hook for managing toast notifications
 * This is a wrapper around useToastStore for backward compatibility
 */
export function useToast(): UseToastReturn {
  const storeToasts = useToastStore((state) => state.toasts)
  const showToast = useToastStore((state) => state.showToast)
  const storeRemoveToast = useToastStore((state) => state.removeToast)
  const storeShowSuccess = useToastStore((state) => state.showSuccess)
  const storeShowError = useToastStore((state) => state.showError)
  const storeShowInfo = useToastStore((state) => state.showInfo)
  const storeShowWarning = useToastStore((state) => state.showWarning)

  // Map store toasts to the expected format
  const toasts: Toast[] = storeToasts.map((t) => ({
    id: t.id,
    message: t.message,
    type: t.type,
  }))

  const addToast = (message: string, type: Toast['type']) => {
    showToast(message, type)
  }

  return {
    toasts,
    addToast,
    removeToast: storeRemoveToast,
    showSuccess: storeShowSuccess,
    showError: storeShowError,
    showInfo: storeShowInfo,
    showWarning: storeShowWarning,
  }
}

export default useToast
