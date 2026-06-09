import {
  buildAdminApiKeyHeaders,
  buildSub2apiHeaders,
  calculatePoolRemainingPercent,
  countPoolAccounts,
  findExactGroupIdsByNames,
  findPoolCapacitySummary,
  findLatestPoolResetAt,
  listPoolResetItems,
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
  poolGroupName?: string
  poolGroupNames?: string[]
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
  const realtimeHeaders = buildRealtimeHeaders(headers)
  const today = formatLocalDate(new Date())
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const todayQuery = `start_date=${today}&end_date=${today}&timezone=${encodeURIComponent(timezone)}`
  const groupNames = normalizePoolGroupNames(config.poolGroupNames ?? config.poolGroupName)
  const groupsPayload = groupNames.length > 0 ? await requestJson(`${baseUrl}/api/v1/admin/groups/all`, headers) : null
  const poolGroupIds = groupNames.length > 0 ? findExactGroupIdsByNames(parseGroups(groupsPayload), groupNames) : []
  const groupMatched = groupNames.length === 0 || poolGroupIds.length > 0
  const refreshAt = Date.now()
  const accountsRequests =
    poolGroupIds.length > 0
      ? poolGroupIds.map((groupId) =>
          requestJson(
            buildRealtimeUrl(
              `${baseUrl}/api/v1/admin/accounts?page=1&page_size=200&lite=true&group=${encodeURIComponent(String(groupId))}`,
              refreshAt
            ),
            realtimeHeaders
          )
        )
      : [requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/accounts?page=1&page_size=200&lite=true`, refreshAt), realtimeHeaders)]

  const [statsPayload, rankingPayload, usersPayload, accountsPayloads, capacityPayload] = await Promise.all([
    requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/dashboard/stats?timezone=${encodeURIComponent(timezone)}`, refreshAt), realtimeHeaders),
    requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/dashboard/users-ranking?${todayQuery}&limit=10`, refreshAt), realtimeHeaders),
    requestJson(`${baseUrl}/api/v1/admin/users?page=1&page_size=200`, headers),
    Promise.all(accountsRequests),
    requestJson(buildRealtimeUrl(`${baseUrl}/api/v1/admin/groups/capacity-summary?timezone=${encodeURIComponent(timezone)}`, refreshAt), realtimeHeaders)
  ])

  const accountItems = groupMatched ? dedupeAccounts(accountsPayloads.flatMap((payload) => readItems(payload))) : []
  const selectedGroupIds = poolGroupIds.length > 0 ? poolGroupIds : null

  return {
    todayTotalTokens: parseTodayTokens(statsPayload),
    poolRemainingPercent: groupMatched ? calculatePoolRemainingPercent(accountItems, selectedGroupIds) : null,
    poolLatestResetAt: groupMatched ? findLatestPoolResetAt(accountItems, selectedGroupIds) : null,
    poolResetItems: groupMatched ? listPoolResetItems(accountItems, selectedGroupIds) : [],
    poolAccounts: groupMatched ? countPoolAccounts(accountItems, selectedGroupIds) : null,
    poolCapacity: groupMatched ? findPoolCapacitySummary(capacityPayload, selectedGroupIds) : null,
    userRanking: parseUserRanking(rankingPayload, parseUsers(usersPayload)),
    updatedAt: new Date().toISOString()
  }
}

function normalizePoolGroupNames(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : [value]
  const names = values.map((item) => String(item ?? '').trim()).filter((item) => item !== '')
  return Array.from(new Set(names))
}

function dedupeAccounts(accounts: unknown[]): unknown[] {
  const seen = new Set<string>()
  const deduped: unknown[] = []

  accounts.forEach((account, index) => {
    const key = getAccountDedupeKey(account, index)
    if (seen.has(key)) return
    seen.add(key)
    deduped.push(account)
  })

  return deduped
}

function getAccountDedupeKey(account: unknown, index: number): string {
  if (typeof account !== 'object' || account === null || Array.isArray(account)) return `index:${index}`
  const record = account as Record<string, unknown>
  const id = record.id ?? record.account_id ?? record.accountId ?? record.token_id ?? record.tokenId
  if (id !== undefined && id !== null && String(id).trim() !== '') return `id:${String(id)}`
  return `index:${index}`
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

export function buildRealtimeUrl(url: string, timestamp = Date.now()): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_ts=${encodeURIComponent(String(timestamp))}`
}

function buildRealtimeHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  }
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
