import type { JsonRecordValue, ProjectConfig } from '../../shared/types'
import { asRecord } from '@huaian/app-api/value-utils'

export { asRecord }

export function defaultProjectConfig(): ProjectConfig {
  return {
    schemaVersion: 2
  }
}

export function toNumber(value: JsonRecordValue, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function normalizeProjectConfig(value: JsonRecordValue): ProjectConfig {
  const data = asRecord(value)
  return {
    schemaVersion: toNumber(data.schemaVersion, 2)
  }
}
