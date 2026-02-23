import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
}

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'primary'
}

interface ConfirmState {
  visible: boolean
  options: ConfirmOptions
  resolve?: (value: boolean) => void
}

let toastIdCounter = 0

export const useNotificationStore = defineStore('notification', () => {
  const toasts = ref<Toast[]>([])
  const confirm = ref<ConfirmState>({
    visible: false,
    options: {
      message: ''
    }
  })
  const confirmHostReady = ref(false)

  const showNotification = (message: string, type: ToastType = 'info', duration: number = 3000) => {
    const id = `toast-${++toastIdCounter}-${Date.now()}`
    const toast: Toast = {
      id,
      message,
      type,
      duration
    }

    toasts.value.push(toast)

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, duration)
    }

    return id
  }

  const success = (message: string, duration?: number) => {
    return showNotification(message, 'success', duration)
  }

  const error = (message: string, duration?: number) => {
    return showNotification(message, 'error', duration)
  }

  const warning = (message: string, duration?: number) => {
    return showNotification(message, 'warning', duration)
  }

  const info = (message: string, duration?: number) => {
    return showNotification(message, 'info', duration)
  }

  const removeToast = (id: string) => {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index > -1) {
      toasts.value.splice(index, 1)
    }
  }

  const clearAll = () => {
    toasts.value = []
  }

  const registerConfirmHost = () => {
    confirmHostReady.value = true
  }

  const unregisterConfirmHost = () => {
    confirmHostReady.value = false
    if (confirm.value.resolve) {
      confirm.value.resolve(false)
    }
    confirm.value.visible = false
    confirm.value.resolve = undefined
  }

  const showConfirmation = async (options: ConfirmOptions): Promise<boolean> => {
    const normalizedOptions: ConfirmOptions = {
      title: options.title || '确认',
      message: options.message,
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      variant: options.variant || 'primary'
    }

    if (!confirmHostReady.value) {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return window.confirm(normalizedOptions.message)
      }
      return false
    }

    if (confirm.value.resolve) {
      confirm.value.resolve(false)
    }

    return new Promise((resolve) => {
      confirm.value.options = normalizedOptions
      confirm.value.visible = true
      confirm.value.resolve = resolve
    })
  }

  const resolveConfirmation = (result: boolean) => {
    if (confirm.value.resolve) {
      confirm.value.resolve(result)
    }
    confirm.value.visible = false
    confirm.value.resolve = undefined
  }

  return {
    toasts,
    confirm,
    confirmHostReady,
    showNotification,
    success,
    error,
    warning,
    info,
    removeToast,
    clearAll,
    registerConfirmHost,
    unregisterConfirmHost,
    showConfirmation,
    resolveConfirmation
  }
})
