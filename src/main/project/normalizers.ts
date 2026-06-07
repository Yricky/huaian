import type { JsonRecordValue, ProjectConfig } from '../../shared/types'
import { asBoolean, asRecord } from '@huaian/app-api/value-utils'

export { asRecord }

export function defaultProjectConfig(): ProjectConfig {
  return {
    schemaVersion: 2,
    debugMode: false
  }
}

export function toNumber(value: JsonRecordValue, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toBoolean(value: JsonRecordValue, fallback: boolean): boolean {
  return asBoolean(value, fallback)
}

export function normalizeProjectConfig(value: JsonRecordValue): ProjectConfig {
  const data = asRecord(value)
  return {
    schemaVersion: toNumber(data.schemaVersion, 2),
    debugMode: toBoolean(data.debugMode, false)
  }
}
