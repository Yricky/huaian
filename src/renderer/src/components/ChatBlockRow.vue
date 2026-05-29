<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MdCheck, MdClose, MdDeleteOutline, MdEdit, MdMoreVert, MdReplay, MdStop, MdVisibility, MdVisibilityOff } from 'vue-icons-plus/md'
import type { ChatBlock } from '../../../shared/types'
import MarkdownView from './MarkdownView.vue'

const props = defineProps<{
  block: ChatBlock
  frozen: boolean
}>()

const emit = defineEmits<{
  save: [block: ChatBlock]
  delete: [block: ChatBlock]
  regenerate: [block: ChatBlock]
  stop: [chatId: number]
}>()

const editing = ref(false)
const draft = ref('')
const detailOpen = ref(false)
const menuOpen = ref(false)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const text = computed(() => props.block.contentParts.map(part => part.text).join(''))
const roleLabel = computed(() => {
  if (props.block.kind === 'system') return 'system'
  if (props.block.kind === 'assistant') return 'assistant'
  if (props.block.kind === 'injection') return `injection → ${props.block.targetRole}`
  return 'user'
})
const isEmptySystem = computed(() => props.block.kind === 'system' && text.value.trim().length === 0)
const canEdit = computed(() => !props.frozen && props.block.status !== 'generating')
const showMarkdown = computed(() => !editing.value && !isEmptySystem.value && props.block.kind !== 'injection')

watch(() => props.block.id, () => {
  editing.value = false
  menuOpen.value = false
  draft.value = text.value
})

watch(text, (value) => {
  if (!editing.value) draft.value = value
}, { immediate: true })

watch(menuOpen, (open) => {
  if (open) {
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    nextTick(updateMenuPosition)
    return
  }

  removeMenuListeners()
})

onBeforeUnmount(() => {
  removeMenuListeners()
})

function removeMenuListeners() {
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('scroll', closeMenu, true)
}

function closeMenu() {
  menuOpen.value = false
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    nextTick(updateMenuPosition)
  }
}

function updateMenuPosition() {
  const button = menuButtonRef.value
  if (!button) return

  const rect = button.getBoundingClientRect()
  const width = 148
  const gap = 6
  const margin = 8
  const height = menuRef.value?.offsetHeight ?? 244
  const left = Math.min(
    window.innerWidth - width - margin,
    Math.max(margin, rect.right - width)
  )
  const preferredTop = rect.bottom + gap
  const top = preferredTop + height > window.innerHeight - margin
    ? Math.max(margin, rect.top - height - gap)
    : preferredTop

  menuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  }
}

function startEdit() {
  if (!canEdit.value) return
  draft.value = text.value
  editing.value = true
  menuOpen.value = false
}

function cancelEdit() {
  draft.value = text.value
  editing.value = false
  menuOpen.value = false
}

function saveEdit() {
  const next = JSON.parse(JSON.stringify(props.block)) as ChatBlock
  next.contentParts = [{ type: 'text', text: draft.value }]
  editing.value = false
  menuOpen.value = false
  emit('save', next)
}

function toggleEnabled() {
  if (!canEdit.value) return
  const next = JSON.parse(JSON.stringify(props.block)) as ChatBlock
  next.enabled = !next.enabled
  menuOpen.value = false
  emit('save', next)
}

function regenerate() {
  menuOpen.value = false
  emit('regenerate', props.block)
}

function stop() {
  menuOpen.value = false
  emit('stop', props.block.chatId)
}

function remove() {
  menuOpen.value = false
  emit('delete', props.block)
}

function openDetails() {
  menuOpen.value = false
  detailOpen.value = true
}
</script>

<template>
  <article class="chat-block" :class="[block.kind, block.status, { disabled: !block.enabled }]">
    <header class="chat-block-header">
      <div class="block-meta">
        <strong>{{ roleLabel }}</strong>
        <span v-if="block.status === 'generating'">生成中</span>
        <span v-else-if="block.status === 'stopped'">已停止</span>
        <span v-else-if="block.status === 'error'">生成失败</span>
        <span v-else-if="!block.enabled">不发送</span>
      </div>

      <div class="block-actions">
        <button ref="menuButtonRef" class="toolbar-button" type="button" aria-label="更多操作" data-tooltip="更多操作" @click.stop="toggleMenu">
          <MdMoreVert class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>
    </header>

    <textarea v-if="editing" v-model="draft" class="block-editor" rows="6" />
    <button v-else-if="isEmptySystem" class="system-hint" type="button" :disabled="!canEdit" @click="startEdit">
      点击可输入系统提示词
    </button>
    <button v-else-if="block.kind === 'injection'" class="injection-summary" type="button" @click="detailOpen = true">
      <strong>{{ block.title || '注入内容' }}</strong>
      <span>{{ block.summary || text.slice(0, 120) }}</span>
    </button>
    <MarkdownView v-else-if="showMarkdown" :markdown="text" />

    <footer v-if="block.errorText" class="block-footer">
      <button v-if="block.errorText" type="button" class="error-detail" @click="detailOpen = true">错误详情</button>
    </footer>

    <div v-if="detailOpen" class="block-dialog" role="dialog" aria-modal="true">
      <div class="block-dialog-panel">
        <header>
          <strong>块详情</strong>
          <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭" @click="detailOpen = false">
            <MdClose class="toolbar-icon" aria-hidden="true" />
          </button>
        </header>
        <pre>{{ JSON.stringify({
          id: block.id,
          kind: block.kind,
          targetRole: block.targetRole,
          enabled: block.enabled,
          status: block.status,
          requestBlockIds: block.requestBlockIds,
          llmInstanceSnapshot: block.llmInstanceSnapshot,
          errorText: block.errorText,
          content: text
        }, null, 2) }}</pre>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="menuOpen" ref="menuRef" class="block-menu" :style="menuStyle" @click.stop>
        <button v-if="editing" type="button" @click="saveEdit">
          <MdCheck class="menu-icon" aria-hidden="true" />保存
        </button>
        <button v-if="editing" type="button" @click="cancelEdit">
          <MdClose class="menu-icon" aria-hidden="true" />取消
        </button>
        <button v-if="block.status === 'generating'" type="button" @click="stop">
          <MdStop class="menu-icon" aria-hidden="true" />停止
        </button>
        <button v-if="!editing" type="button" :disabled="!canEdit" @click="toggleEnabled">
          <component :is="block.enabled ? MdVisibilityOff : MdVisibility" class="menu-icon" aria-hidden="true" />
          {{ block.enabled ? '禁用' : '启用' }}
        </button>
        <button v-if="block.kind === 'assistant' && block.status !== 'generating'" type="button" :disabled="frozen" @click="regenerate">
          <MdReplay class="menu-icon" aria-hidden="true" />重新生成
        </button>
        <button v-if="!editing" type="button" :disabled="!canEdit" @click="startEdit">
          <MdEdit class="menu-icon" aria-hidden="true" />编辑
        </button>
        <button type="button" @click="openDetails">
          <MdVisibility class="menu-icon" aria-hidden="true" />详情
        </button>
        <button class="danger-menu-item" type="button" :disabled="!canEdit" @click="remove">
          <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除
        </button>
      </div>
    </Teleport>
  </article>
</template>

<style scoped>
.chat-block {
  min-width: 0;
  max-width: 100%;
  display: grid;
  gap: 8px;
  overflow: visible;
  border-bottom: 1px solid #edf0f4;
  padding: 12px 14px;
  background: #ffffff;
}

.chat-block.disabled {
  opacity: 0.58;
}

.chat-block.system {
  background: #fbfcfd;
}

.chat-block.injection {
  background: #fffdf7;
}

.chat-block.error {
  background: #fff8f8;
}

.chat-block-header,
.block-footer {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.block-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.block-meta strong {
  color: #273245;
  font-size: 12px;
  text-transform: uppercase;
}

.block-meta span,
.block-footer button {
  color: #6b7583;
  font-size: 12px;
}

.block-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.block-menu {
  position: fixed;
  z-index: 120;
  display: grid;
  gap: 2px;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(32, 39, 49, 0.14);
}

.block-menu button {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #303a49;
  padding: 7px 8px;
  text-align: left;
  font-size: 12px;
}

.block-menu button:hover:not(:disabled) {
  background: #f1f5fa;
}

.block-menu button:disabled {
  cursor: default;
  opacity: 0.45;
}

.danger-menu-item {
  color: #9d2c2c !important;
}

.menu-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.block-editor {
  min-height: 130px;
}

.system-hint,
.injection-summary {
  width: 100%;
  border: 1px dashed #cdd6e2;
  border-radius: 8px;
  background: transparent;
  color: #6b7583;
  padding: 14px;
  text-align: left;
}

.injection-summary {
  display: grid;
  gap: 4px;
  border-style: solid;
}

.injection-summary strong {
  color: #4b3b12;
  font-size: 13px;
}

.injection-summary span {
  color: #7a6b43;
  font-size: 12px;
}

.block-footer {
  justify-content: flex-start;
}

.block-footer button {
  border: 1px solid #d8dee7;
  border-radius: 7px;
  background: #ffffff;
  padding: 4px 7px;
}

.error-detail {
  color: #9d2c2c !important;
}

.block-dialog {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: rgba(25, 31, 39, 0.34);
  padding: 24px;
}

.block-dialog-panel {
  width: min(760px, 92vw);
  max-height: min(720px, 86vh);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(26, 33, 42, 0.26);
}

.block-dialog-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #edf0f4;
  padding: 8px 10px;
}

.block-dialog-panel pre {
  overflow: auto;
  margin: 0;
  padding: 12px;
  font: 12px/1.5 "SF Mono", ui-monospace, Menlo, Monaco, monospace;
  white-space: pre-wrap;
}
</style>
