import { ref } from 'vue'
import { authFilesApi, type AuthFile } from '../api/authFiles'

interface BatchActionResult {
  name: string
  success: boolean
  error?: string
}

const normalizeError = (err: unknown, fallbackMessage: string): Error => {
  if (err instanceof Error) {
    if (typeof err.message === 'string' && err.message.trim()) {
      return err
    }
    return new Error(fallbackMessage)
  }

  if (typeof err === 'string' && err.trim()) {
    return new Error(err.trim())
  }

  return new Error(fallbackMessage)
}

const buildBatchFailureMessage = (actionLabel: string, results: BatchActionResult[]): string | null => {
  const failed = results.filter((item) => !item.success)
  if (failed.length === 0) return null

  const detail = failed
    .slice(0, 3)
    .map((item) => {
      if (item.error) {
        return `${item.name}(${item.error})`
      }
      return item.name
    })
    .join('、')

  const suffix = failed.length > 3 ? ` 等 ${failed.length} 个文件` : ''
  return `${actionLabel}失败：${detail}${suffix}`
}

export function useAuthFiles() {
  const files = ref<AuthFile[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const setError = (err: unknown, fallbackMessage: string): Error => {
    const normalizedError = normalizeError(err, fallbackMessage)
    error.value = normalizedError.message
    return normalizedError
  }

  const loadFiles = async (options: { throwOnError?: boolean } = {}) => {
    loading.value = true
    error.value = null
    try {
      const response = await authFilesApi.list()
      files.value = response.files || []
    } catch (err: unknown) {
      const normalizedError = setError(err, '加载文件失败')
      console.error(normalizedError)
      if (options.throwOnError) {
        throw normalizedError
      }
    } finally {
      loading.value = false
    }
  }

  const deleteFile = async (name: string) => {
    try {
      await authFilesApi.delete(name)
      await loadFiles({ throwOnError: true })
      return true
    } catch (err: unknown) {
      throw setError(err, '删除文件失败')
    }
  }

  const setStatus = async (name: string, disabled: boolean) => {
    try {
      await authFilesApi.setStatus(name, disabled)
      const file = files.value.find(f => f.name === name)
      if (file) {
        file.disabled = disabled
        const normalized = (file.status || '').toLowerCase().trim()
        if (!normalized || normalized === 'active' || normalized === 'disabled') {
          file.status = disabled ? 'disabled' : 'active'
        }
      }
      return true
    } catch (err: unknown) {
      throw setError(err, '更新状态失败')
    }
  }

  const batchSetStatus = async (names: string[], disabled: boolean) => {
    try {
      const results = await authFilesApi.batchSetStatus(names, disabled)
      await loadFiles({ throwOnError: true })
      const failureMessage = buildBatchFailureMessage(disabled ? '批量禁用' : '批量启用', results)
      if (failureMessage) {
        throw new Error(failureMessage)
      }
      return true
    } catch (err: unknown) {
      throw setError(err, '批量更新状态失败')
    }
  }

  const batchDelete = async (names: string[]) => {
    try {
      const results = await authFilesApi.batchDelete(names)
      await loadFiles({ throwOnError: true })
      const failureMessage = buildBatchFailureMessage('批量删除', results)
      if (failureMessage) {
        throw new Error(failureMessage)
      }
      return true
    } catch (err: unknown) {
      throw setError(err, '批量删除失败')
    }
  }

  return {
    files,
    loading,
    error,
    loadFiles,
    deleteFile,
    setStatus,
    batchSetStatus,
    batchDelete
  }
}
