export interface AppThemeSourceColors {
  primaryBase?: string
  accentBase?: string
}

interface RgbColor {
  r: number
  g: number
  b: number
}

interface HslColor {
  h: number
  s: number
  l: number
}

type ThemeTokens = Record<string, string>

export const DEFAULT_APP_THEME_COLORS = {
  primaryBase: '#fefefe',
  accentBase: '#669955'
} satisfies Required<AppThemeSourceColors>

const STATUS_BASE_COLORS = {
  success: '#2f9d63',
  warning: '#c79a30',
  danger: '#c85656',
  info: '#2f6fca'
} as const

let currentThemeColors: Required<AppThemeSourceColors> = { ...DEFAULT_APP_THEME_COLORS }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseHexColor(value: string | undefined, fallback: RgbColor): RgbColor {
  const hex = value?.trim().replace(/^#/, '')
  if (!hex) return fallback
  const normalized = hex.length === 3
    ? hex.split('').map(char => `${char}${char}`).join('')
    : hex.length === 6
      ? hex
      : ''
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  }
}

function rgbToHex(color: RgbColor): string {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

function rgbToHsl(color: RgbColor): HslColor {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

function hslToRgb(color: HslColor): RgbColor {
  const h = ((color.h % 360) + 360) % 360
  const s = clamp(color.s, 0, 1)
  const l = clamp(color.l, 0, 1)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x]
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255
  }
}

function colorWithTone(base: HslColor, lightness: number, saturationScale = 1): string {
  return rgbToHex(hslToRgb({
    h: base.h,
    s: clamp(base.s * saturationScale, 0, 0.7),
    l: clamp(lightness, 0, 1)
  }))
}

function mix(a: RgbColor, b: RgbColor, bWeight: number): RgbColor {
  const weight = clamp(bWeight, 0, 1)
  return {
    r: a.r * (1 - weight) + b.r * weight,
    g: a.g * (1 - weight) + b.g * weight,
    b: a.b * (1 - weight) + b.b * weight
  }
}

function relativeLuminance(color: RgbColor): number {
  const linear = (value: number) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

function contrastRatio(a: RgbColor, b: RgbColor): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b))
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

function readableOn(background: RgbColor, light: string, dark: string): string {
  const lightRgb = parseHexColor(light, { r: 255, g: 255, b: 255 })
  const darkRgb = parseHexColor(dark, { r: 0, g: 0, b: 0 })
  return contrastRatio(background, lightRgb) >= contrastRatio(background, darkRgb) ? light : dark
}

function accentScale(baseColor: RgbColor, surfaceColor: RgbColor, isDark: boolean) {
  const base = rgbToHsl(baseColor)
  const solid = colorWithTone(base, isDark ? Math.max(base.l, 0.64) : Math.min(base.l, 0.48), 1.08)
  const solidRgb = parseHexColor(solid, baseColor)
  const solidHover = colorWithTone(base, isDark ? clamp(rgbToHsl(solidRgb).l + 0.08, 0, 1) : clamp(rgbToHsl(solidRgb).l - 0.08, 0, 1), 1.1)
  const text = colorWithTone(base, isDark ? 0.76 : 0.35, 1.15)
  return {
    solid,
    solidHover,
    text,
    soft: rgbToHex(mix(surfaceColor, solidRgb, isDark ? 0.24 : 0.1)),
    softHover: rgbToHex(mix(surfaceColor, solidRgb, isDark ? 0.32 : 0.16)),
    border: rgbToHex(mix(surfaceColor, solidRgb, isDark ? 0.46 : 0.3)),
    ring: `rgba(${Math.round(solidRgb.r)}, ${Math.round(solidRgb.g)}, ${Math.round(solidRgb.b)}, ${isDark ? 0.34 : 0.2})`,
    onSolid: readableOn(solidRgb, '#ffffff', '#111827')
  }
}

function statusScale(baseHex: string, surfaceColor: RgbColor, isDark: boolean) {
  const baseColor = parseHexColor(baseHex, { r: 47, g: 111, b: 202 })
  const scale = accentScale(baseColor, surfaceColor, isDark)
  return {
    solid: scale.solid,
    soft: scale.soft,
    softHover: scale.softHover,
    border: scale.border,
    text: scale.text,
    onSolid: scale.onSolid
  }
}

export function createAppThemeTokens(colors: AppThemeSourceColors = {}): ThemeTokens {
  const primaryBase = parseHexColor(colors.primaryBase, parseHexColor(DEFAULT_APP_THEME_COLORS.primaryBase, { r: 247, g: 248, b: 250 }))
  const accentBase = parseHexColor(colors.accentBase, parseHexColor(DEFAULT_APP_THEME_COLORS.accentBase, { r: 47, g: 111, b: 202 }))
  const primaryHsl = rgbToHsl(primaryBase)
  const isDark = relativeLuminance(primaryBase) < 0.35
  const surfaceBase = rgbToHex(primaryBase)
  const raised = isDark
    ? colorWithTone(primaryHsl, primaryHsl.l + 0.055, 1.08)
    : colorWithTone(primaryHsl, Math.max(primaryHsl.l + 0.025, 0.985), 0.6)
  const panel = isDark
    ? colorWithTone(primaryHsl, primaryHsl.l + 0.035, 1.06)
    : colorWithTone(primaryHsl, Math.max(primaryHsl.l + 0.012, 0.965), 0.75)
  const muted = isDark
    ? colorWithTone(primaryHsl, primaryHsl.l + 0.095, 1.1)
    : colorWithTone(primaryHsl, primaryHsl.l - 0.035, 0.8)
  const hover = isDark
    ? colorWithTone(primaryHsl, primaryHsl.l + 0.13, 1.1)
    : colorWithTone(primaryHsl, primaryHsl.l - 0.055, 0.9)
  const inset = isDark
    ? colorWithTone(primaryHsl, primaryHsl.l - 0.035, 1)
    : colorWithTone(primaryHsl, primaryHsl.l - 0.012, 0.7)
  const surfaceRgb = parseHexColor(panel, primaryBase)
  const accent = accentScale(accentBase, surfaceRgb, isDark)
  const success = statusScale(STATUS_BASE_COLORS.success, surfaceRgb, isDark)
  const warning = statusScale(STATUS_BASE_COLORS.warning, surfaceRgb, isDark)
  const danger = statusScale(STATUS_BASE_COLORS.danger, surfaceRgb, isDark)
  const info = statusScale(STATUS_BASE_COLORS.info, surfaceRgb, isDark)
  const inverseBg = isDark ? '#f8fafc' : '#30343a'
  const inverseText = isDark ? '#17202d' : '#ffffff'
  const syntaxSurface = isDark ? raised : panel
  const surfaceDisabled = isDark
    ? colorWithTone(primaryHsl, primaryHsl.l + 0.075, 0.7)
    : colorWithTone(primaryHsl, primaryHsl.l - 0.08, 0.45)
  const surfaceDisabledRgb = parseHexColor(surfaceDisabled, primaryBase)

  return {
    '--surface-base': surfaceBase,
    '--surface-panel': panel,
    '--surface-raised': raised,
    '--surface-muted': muted,
    '--surface-hover': hover,
    '--surface-pressed': isDark
      ? colorWithTone(primaryHsl, primaryHsl.l + 0.17, 1.1)
      : colorWithTone(primaryHsl, primaryHsl.l - 0.075, 0.95),
    '--surface-selected': accent.soft,
    '--surface-elevated': raised,
    '--surface-glass': isDark ? 'rgba(28, 35, 45, 0.84)' : 'rgba(255, 255, 255, 0.84)',
    '--surface-glass-strong': isDark ? 'rgba(28, 35, 45, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    '--surface-inset': inset,
    '--surface-disabled': surfaceDisabled,
    '--surface-disabled-text': readableOn(surfaceDisabledRgb, '#ffffff', '#111827'),
    '--text-primary': colorWithTone(primaryHsl, isDark ? 0.92 : 0.16, 0.9),
    '--text-secondary': colorWithTone(primaryHsl, isDark ? 0.76 : 0.32, 0.85),
    '--text-tertiary': colorWithTone(primaryHsl, isDark ? 0.64 : 0.46, 0.78),
    '--text-muted': colorWithTone(primaryHsl, isDark ? 0.54 : 0.58, 0.7),
    '--text-inverted': inverseText,
    '--border-subtle': colorWithTone(primaryHsl, isDark ? primaryHsl.l + 0.16 : primaryHsl.l - 0.055, 0.7),
    '--border-default': colorWithTone(primaryHsl, isDark ? primaryHsl.l + 0.22 : primaryHsl.l - 0.11, 0.78),
    '--border-strong': colorWithTone(primaryHsl, isDark ? primaryHsl.l + 0.3 : primaryHsl.l - 0.19, 0.82),
    '--focus-ring': accent.solid,
    '--shadow-color': isDark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(22, 31, 44, 0.18)',
    '--shadow-color-strong': isDark ? 'rgba(0, 0, 0, 0.58)' : 'rgba(17, 24, 39, 0.26)',
    '--overlay-scrim': isDark ? 'rgba(0, 0, 0, 0.58)' : 'rgba(17, 24, 39, 0.42)',
    '--overlay-scrim-soft': isDark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(25, 31, 39, 0.34)',
    '--tooltip-bg': inverseBg,
    '--tooltip-text': inverseText,
    '--inverse-glass': isDark ? 'rgba(248, 250, 252, 0.82)' : 'rgba(30, 36, 46, 0.74)',
    '--control-bg': raised,
    '--control-hover': hover,
    '--control-border': colorWithTone(primaryHsl, isDark ? primaryHsl.l + 0.25 : primaryHsl.l - 0.14, 0.75),
    '--accent-solid': accent.solid,
    '--accent-solid-hover': accent.solidHover,
    '--accent-text': accent.text,
    '--accent-soft': accent.soft,
    '--accent-soft-hover': accent.softHover,
    '--accent-border': accent.border,
    '--accent-ring': accent.ring,
    '--accent-on-solid': accent.onSolid,
    '--success-solid': success.solid,
    '--success-soft': success.soft,
    '--success-soft-hover': success.softHover,
    '--success-border': success.border,
    '--success-text': success.text,
    '--success-on-solid': success.onSolid,
    '--warning-solid': warning.solid,
    '--warning-soft': warning.soft,
    '--warning-soft-hover': warning.softHover,
    '--warning-border': warning.border,
    '--warning-text': warning.text,
    '--warning-on-solid': warning.onSolid,
    '--danger-solid': danger.solid,
    '--danger-soft': danger.soft,
    '--danger-soft-hover': danger.softHover,
    '--danger-border': danger.border,
    '--danger-text': danger.text,
    '--danger-on-solid': danger.onSolid,
    '--info-solid': info.solid,
    '--info-soft': info.soft,
    '--info-soft-hover': info.softHover,
    '--info-border': info.border,
    '--info-text': info.text,
    '--info-on-solid': info.onSolid,
    '--syntax-key': isDark ? '#d8b4fe' : '#7b4fa3',
    '--syntax-keyword': isDark ? '#d8b4fe' : '#7b4fa3',
    '--syntax-string': success.text,
    '--syntax-number': info.text,
    '--syntax-boolean': warning.text,
    '--syntax-null': colorWithTone(primaryHsl, isDark ? 0.62 : 0.52, 0.75),
    '--syntax-punctuation': colorWithTone(primaryHsl, isDark ? 0.68 : 0.38, 0.78),
    '--syntax-bg': syntaxSurface,
    '--syntax-selection': accent.ring
  }
}

export function applyAppTheme(colors: AppThemeSourceColors = currentThemeColors, target: HTMLElement = document.documentElement): void {
  const tokens = createAppThemeTokens(colors)
  for (const [name, value] of Object.entries(tokens)) {
    target.style.setProperty(name, value)
  }
}

export function setAppThemeColors(colors: AppThemeSourceColors): void {
  currentThemeColors = {
    primaryBase: colors.primaryBase ?? currentThemeColors.primaryBase,
    accentBase: colors.accentBase ?? currentThemeColors.accentBase
  }
  applyAppTheme(currentThemeColors)
}

export function getAppThemeColors(): Required<AppThemeSourceColors> {
  return { ...currentThemeColors }
}

export function initializeAppTheme(colors: AppThemeSourceColors = DEFAULT_APP_THEME_COLORS): void {
  currentThemeColors = {
    primaryBase: colors.primaryBase ?? DEFAULT_APP_THEME_COLORS.primaryBase,
    accentBase: colors.accentBase ?? DEFAULT_APP_THEME_COLORS.accentBase
  }
  applyAppTheme(currentThemeColors)
}

export function streamingMarkdownThemeVars(): ThemeTokens {
  return {
    '--sm-bg': 'transparent',
    '--sm-border': 'var(--border-default)',
    '--sm-code-bg': 'var(--surface-inset)',
    '--sm-code-text': 'var(--text-primary)',
    '--sm-faint': 'var(--text-tertiary)',
    '--sm-link': 'var(--accent-text)',
    '--sm-placeholder': 'var(--surface-hover)',
    '--sm-placeholder-glint': 'var(--surface-raised)',
    '--sm-quote': 'var(--border-strong)',
    '--sm-table-stripe': 'var(--surface-muted)',
    '--sm-text': 'var(--text-primary)'
  }
}
