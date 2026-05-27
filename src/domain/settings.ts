export interface AppSettings {
  sub2apiBaseUrl: string
  adminApiKey: string
  personalToken: string
  poolGroupName: string
  refreshSeconds: number
}

export const defaultSettings: AppSettings = {
  sub2apiBaseUrl: '',
  adminApiKey: '',
  personalToken: '',
  poolGroupName: '',
  refreshSeconds: 30
}

const storageKey = 'token-orb-settings-v1'

export function loadSettings(): AppSettings {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return { ...defaultSettings }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return sanitizeSettings(parsed)
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const sanitized = sanitizeSettings(settings)
  localStorage.setItem(storageKey, JSON.stringify(sanitized))
  return sanitized
}

export function hasRequiredSub2apiSettings(settings: AppSettings): boolean {
  return settings.sub2apiBaseUrl.trim() !== '' && (hasAdminSettings(settings) || hasPersonalSettings(settings))
}

export function hasAdminSettings(settings: AppSettings): boolean {
  return settings.sub2apiBaseUrl.trim() !== '' && settings.adminApiKey.trim() !== ''
}

export function hasPersonalSettings(settings: AppSettings): boolean {
  return settings.sub2apiBaseUrl.trim() !== '' && settings.personalToken.trim() !== ''
}

function sanitizeSettings(settings: Partial<AppSettings>): AppSettings {
  const legacySettings = settings as Partial<AppSettings> & { poolGroupId?: unknown }
  const refreshSeconds = Number(settings.refreshSeconds)
  return {
    sub2apiBaseUrl: String(settings.sub2apiBaseUrl ?? defaultSettings.sub2apiBaseUrl),
    adminApiKey: String(settings.adminApiKey ?? defaultSettings.adminApiKey),
    personalToken: String(settings.personalToken ?? defaultSettings.personalToken),
    poolGroupName: String(settings.poolGroupName ?? legacySettings.poolGroupId ?? defaultSettings.poolGroupName),
    refreshSeconds: Number.isFinite(refreshSeconds) ? clamp(Math.round(refreshSeconds), 10, 300) : 30
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
