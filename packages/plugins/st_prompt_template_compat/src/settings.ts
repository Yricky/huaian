import { installHaExtApi } from '@huaian/plugin-api/client'
import type { JsonRecord } from '@huaian/plugin-api'
import './settings.css'

const api = installHaExtApi()
const defaults = { enabled: true, renderMessages: true, globalVariables: {} }

function element<T extends HTMLElement>(id: string): T {
  const item = document.getElementById(id)
  if (!item) throw new Error(`Missing element #${id}`)
  return item as T
}

function setStatus(message: string, failed = false): void {
  const status = element<HTMLParagraphElement>('status')
  status.textContent = message
  status.className = failed ? 'status error' : 'status'
}

async function boot(): Promise<void> {
  const config = await api.storage.readJson('config.json', defaults) as JsonRecord
  element<HTMLInputElement>('enabled').checked = config.enabled !== false
  element<HTMLInputElement>('renderMessages').checked = config.renderMessages !== false
  element<HTMLTextAreaElement>('globals').value = JSON.stringify(config.globalVariables || {}, null, 2)
}

element<HTMLButtonElement>('save').addEventListener('click', async () => {
  try {
    const config = {
      enabled: element<HTMLInputElement>('enabled').checked,
      renderMessages: element<HTMLInputElement>('renderMessages').checked,
      globalVariables: JSON.parse(element<HTMLTextAreaElement>('globals').value || '{}')
    }
    await api.storage.writeJson('config.json', config)
    setStatus('设置已保存')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true)
  }
})

void boot().catch(error => setStatus(error instanceof Error ? error.message : String(error), true))
