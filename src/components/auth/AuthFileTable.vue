<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch, Teleport, Transition } from 'vue'
import {
  Search,
  Upload,
  Download,
  RefreshCw,
  Edit,
  Check,
  X,
  Trash2,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
  Info,
  ArrowUp,
  ArrowDown,
  ArrowUpDown
} from 'lucide-vue-next'
import JSZip from 'jszip'
import { authFilesApi } from '../../api/authFiles'
import { useQuotaStore, quotaKey } from '../../stores/quota'
import { useNotificationStore } from '../../stores/notification'
import { useAuthFiles } from '../../composables/useAuthFiles'
import { useAuthFileFilters, AUTH_FILE_SPECIAL_STATUS } from '../../composables/useAuthFileFilters'
import { useQuotaLoader } from '../../composables/useQuotaLoader'
import { cn } from '../../lib/utils'
import {
  getStatusVariant,
  getStatusLabel,
  getProviderDisplayName,
  supportsQuota,
  getQuotaPercentClass
} from '../../config/constants'
import { generateAvailabilityPointsFromUsage } from '../../utils/availability'
import { formatResetTime } from '../../utils/quota'
import { usePagination } from '../../composables/usePagination'
import { useTableSelection } from '../../composables/useTableSelection'
import { useUsageStore } from '../../stores/usage'

// UI Components
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Badge from '../ui/badge/Badge.vue'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../ui/table'
import Dialog from '../ui/dialog/Dialog.vue'
import { Tooltip } from '../ui/tooltip'
import BatchFieldEditor from '../BatchFieldEditor.vue'
import QuotaDialog from '../QuotaDialog.vue'
import AvailabilityMonitor from './AvailabilityMonitor.vue'

// Stores
const quotaStore = useQuotaStore()
const notificationStore = useNotificationStore()
const { files: authFiles, loading, loadFiles: loadAuthFiles, setStatus: setStatusApi, batchSetStatus: batchSetStatusApi, deleteFile: deleteFileApi, batchDelete: batchDeleteApi } = useAuthFiles()
const { loadQuota, loadExpiredQuota } = useQuotaLoader()

const parseRemainingQuota = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const getCodexWeeklyRemaining = (file: any): number | null => {
  const q = quotaStore.getQuotaStatus(quotaKey.file(file.name))
  if (!q || q.status !== 'success') return null
  if ((q.type || '').toLowerCase().trim() !== 'codex') return null

  const limits = q.data?.limits
  if (!Array.isArray(limits)) return null

  const weekly = limits.find((l: any) => String(l?.model || '').toLowerCase().trim() === 'weekly')
  if (!weekly) return null

  return parseRemainingQuota(weekly.percent ?? weekly.remaining)
}

const isWeeklyQuotaExhausted = (file: any) => {
  const remaining = getCodexWeeklyRemaining(file)
  return remaining !== null && remaining <= 0
}

const hasQuotaRemaining = (file: any) => {
  if (!supportsQuota(file.type)) return false

  const codexWeeklyRemaining = getCodexWeeklyRemaining(file)
  if (codexWeeklyRemaining !== null) {
    return codexWeeklyRemaining > 0
  }

  const q = quotaStore.getQuotaStatus(quotaKey.file(file.name))
  if (!q || q.status !== 'success') return false

  let items: any[] = []
  if (q.type === 'antigravity') {
    items = (q.data?.groups || []).filter((g: any) => !g.hideInTable)
  } else if (q.type === 'gemini-cli') {
    items = q.data?.buckets || []
  } else if (q.type === 'codex') {
    items = q.data?.limits || []
  }

  return items.some((item: any) => {
    const remainingRaw = item?.percent ?? item?.remaining
    const remaining = parseRemainingQuota(remainingRaw)
    return remaining !== null && remaining > 0
  })
}

// Filters
const {
  searchText,
  filterType,
  filterStatus,
  filterQueryStatus,
  filterUnavailable,
  availableTypes,
  availableStatuses,
  filteredData,
} = useAuthFileFilters(authFiles, {
  isQuotaQueryFailed: (file) => {
    if (!supportsQuota(file.type)) return false
    return quotaStore.getQuotaStatus(quotaKey.file(file.name))?.status === 'error'
  },
  isWeeklyQuotaExhausted,
  isHasQuota: hasQuotaRemaining
})

type AuthSortKey = 'name' | 'type' | 'size' | 'status'

const sortKey = ref<AuthSortKey | ''>('')
const sortOrder = ref<'asc' | 'desc'>('asc')
const sortCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

const toggleSort = (key: AuthSortKey) => {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = 'asc'
  }
}

const getSortValue = (file: any, key: AuthSortKey) => {
  switch (key) {
    case 'name':
      return file.name ?? ''
    case 'type':
      return file.type ?? ''
    case 'size':
      return file.size ?? 0
    case 'status':
      return file.status ?? ''
    default:
      return ''
  }
}

const compareSortValues = (a: any, b: any) => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return sortCollator.compare(String(a), String(b))
}

const sortedData = computed(() => {
  const data = filteredData.value.slice()
  if (!sortKey.value) return data
  const key = sortKey.value
  const dir = sortOrder.value === 'asc' ? 1 : -1
  return data.sort((a, b) => {
    const primary = compareSortValues(getSortValue(a, key), getSortValue(b, key))
    if (primary !== 0) return primary * dir
    return sortCollator.compare(String(a.name ?? ''), String(b.name ?? ''))
  })
})

// Shared composables
const { currentPage, pageSize, pageSizeOptions, totalItems, totalPages, paginatedData } = usePagination(sortedData, {
  defaultPageSize: 30,
  pageSizeOptions: [30, 50, 100, 200],
  resetWatchers: [searchText, filterType, filterStatus, filterQueryStatus, filterUnavailable, sortKey, sortOrder]
})

const { selectedItems: selectedFiles, allSelected, isSelected, toggleSelection, toggleSelectAll, clearSelection } = useTableSelection(paginatedData)

const usageStore = useUsageStore()
const usageDetails = computed(() => usageStore.usageDetails)

// Local State
const batchLoading = ref(false)
const refreshAllQuotaLoading = ref(false)
const uploadLoading = ref(false)
const zipImportLoading = ref(false)
const modelsLoading = ref(false)
const editLoading = ref(false)
const saveLoading = ref(false)
const toggleLoading = reactive<Record<string, boolean>>({})
const deleteLoading = reactive<Record<string, boolean>>({})

const showUploadDialog = ref(false)
const showModelsDialog = ref(false)
const showEditDialog = ref(false)
const showBatchFieldEditor = ref(false)
const showQuotaDialog = ref(false)
const showStatusDialog = ref(false)
const currentModels = ref<any[]>([])
const editingFile = ref<any>(null)
const editContent = ref('')
const quotaFile = ref<any>(null)
const statusDialogFile = ref<any>(null)
const uploadFiles = ref<File[]>([])
const uploadInputRef = ref<HTMLInputElement | null>(null)
const zipInputRef = ref<HTMLInputElement | null>(null)

// Computed
const hasQuotaSupportedFiles = computed(() => {
  return selectedFiles.value.some((file: any) => supportsQuota(file.type))
})

// Methods
const handleToggleStatus = async (row: any) => {
  toggleLoading[row.name] = true
  try {
    await setStatusApi(row.name, !row.disabled)
    quotaStore.clearQuota(quotaKey.file(row.name))
  } catch (error: any) {
    notificationStore.error('操作失败: ' + error.message)
  } finally {
    delete toggleLoading[row.name]
  }
}

const handleBatchAction = async (action: 'enable' | 'disable' | 'delete') => {
  const names = selectedFiles.value.map((f: any) => f.name)
  if (!names.length) return

  if (action === 'delete') {
    const confirmed = await notificationStore.showConfirmation({
      title: '批量删除',
      message: `确定要删除选中的 ${names.length} 个文件吗？`,
      variant: 'danger'
    })
    if (!confirmed) return
  }

  batchLoading.value = true
  try {
    if (action === 'enable') {
      await batchSetStatusApi(names, false)
    } else if (action === 'disable') {
      await batchSetStatusApi(names, true)
    } else if (action === 'delete') {
      await batchDeleteApi(names)
    }
    selectedFiles.value = []
    notificationStore.success('批量操作成功')
  } catch (error: any) {
    notificationStore.error('批量操作失败: ' + error.message)
  } finally {
    batchLoading.value = false
  }
}

const handleBatchFieldEditSuccess = async () => {
  await loadAuthFiles()
  selectedFiles.value = []
}

const handleRemoveSelectedFile = (name: string) => {
  selectedFiles.value = selectedFiles.value.filter((file: any) => file.name !== name)
}

const resetUploadSelection = () => {
  uploadFiles.value = []
  if (uploadInputRef.value) {
    uploadInputRef.value.value = ''
  }
}

const handleUploadDialogOpenChange = (open: boolean) => {
  showUploadDialog.value = open
  if (!open) {
    resetUploadSelection()
  }
}

const toUploadCandidates = (files: File[]) => {
  return files.filter((file) => file.name.toLowerCase().endsWith('.json'))
}

const dedupeUploadFiles = (files: File[]) => {
  const existing = new Set(
    authFiles.value.map((file: any) => String(file.name || '').trim().toLowerCase())
  )
  const seen = new Set<string>()
  const uniqueFiles: File[] = []
  const skippedNames: string[] = []

  for (const file of files) {
    const key = file.name.trim().toLowerCase()
    if (!key) continue
    if (existing.has(key) || seen.has(key)) {
      skippedNames.push(file.name)
      continue
    }
    seen.add(key)
    uniqueFiles.push(file)
  }

  return {
    uniqueFiles,
    skippedNames: Array.from(new Set(skippedNames))
  }
}

const formatNamePreview = (names: string[], limit = 5) => {
  if (names.length <= limit) return names.join('、')
  return `${names.slice(0, limit).join('、')} 等 ${names.length} 个`
}

interface UploadSummary {
  successCount: number
  skippedCount: number
  failedCount: number
  totalCandidates: number
}

const uploadFilesWithDedup = async (
  files: File[],
  options: { silent?: boolean } = {}
): Promise<UploadSummary> => {
  const silent = !!options.silent
  const candidates = toUploadCandidates(files)
  if (candidates.length === 0) {
    if (!silent) {
      notificationStore.warning('没有可导入的 JSON 文件')
    }
    return { successCount: 0, skippedCount: 0, failedCount: 0, totalCandidates: 0 }
  }

  const { uniqueFiles, skippedNames } = dedupeUploadFiles(candidates)
  if (uniqueFiles.length === 0) {
    if (!silent) {
      notificationStore.warning(`全部文件已去重跳过：${formatNamePreview(skippedNames)}`)
    }
    return {
      successCount: 0,
      skippedCount: skippedNames.length,
      failedCount: 0,
      totalCandidates: candidates.length
    }
  }

  const failed: string[] = []
  let successCount = 0

  for (const file of uniqueFiles) {
    try {
      await authFilesApi.upload(file)
      quotaStore.clearQuota(quotaKey.file(file.name))
      successCount += 1
    } catch (error: any) {
      failed.push(`${file.name}(${error.message || '上传失败'})`)
    }
  }

  if (successCount > 0) {
    await loadAuthFiles()
  }

  const summary: string[] = [`成功 ${successCount}`]
  if (skippedNames.length > 0) summary.push(`去重跳过 ${skippedNames.length}`)
  if (failed.length > 0) summary.push(`失败 ${failed.length}`)

  if (failed.length > 0) {
    if (!silent) {
      notificationStore.error(`导入完成：${summary.join('，')}。${formatNamePreview(failed, 3)}`)
    }
    return {
      successCount,
      skippedCount: skippedNames.length,
      failedCount: failed.length,
      totalCandidates: candidates.length
    }
  }

  if (!silent) {
    notificationStore.success(`导入完成：${summary.join('，')}`)
  }
  return {
    successCount,
    skippedCount: skippedNames.length,
    failedCount: 0,
    totalCandidates: candidates.length
  }
}

const handleUploadChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  uploadFiles.value = target.files ? Array.from(target.files) : []
}

const handleUpload = async () => {
  if (uploadFiles.value.length === 0) {
    notificationStore.warning('请选择文件')
    return
  }

  uploadLoading.value = true
  try {
    const result = await uploadFilesWithDedup(uploadFiles.value)
    if (result.totalCandidates > 0 && result.failedCount === 0) {
      handleUploadDialogOpenChange(false)
    }
  } catch (error: any) {
    notificationStore.error('上传失败: ' + error.message)
  } finally {
    uploadLoading.value = false
  }
}

const openZipImportPicker = () => {
  zipInputRef.value?.click()
}

const extractJsonFilesFromZip = async (zipFile: File): Promise<File[]> => {
  const zip = await JSZip.loadAsync(zipFile)
  const extractedFiles: File[] = []

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir || !entryPath.toLowerCase().endsWith('.json')) continue

    const fileName = entryPath.split('/').pop()?.trim()
    if (!fileName) continue

    const content = await entry.async('uint8array')
    const normalizedContent = new Uint8Array(content.byteLength)
    normalizedContent.set(content)
    extractedFiles.push(new File([normalizedContent], fileName, { type: 'application/json' }))
  }

  return extractedFiles
}

const handleZipImportChange = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const zipFile = target.files?.[0]
  target.value = ''
  if (!zipFile) return

  if (!zipFile.name.toLowerCase().endsWith('.zip')) {
    notificationStore.warning('请选择 zip 压缩包文件')
    return
  }

  zipImportLoading.value = true
  try {
    notificationStore.info(`开始导入压缩包：${zipFile.name}`)
    const extractedFiles = await extractJsonFilesFromZip(zipFile)
    if (extractedFiles.length === 0) {
      notificationStore.warning('压缩包中未找到 JSON 认证文件')
      return
    }

    const result = await uploadFilesWithDedup(extractedFiles, { silent: true })
    const summary = `压缩包导入完成：提取 ${extractedFiles.length} 个，成功 ${result.successCount}，去重跳过 ${result.skippedCount}，失败 ${result.failedCount}`
    if (result.failedCount > 0) {
      notificationStore.error(summary, 6000)
    } else if (result.successCount === 0) {
      notificationStore.warning(summary, 5000)
    } else {
      notificationStore.success(summary, 5000)
    }
  } catch (error: any) {
    notificationStore.error('导入压缩包失败: ' + error.message)
  } finally {
    zipImportLoading.value = false
  }
}

const handleDownload = async (row: any) => {
  try {
    const blob = await authFilesApi.download(row.name)
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = row.name
    link.click()
    window.URL.revokeObjectURL(url)
  } catch (error: any) {
    notificationStore.error('下载失败: ' + error.message)
  }
}

const handleBatchDownload = async () => {
  const targets = selectedFiles.value
  if (!targets.length) return

  const confirmed = await notificationStore.showConfirmation({
    title: '批量下载',
    message: `将下载选中的 ${targets.length} 个 JSON 文件，浏览器可能会提示多个下载确认，是否继续？`,
    variant: 'primary'
  })
  if (!confirmed) return

  batchLoading.value = true
  const failed: string[] = []
  try {
    for (const file of targets) {
      try {
        const blob = await authFilesApi.download(file.name)
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        link.click()
        window.URL.revokeObjectURL(url)
        await new Promise(resolve => setTimeout(resolve, 80))
      } catch (error: any) {
        failed.push(file.name)
      }
    }
    if (failed.length > 0) {
      notificationStore.error(`下载失败 ${failed.length} 个文件：${failed.join(', ')}`)
    } else {
      notificationStore.success(`已开始下载 ${targets.length} 个文件`)
    }
  } finally {
    batchLoading.value = false
  }
}

const handleDelete = async (row: any) => {
  if (deleteLoading[row.name]) return

  const confirmed = await notificationStore.showConfirmation({
    title: '删除文件',
    message: `确定要删除 "${row.name}" 吗？`,
    variant: 'danger'
  })
  if (!confirmed) return

  deleteLoading[row.name] = true
  try {
    await deleteFileApi(row.name)
    quotaStore.clearQuota(quotaKey.file(row.name))
    notificationStore.success('删除成功')
  } catch (error: any) {
    notificationStore.error('删除失败: ' + error.message)
  } finally {
    delete deleteLoading[row.name]
  }
}

const handleViewModels = async (row: any) => {
  showModelsDialog.value = true
  modelsLoading.value = true
  try {
    const response = await authFilesApi.getModels(row.name)
    currentModels.value = response.models || []
  } catch (error: any) {
    currentModels.value = []
    notificationStore.error('获取模型失败: ' + error.message)
  } finally {
    modelsLoading.value = false
  }
}

const handleEdit = async (row: any) => {
  editingFile.value = row
  showEditDialog.value = true
  editLoading.value = true
  editContent.value = ''
  try {
    const blob = await authFilesApi.download(row.name)
    const text = await blob.text()
    try {
      const json = JSON.parse(text)
      editContent.value = JSON.stringify(json, null, 2)
    } catch {
      editContent.value = text
    }
  } catch (error: any) {
    notificationStore.error('加载文件失败: ' + error.message)
    showEditDialog.value = false
  } finally {
    editLoading.value = false
  }
}

const handleSaveEdit = async () => {
  if (!editingFile.value) return
  try {
    JSON.parse(editContent.value)
  } catch (error: any) {
    notificationStore.error('JSON 格式无效: ' + error.message)
    return
  }
  saveLoading.value = true
  try {
    const blob = new Blob([editContent.value], { type: 'application/json' })
    const file = new File([blob], editingFile.value.name, { type: 'application/json' })
    await authFilesApi.upload(file)
    quotaStore.clearQuota(quotaKey.file(editingFile.value.name))
    showEditDialog.value = false
    editingFile.value = null
    editContent.value = ''
    await loadAuthFiles()
  } catch (error: any) {
    notificationStore.error('保存失败: ' + error.message)
  } finally {
    saveLoading.value = false
  }
}

const handleViewQuota = (row: any) => {
  quotaFile.value = row
  showQuotaDialog.value = true
}

const handleBatchRefreshQuota = async () => {
  const targets = selectedFiles.value.filter((f: any) => supportsQuota(f.type))
  if (targets.length === 0) return

  batchLoading.value = true
  try {
    await loadQuota(targets, { force: true })
  } finally {
    batchLoading.value = false
  }
}

const handleRefreshAllQuota = async () => {
  const targets = authFiles.value.filter((f: any) => supportsQuota(f.type))
  if (targets.length === 0) {
    notificationStore.warning('没有支持配额查询的文件')
    return
  }

  refreshAllQuotaLoading.value = true
  try {
    await loadQuota(targets, { force: true })
    notificationStore.success(`已刷新 ${targets.length} 个文件的配额`)
  } finally {
    refreshAllQuotaLoading.value = false
  }
}

const formatFileSize = (bytes: number) => {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const resolvePlanType = (file: any): string | null => {
  const candidates = [
    file.plan_type,
    file.planType,
    file.id_token?.plan_type,
    file.id_token?.planType,
    file.metadata?.plan_type,
    file.metadata?.planType,
    file.metadata?.id_token?.plan_type,
    file.metadata?.idToken?.planType,
    file.attributes?.plan_type,
    file.attributes?.planType
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toLowerCase()
    }
  }

  return null
}

const formatPlanTypeLabel = (planType: string) => {
  return planType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const getPlanBadgeClass = (planType: string) => {
  if (planType === 'free') return 'border-amber-400 text-amber-600 dark:text-amber-400'
  if (planType === 'team') return 'border-sky-400 text-sky-600 dark:text-sky-400'
  return 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
}

const handleShowStatusDialog = (file: any) => {
  statusDialogFile.value = file
  showStatusDialog.value = true
}

const getQuotaKey = (file: any) => quotaKey.file(file.name)

const getQuotaItems = (fileName: string): { name: string; percent: number | null; resetTime?: number | string }[] => {
  const q = quotaStore.getQuotaStatus(quotaKey.file(fileName))
  if (!q || q.status !== 'success') return []
  if (q.type === 'antigravity') {
    return (q.data?.groups || []).filter((g: any) => !g.hideInTable).map((g: any) => ({ name: g.name, percent: g.percent, resetTime: g.resetTime }))
  }
  if (q.type === 'gemini-cli') {
    return (q.data?.buckets || []).map((b: any) => ({ name: b.modelId, percent: b.percent, resetTime: b.resetTime }))
  }
  if (q.type === 'codex') {
    return (q.data?.limits || []).map((l: any) => ({ name: l.model, percent: l.percent, resetTime: l.resetTime }))
  }
  return []
}

const getBarColorClass = (percent: number) => {
  if (percent >= 50) return 'bg-green-500 dark:bg-green-400'
  if (percent >= 20) return 'bg-yellow-500 dark:bg-yellow-400'
  return 'bg-red-500 dark:bg-red-400'
}

const formatUpdatedAt = (timestamp: number | null) => {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

const getCacheInfo = (file: any) => {
  const key = getQuotaKey(file)
  const updatedAt = quotaStore.getUpdatedAt(key)
  if (!updatedAt) return null
  return {
    updatedAt,
    expired: quotaStore.isExpired(key)
  }
}

const getQuotaErrorText = (file: any) => {
  const error = quotaStore.getQuotaStatus(getQuotaKey(file))?.error
  return error || '查询失败'
}

// 生成可用性监控点
const getAvailabilityPoints = (file: any) => {
  const authIndex = file.auth_index ?? file.authIndex
  if (
    usageDetails.value.length > 0 &&
    authIndex !== undefined &&
    authIndex !== null &&
    authIndex !== ''
  ) {
    return generateAvailabilityPointsFromUsage(usageDetails.value, authIndex)
  }
  return []
}

onMounted(() => {
  loadAuthFiles()
  usageStore.fetchUsage()
  usageStore.startPolling()
})

let quotaPollTimer: ReturnType<typeof setInterval> | null = null

const stopQuotaAutoRefresh = () => {
  if (!quotaPollTimer) return
  clearInterval(quotaPollTimer)
  quotaPollTimer = null
}

const startQuotaAutoRefresh = (files: any[]) => {
  if (quotaPollTimer || files.length === 0) return
  void loadExpiredQuota(files)
  quotaPollTimer = setInterval(() => {
    void loadExpiredQuota(authFiles.value)
  }, 5 * 60 * 1000)
}

onUnmounted(() => {
  usageStore.stopPolling()
  stopQuotaAutoRefresh()
})

// Auto-refresh quota by policy when loop starts, then poll every 5 min
watch(authFiles, (files) => {
  if (files.length > 0) {
    quotaStore.pruneStaleEntries(files.map((f: any) => f.name))
    startQuotaAutoRefresh(files)
  } else {
    stopQuotaAutoRefresh()
  }
})
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="flex w-full sm:w-auto items-center gap-2 flex-wrap">
        <div class="relative w-full sm:w-64">
          <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            v-model="searchText"
            placeholder="搜索文件..."
            class="pl-8"
          />
        </div>
        <select
          v-model="filterType"
          class="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">所有类型</option>
          <option v-for="type in availableTypes" :key="type" :value="type">
            {{ getProviderDisplayName(type) }}
          </option>
        </select>
        <select
          v-model="filterStatus"
          class="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">所有状态</option>
          <option v-for="status in availableStatuses" :key="status" :value="status">
            {{ getStatusLabel(status) }}
          </option>
        </select>
        <select
          v-model="filterQueryStatus"
          class="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">配额状态</option>
          <option :value="AUTH_FILE_SPECIAL_STATUS.quotaQueryFailed">查询失败</option>
          <option :value="AUTH_FILE_SPECIAL_STATUS.weeklyQuotaExhausted">周限额已用完</option>
          <option :value="AUTH_FILE_SPECIAL_STATUS.hasQuota">有配额</option>
        </select>
        <select
          v-model="filterUnavailable"
          class="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">可用性</option>
          <option value="true">不可用</option>
          <option value="false">可用</option>
        </select>
        <Button variant="outline" size="icon" @click="loadAuthFiles" :disabled="loading" title="刷新列表">
          <RefreshCw :class="cn('h-4 w-4', loading && 'animate-spin')" />
        </Button>
      </div>
      <div class="flex w-full sm:w-auto items-center justify-end gap-2">
        <Button @click="showUploadDialog = true">
          <Upload class="mr-2 h-4 w-4" />
          上传文件
        </Button>
        <input
          ref="zipInputRef"
          type="file"
          accept=".zip,application/zip"
          class="hidden"
          @change="handleZipImportChange"
        />
        <Button variant="outline" @click="openZipImportPicker" :disabled="zipImportLoading">
          <Loader2 v-if="zipImportLoading" class="mr-2 h-4 w-4 animate-spin" />
          <Upload v-else class="mr-2 h-4 w-4" />
          导入压缩包
        </Button>
        <Button variant="outline" @click="handleRefreshAllQuota" :disabled="refreshAllQuotaLoading">
          <RefreshCw :class="cn('mr-2 h-4 w-4', refreshAllQuotaLoading && 'animate-spin')" />
          刷新所有额度
        </Button>
      </div>
    </div>

    <!-- Batch Actions (floating bottom bar) -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-full opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-full opacity-0"
      >
        <div v-if="selectedFiles.length > 0" class="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg p-2 px-5">
          <div class="text-sm text-muted-foreground whitespace-nowrap">
            已选择 <strong>{{ selectedFiles.length }}</strong> 项
            <button class="ml-2 text-primary hover:underline" @click="clearSelection">清除</button>
          </div>
          <div class="h-4 w-px bg-border" />
          <div class="flex items-center gap-1.5">
            <Button size="sm" variant="outline" @click="showBatchFieldEditor = true" :disabled="batchLoading">
              <Edit class="mr-1.5 h-3.5 w-3.5" />
              批量修改
            </Button>
            <Button size="sm" variant="outline" @click="handleBatchDownload" :disabled="batchLoading">
              <Download class="mr-1.5 h-3.5 w-3.5" />
              批量下载
            </Button>
            <Button size="sm" variant="outline" v-if="hasQuotaSupportedFiles" @click="handleBatchRefreshQuota" :disabled="batchLoading">
              <RefreshCw class="mr-1.5 h-3.5 w-3.5" />
              刷新配额
            </Button>
            <Button size="sm" variant="outline" @click="handleBatchAction('enable')" :disabled="batchLoading">
              <Check class="mr-1.5 h-3.5 w-3.5" />
              启用
            </Button>
            <Button size="sm" variant="outline" @click="handleBatchAction('disable')" :disabled="batchLoading">
              <X class="mr-1.5 h-3.5 w-3.5" />
              禁用
            </Button>
            <Button size="sm" variant="destructive" @click="handleBatchAction('delete')" :disabled="batchLoading">
              <Trash2 class="mr-1.5 h-3.5 w-3.5" />
              删除
            </Button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Table -->
    <div class="rounded-md border bg-card">
      <Table class="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead class="w-[40px]">
              <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" class="translate-y-[2px] accent-primary" />
            </TableHead>
            <TableHead class="w-[160px]">
              <button type="button" class="group inline-flex items-center gap-1 select-none" @click="toggleSort('name')">
                <span>文件名</span>
                <ArrowUpDown v-if="sortKey !== 'name'" class="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-muted-foreground" />
                <ArrowUp v-else-if="sortOrder === 'asc'" class="h-3.5 w-3.5" />
                <ArrowDown v-else class="h-3.5 w-3.5" />
              </button>
            </TableHead>
            <TableHead class="w-[80px]">
              <button type="button" class="group inline-flex items-center gap-1 select-none" @click="toggleSort('type')">
                <span>类型</span>
                <ArrowUpDown v-if="sortKey !== 'type'" class="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-muted-foreground" />
                <ArrowUp v-else-if="sortOrder === 'asc'" class="h-3.5 w-3.5" />
                <ArrowDown v-else class="h-3.5 w-3.5" />
              </button>
            </TableHead>
            <TableHead class="w-[70px]">
              <button type="button" class="group inline-flex items-center gap-1 select-none" @click="toggleSort('size')">
                <span>大小</span>
                <ArrowUpDown v-if="sortKey !== 'size'" class="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-muted-foreground" />
                <ArrowUp v-else-if="sortOrder === 'asc'" class="h-3.5 w-3.5" />
                <ArrowDown v-else class="h-3.5 w-3.5" />
              </button>
            </TableHead>
            <TableHead class="w-[80px]">
              <button type="button" class="group inline-flex items-center gap-1 select-none" @click="toggleSort('status')">
                <span>状态</span>
                <ArrowUpDown v-if="sortKey !== 'status'" class="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-muted-foreground" />
                <ArrowUp v-else-if="sortOrder === 'asc'" class="h-3.5 w-3.5" />
                <ArrowDown v-else class="h-3.5 w-3.5" />
              </button>
            </TableHead>
            <TableHead class="w-[240px]">配额</TableHead>
            <TableHead class="w-[160px]">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="loading && authFiles.length === 0">
             <TableCell colspan="7" class="h-24 text-center">
                <Loader2 class="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
             </TableCell>
          </TableRow>
          <TableRow v-else-if="filteredData.length === 0">
             <TableCell colspan="7" class="h-24 text-center text-muted-foreground">
                没有找到文件。
             </TableCell>
          </TableRow>
          <TableRow v-for="file in paginatedData" :key="file.name">
            <TableCell>
              <input type="checkbox" :checked="isSelected(file)" @change="toggleSelection(file)" class="translate-y-[2px] accent-primary" />
            </TableCell>
            <TableCell>
              <div class="flex flex-col gap-1.5">
                <!-- 第一行：文件名信息 -->
                <div class="flex items-center gap-2">
                  <AlertCircle
                    v-if="file.unavailable"
                    class="h-4 w-4 text-orange-500 dark:text-orange-400 flex-shrink-0"
                    :title="`不可用: ${file.status_message || '临时不可用'}`"
                  />
                  <FileText v-else class="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span class="font-medium text-foreground truncate">{{ file.name }}</span>
                  <Badge v-if="file.runtime_only || file.runtimeOnly" variant="secondary" class="text-[10px] px-1 py-0 h-4 flex-shrink-0">Runtime</Badge>
                  <Badge
                    v-if="resolvePlanType(file)"
                    variant="outline"
                    class="text-[10px] px-1 py-0 h-4 flex-shrink-0"
                    :class="getPlanBadgeClass(resolvePlanType(file) || '')"
                  >
                    {{ formatPlanTypeLabel(resolvePlanType(file) || '') }}
                  </Badge>
                  <!-- 属性图标 -->
                  <!-- <FileAttributeIcons :file-name="file.name" :max-display="3" /> --> <!-- 暂时关闭：每个配置需要独立请求 -->
                </div>
                <!-- 第二行：可用性监控 -->
                <AvailabilityMonitor :points="getAvailabilityPoints(file)" :compact="true" :show-stats="true" />
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline" class="font-normal">{{ file.type }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground text-sm font-mono">
              {{ formatFileSize(file.size) }}
            </TableCell>
            <TableCell class="w-[80px]">
              <div class="flex flex-col items-start gap-1">
                <Tooltip v-if="file.status_message" :content="file.status_message">
                  <div class="flex items-center gap-1">
                    <Badge
                      :variant="getStatusVariant(file.status)"
                      class="cursor-pointer hover:opacity-80 transition-opacity"
                      @click="handleShowStatusDialog(file)"
                    >
                      {{ getStatusLabel(file.status) }}
                    </Badge>
                    <Info
                      class="h-3.5 w-3.5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      @click="handleShowStatusDialog(file)"
                      title="点击查看详情"
                    />
                  </div>
                </Tooltip>
                <Badge
                  v-else
                  :variant="getStatusVariant(file.status)"
                  class="cursor-default"
                >
                  {{ getStatusLabel(file.status) }}
                </Badge>
                <Badge
                  v-if="supportsQuota(file.type) && getCacheInfo(file)"
                  variant="outline"
                  :class="getCacheInfo(file)?.expired
                    ? 'text-[10px] px-1.5 py-0 h-4 font-normal border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400'
                    : 'text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground'"
                >
                  {{ formatUpdatedAt(getCacheInfo(file)?.updatedAt || null) }}
                  <template v-if="getCacheInfo(file)?.expired"> 待更新</template>
                </Badge>
              </div>
            </TableCell>
            <TableCell class="w-[240px]">
               <div v-if="supportsQuota(file.type)" @click="handleViewQuota(file)" class="cursor-pointer hover:opacity-80 w-full max-w-full min-w-0 overflow-hidden">
                  <div v-if="quotaStore.isLoading(getQuotaKey(file)) && quotaStore.getQuotaStatus(getQuotaKey(file))?.status === 'loading'" class="flex items-center gap-1 text-xs text-muted-foreground">
                     <Loader2 class="h-3 w-3 animate-spin" /> 查询中...
                  </div>
                  <div v-else-if="quotaStore.getQuotaStatus(getQuotaKey(file))?.status === 'success' || (quotaStore.isLoading(getQuotaKey(file)) && getQuotaItems(file.name).length > 0)">
                     <div :class="getQuotaItems(file.name).length <= 3 ? 'columns-1' : getQuotaItems(file.name).length <= 6 ? 'columns-2' : 'columns-3'" class="gap-x-3 text-xs" :style="{ columnFill: 'auto', maxHeight: (Math.min(getQuotaItems(file.name).length, 3) * 1.75) + 'rem' }">
                        <div v-for="item in getQuotaItems(file.name)" :key="item.name" class="break-inside-avoid mb-1">
                           <div class="flex items-center justify-between gap-1 whitespace-nowrap">
                              <span class="min-w-0 flex-1 truncate text-muted-foreground" :title="item.name">{{ item.name }}</span>
                              <span v-if="item.percent === 0 && item.resetTime" class="font-medium text-[11px] text-red-600 dark:text-red-400">{{ formatResetTime(item.resetTime) }}</span>
                              <span v-else :class="getQuotaPercentClass(item.percent ?? 0)" class="font-medium tabular-nums text-[11px]">{{ item.percent ?? '?' }}%</span>
                           </div>
                           <div v-if="item.percent !== null" class="h-1 w-full rounded-full bg-muted overflow-hidden mt-0.5">
                              <div :class="getBarColorClass(item.percent)" class="h-full rounded-full transition-all" :style="{ width: `${item.percent === 0 ? 100 : item.percent}%` }" />
                           </div>
                        </div>
                     </div>
                  </div>
                  <div v-else-if="quotaStore.getQuotaStatus(getQuotaKey(file))?.status === 'error'" class="text-xs text-red-600 dark:text-red-400">
                     <span class="block max-w-full truncate" :title="getQuotaErrorText(file)">{{ getQuotaErrorText(file) }}</span>
                  </div>
                  <div v-else class="text-xs text-muted-foreground italic">
                     点击查询
                  </div>
               </div>
               <div v-else class="text-xs text-muted-foreground">-</div>
            </TableCell>
            <TableCell>
              <div class="flex flex-col gap-1">
                <!-- 第一行操作 -->
                <div class="flex items-center gap-1">
                  <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" @click="handleToggleStatus(file)" :disabled="toggleLoading[file.name]">
                    {{ file.disabled ? '启用' : '禁用' }}
                  </Button>
                  <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" @click="handleEdit(file)">
                    编辑
                  </Button>
                  <Button v-if="supportsQuota(file.type)" size="sm" variant="ghost" class="h-6 px-2 text-xs" @click="handleViewQuota(file)">
                    配额
                  </Button>
                </div>
                <!-- 第二行操作 -->
                <div class="flex items-center gap-1">
                  <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" @click="handleDownload(file)">
                    下载
                  </Button>
                  <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" @click="handleViewModels(file)">
                    模型
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    @click="handleDelete(file)"
                    :disabled="deleteLoading[file.name]"
                  >
                    <Loader2 v-if="deleteLoading[file.name]" class="h-3 w-3 animate-spin" />
                    <span v-else>删除</span>
                  </Button>
                </div>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Pagination -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4 py-2" v-if="totalItems > 0">
      <div class="text-sm text-muted-foreground">
        显示 {{ (currentPage - 1) * pageSize + 1 }} 到 {{ Math.min(currentPage * pageSize, totalItems) }} 共 {{ totalItems }} 项
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">每页:</span>
          <select
            v-model="pageSize"
            class="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
          </select>
        </div>
        
        <div class="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8"
            :disabled="currentPage === 1"
            @click="currentPage = 1"
          >
            <ChevronsLeft class="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8"
            :disabled="currentPage === 1"
            @click="currentPage--"
          >
            <ChevronLeft class="h-4 w-4" />
          </Button>
          
          <div class="flex items-center gap-1 px-2">
             <span class="text-sm font-medium">{{ currentPage }}</span>
             <span class="text-sm text-muted-foreground">/ {{ totalPages }}</span>
          </div>

          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8"
            :disabled="currentPage === totalPages"
            @click="currentPage++"
          >
            <ChevronRight class="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8"
            :disabled="currentPage === totalPages"
            @click="currentPage = totalPages"
          >
            <ChevronsRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Upload Dialog -->
    <Dialog
      :open="showUploadDialog"
      @update:open="handleUploadDialogOpenChange"
      title="上传文件"
      description="支持多选 JSON 文件，导入时会自动去重。"
    >
      <div class="grid gap-4 py-4">
        <div class="grid w-full max-w-sm items-center gap-1.5">
          <input
            id="file"
            ref="uploadInputRef"
            type="file"
            accept=".json,application/json"
            multiple
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            @change="handleUploadChange"
          />
          <div class="text-xs text-muted-foreground">
            已选择 {{ uploadFiles.length }} 个文件；重复文件（同名）将自动跳过
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="handleUploadDialogOpenChange(false)">取消</Button>
        <Button @click="handleUpload" :disabled="uploadLoading || uploadFiles.length === 0">
          <Loader2 v-if="uploadLoading" class="mr-2 h-4 w-4 animate-spin" />
          {{ uploadFiles.length > 1 ? `上传 ${uploadFiles.length} 个文件` : '上传' }}
        </Button>
      </div>
    </Dialog>

    <!-- Models Dialog -->
    <Dialog :open="showModelsDialog" @update:open="showModelsDialog = $event" title="可用模型">
      <div class="py-4 max-h-[60vh] overflow-y-auto">
         <div v-if="modelsLoading" class="flex justify-center py-4">
            <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
         </div>
         <div v-else-if="currentModels.length === 0" class="text-center text-muted-foreground">
            无可用模型。
         </div>
         <div v-else class="flex flex-wrap gap-2">
            <Badge v-for="model in currentModels" :key="model.id" variant="secondary">
               {{ model.display_name || model.id }}
            </Badge>
         </div>
      </div>
      <div class="flex justify-end">
         <Button variant="outline" @click="showModelsDialog = false">关闭</Button>
      </div>
    </Dialog>

    <!-- Edit Dialog -->
    <Dialog :open="showEditDialog" @update:open="showEditDialog = $event" :title="`编辑 ${editingFile?.name}`" class="max-w-4xl w-full">
       <div class="py-4 h-[60vh]">
          <textarea
            v-model="editContent"
            class="h-full w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-none"
            placeholder="请输入 JSON 内容..."
            spellcheck="false"
          ></textarea>
       </div>
       <div class="flex justify-end gap-2">
         <Button variant="outline" @click="showEditDialog = false">取消</Button>
         <Button @click="handleSaveEdit" :disabled="saveLoading">
           <Loader2 v-if="saveLoading" class="mr-2 h-4 w-4 animate-spin" />
           保存
         </Button>
       </div>
    </Dialog>

    <!-- Batch Field Editor -->
    <BatchFieldEditor
      v-model="showBatchFieldEditor"
      :files="selectedFiles"
      @remove="handleRemoveSelectedFile"
      @success="handleBatchFieldEditSuccess"
    />

    <!-- Quota Dialog -->
    <QuotaDialog
      v-model="showQuotaDialog"
      :file="quotaFile"
    />

    <!-- Status Message Dialog -->
    <Dialog :open="showStatusDialog" @update:open="showStatusDialog = $event" :title="`${statusDialogFile?.name} - 状态详情`" class="max-w-2xl w-full">
      <div class="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-muted-foreground">状态</span>
            <Badge :variant="getStatusVariant(statusDialogFile?.status || '')">
              {{ getStatusLabel(statusDialogFile?.status || '') }}
            </Badge>
          </div>
          <div v-if="statusDialogFile?.unavailable" class="flex items-center justify-between">
            <span class="text-sm font-medium text-muted-foreground">可用性</span>
            <Badge variant="destructive">不可用</Badge>
          </div>
          <div v-if="statusDialogFile?.disabled" class="flex items-center justify-between">
            <span class="text-sm font-medium text-muted-foreground">启用状态</span>
            <Badge variant="secondary">已禁用</Badge>
          </div>
        </div>
        <div v-if="statusDialogFile?.status_message" class="rounded-md bg-muted p-3 space-y-1">
          <div class="text-xs font-medium text-muted-foreground">状态消息</div>
          <div class="text-sm text-foreground break-words whitespace-pre-wrap">{{ statusDialogFile.status_message }}</div>
        </div>
        <div v-if="statusDialogFile?.email" class="text-sm break-words">
          <span class="font-medium text-muted-foreground">账户: </span>
          <span class="text-foreground">{{ statusDialogFile.email }}</span>
        </div>
      </div>
      <div class="flex justify-end">
        <Button variant="outline" @click="showStatusDialog = false">关闭</Button>
      </div>
    </Dialog>

  </div>
</template>
