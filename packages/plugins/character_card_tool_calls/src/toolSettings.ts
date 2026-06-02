import { installHaExtApi } from '@st-forge/plugin-api/client'
import type { JsonRecord } from '@st-forge/plugin-api'
import './toolSettings.css'

const api = installHaExtApi({ toolSettings: true })

function element<T extends HTMLElement>(id: string): T {
  const item = document.getElementById(id)
  if (!item) throw new Error(`Missing element #${id}`)
  return item as T
}

function setError(error: unknown): void {
  const status = element<HTMLParagraphElement>('status')
  status.textContent = error instanceof Error ? error.message : String(error)
  status.className = 'status error'
}

async function boot(): Promise<void> {
  const files = await api.storage.listFor('silly_tavern_compat', 'worldbooks')
  const select = element<HTMLSelectElement>('worldBook')
  const options = files
    .filter(file => file.name.endsWith('.json'))
    .map(file => `<option value="${file.name}">${file.name}</option>`)
    .join('')
  select.innerHTML = `<option value="">未选择</option>${options}`
  const current = await api.toolSettings!.getCommonArgs() as JsonRecord
  select.value = typeof current.worldBookFile === 'string' ? current.worldBookFile : ''
  select.addEventListener('change', () => {
    void api.toolSettings!.setCommonArgs({ worldBookFile: select.value }).catch(setError)
  })
}

void boot().catch(setError)
