import {
  buildAdminApiKeyHeaders,
  buildSub2apiHeaders,
  calculatePoolRemainingPercent,
  findExactGroupIdByName,
  normalizeBaseUrl,
  parseGroups,
  parseLatestFirstTokenMs,
  parseTodayTokens,
  parseUserRanking,
  parseUsers,
  readItems,
  type AdminMonitorMetrics,
  type TokenOrbMetrics
} from './tokenMetrics'

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export interface Sub2apiConfig {
  baseUrl: string
  token: string
}

export interface AdminMonitorConfig {
  baseUrl: string
  apiKey: string
  poolGroupName: string
}

export async function fetchSub2apiMetrics(config: Sub2apiConfig): Promise<TokenOrbMetrics> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = buildSub2apiHeaders(config.token)

  const [statsPayload, usagePayload] = await Promise.all([
    requestJson(`${baseUrl}/api/v1/usage/dashboard/stats`, headers),
    requestJson(`${baseUrl}/api/v1/usage?page=1&page_size=1&sort=created_at&order=desc`, headers)
  ])

  return {
    todayTokens: parseTodayTokens(statsPayload),
    firstTokenMs: parseLatestFirstTokenMs(usagePayload),
    updatedAt: new Date().toISOString()
  }
}

export async function fetchAdminMonitorMetrics(config: AdminMonitorConfig): Promise<AdminMonitorMetrics> {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const headers = buildAdminApiKeyHeaders(config.apiKey)
  const today = formatLocalDate(new Date())
  const groupName = config.poolGroupName.trim()
  const groupsPayload = groupName ? await requestJson(`${baseUrl}/api/v1/admin/groups/all`, headers) : null
  const poolGroupId = groupName ? findExactGroupIdByName(parseGroups(groupsPayload), groupName) : null
  const groupQuery = poolGroupId === null ? '' : `&group=${encodeURIComponent(String(poolGroupId))}`

  const [statsPayload, rankingPayload, usersPayload, accountsPayload] = await Promise.all([
    requestJson(`${baseUrl}/api/v1/admin/dashboard/stats`, headers),
    requestJson(`${baseUrl}/api/v1/admin/dashboard/users-ranking?start_date=${today}&end_date=${today}&limit=8`, headers),
    requestJson(`${baseUrl}/api/v1/admin/users?page=1&page_size=200`, headers),
    requestJson(`${baseUrl}/api/v1/admin/accounts?page=1&page_size=200&lite=true&status=active${groupQuery}`, headers)
  ])

  return {
    todayTotalTokens: parseTodayTokens(statsPayload),
    poolRemainingPercent: groupName && poolGroupId === null ? null : calculatePoolRemainingPercent(readItems(accountsPayload), poolGroupId),
    userRanking: parseUserRanking(rankingPayload, parseUsers(usersPayload)),
    updatedAt: new Date().toISOString()
  }
}

async function requestJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const invoke = await loadTauriInvoke()
  if (invoke) {
    return invoke('sub2api_request', { request: { url, headers } })
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`sub2api request failed: ${response.status}`)
  }
  return response.json()
}

async function loadTauriInvoke(): Promise<TauriInvoke | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null
  try {
    const api = await import('@tauri-apps/api/core')
    return api.invoke as TauriInvoke
  } catch {
    return null
  }
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
