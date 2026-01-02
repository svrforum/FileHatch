import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastState {
  toasts: ToastMessage[]
  showToast: (message: string, type?: ToastType, duration?: number) => void
  showSuccess: (message: string) => void
  showError: (message: string) => void
  showWarning: (message: string) => void
  showInfo: (message: string) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  showToast: (message: string, type: ToastType = 'info', duration = 5000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, duration }]
    }))
  },

  showSuccess: (message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'success', message, duration: 5000 }]
    }))
  },

  showError: (message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'error', message, duration: 7000 }]
    }))
  },

  showWarning: (message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'warning', message, duration: 5000 }]
    }))
  },

  showInfo: (message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'info', message, duration: 5000 }]
    }))
  },

  removeToast: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }))
  },
}))

// Helper function to parse upload error messages
export function parseUploadError(errorMessage: string): string {
  const lowerMessage = errorMessage.toLowerCase()

  // Check for quota-related keywords first (most specific)
  if (
    lowerMessage.includes('quota exceeded') ||
    lowerMessage.includes('storage quota') ||
    lowerMessage.includes('저장 공간') ||
    lowerMessage.includes('response code: 413') ||
    lowerMessage.includes('remaining') // API returns "remaining" field for quota errors
  ) {
    return '저장 공간이 부족합니다. 휴지통을 비우거나 불필요한 파일을 삭제해주세요.'
  }

  // Try to extract JSON from response text (handle complex JSON with greedy match)
  const jsonMatch = errorMessage.match(/response text:\s*(\{[^]*?\})\s*,?\s*request id/i)
  if (jsonMatch && jsonMatch[1]) {
    try {
      const errorObj = JSON.parse(jsonMatch[1])
      if (errorObj.error) {
        const errorLower = errorObj.error.toLowerCase()
        // Translate common errors
        if (errorLower.includes('quota') || errorLower.includes('storage')) {
          return '저장 공간이 부족합니다. 휴지통을 비우거나 불필요한 파일을 삭제해주세요.'
        }
        if (errorLower.includes('extension')) {
          return '허용되지 않는 파일 형식입니다.'
        }
        if (errorLower.includes('size') || errorLower.includes('large')) {
          return '파일 크기가 허용 한도를 초과합니다.'
        }
        return errorObj.error
      }
      // Check for remaining field (quota error indicator)
      if (errorObj.remaining !== undefined) {
        return '저장 공간이 부족합니다. 휴지통을 비우거나 불필요한 파일을 삭제해주세요.'
      }
    } catch {
      // JSON parse failed, continue with other checks
    }
  }

  // Check for common error patterns in the message (case insensitive)
  if (lowerMessage.includes('extension not allowed') || lowerMessage.includes('확장자')) {
    return '허용되지 않는 파일 형식입니다.'
  }
  if (lowerMessage.includes('file too large') || lowerMessage.includes('max size')) {
    return '파일 크기가 허용 한도를 초과합니다.'
  }

  // Generic rejection - provide more helpful message
  if (lowerMessage.includes('err_upload_rejected') || lowerMessage.includes('response code: 400')) {
    // TUS doesn't pass the actual error details, so provide a helpful generic message
    return '업로드가 거부되었습니다. 저장 공간이 부족하거나 파일이 허용되지 않을 수 있습니다.'
  }

  // Return a generic message if nothing matches
  return '업로드 중 오류가 발생했습니다.'
}
