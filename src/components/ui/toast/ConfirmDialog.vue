<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification'
import Dialog from '../dialog/Dialog.vue'
import Button from '../Button.vue'

const notificationStore = useNotificationStore()
const confirmVisible = computed(() => notificationStore.confirm.visible)
const confirmOptions = computed(() => notificationStore.confirm.options)

const handleConfirm = () => {
  notificationStore.resolveConfirmation(true)
}

const handleCancel = () => {
  notificationStore.resolveConfirmation(false)
}

onMounted(() => {
  notificationStore.registerConfirmHost()
})

onUnmounted(() => {
  notificationStore.unregisterConfirmHost()
})
</script>

<template>
  <Dialog
    :open="confirmVisible"
    @update:open="(val) => !val && handleCancel()"
    :title="confirmOptions.title || '确认'"
  >
    <div class="py-4">
      <p class="text-sm text-foreground">
        {{ confirmOptions.message }}
      </p>
    </div>
    <div class="flex justify-end gap-2">
      <Button variant="outline" @click="handleCancel">
        {{ confirmOptions.cancelText || '取消' }}
      </Button>
      <Button
        :variant="confirmOptions.variant === 'danger' ? 'destructive' : 'default'"
        @click="handleConfirm"
      >
        {{ confirmOptions.confirmText || '确定' }}
      </Button>
    </div>
  </Dialog>
</template>
