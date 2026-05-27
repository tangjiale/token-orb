export interface TokenOrbMetrics {
  todayTokens: number | null
  firstTokenMs: number | null
  updatedAt: string | null
}

export interface AdminMonitorMetrics {
  todayTotalTokens: number | null
  poolRemainingPercent: number | null
  poolLatestResetAt: string | null
  userRanking: UserTodayUsageRankItem[]
  updatedAt: string | null
}

export interface UserTodayUsageRankItem {
  rank: number
  userId: number | null
  name: string
  email: string
  displayName: string
  tokens: number
}

export interface UserIdentityItem {
  id: number
  email: string
  username: string
}

export interface AdminGroupIdentityItem {
  id: number
  name: string
  status: string
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function buildSub2apiHeaders(token: string): Record<string, string> {
  const trimmed = token.trim()
  const authorization = /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
  return {
    Authorization: authorization,
    Accept: 'application/json'
  }
}

export function buildAdminApiKeyHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim()
  return {
    'X-API-Key': trimmed,
    Authorization: /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`,
    Accept: 'application/json'
  }
}

export function parseTodayTokens(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'today_tokens')
}

export function parseLatestFirstTokenMs(payload: unknown): number | null {
  const record = unwrapData(payload)
  const items = Array.isArray(record?.items) ? record.items : []
  if (items.length === 0) return null
  return readNumber(items[0], 'first_token_ms')
}

export function parseUserRanking(payload: unknown, users: UserIdentityItem[] = []): UserTodayUsageRankItem[] {
  const record = unwrapData(payload)
  const ranking = Array.isArray(record?.ranking) ? record.ranking : []
  const userMap = new Map(users.map((user) => [user.id, user]))
  return ranking
    .map((item) => {
      const row = isRecord(item) ? item : {}
      const userId = readNumber(row, 'user_id')
      const user = userId === null ? undefined : userMap.get(userId)
      const email = user?.email || (typeof row.email === 'string' ? row.email : '')
      const username = user?.username || (typeof row.username === 'string' ? row.username : '')
      const name = username || '用户'
      return {
        rank: 0,
        userId,
        name,
        email,
        displayName: email ? `${name}（${email}）` : name,
        tokens: readFirstNumber(row, ['tokens', 'total_tokens', 'today_tokens']) ?? 0
      }
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function parseUsers(payload: unknown): UserIdentityItem[] {
  return readItems(payload)
    .map((item) => {
      if (!isRecord(item)) return null
      const id = readNumber(item, 'id')
      if (id === null) return null
      return {
        id,
        email: typeof item.email === 'string' ? item.email : '',
        username: typeof item.username === 'string' ? item.username : ''
      }
    })
    .filter((item): item is UserIdentityItem => item !== null)
}

export function parseGroups(payload: unknown): AdminGroupIdentityItem[] {
  return readItems(payload)
    .map((item) => {
      if (!isRecord(item)) return null
      const id = readNumber(item, 'id')
      if (id === null) return null
      return {
        id,
        name: typeof item.name === 'string' ? item.name : '',
        status: typeof item.status === 'string' ? item.status : ''
      }
    })
    .filter((item): item is AdminGroupIdentityItem => item !== null)
}

export function findExactGroupIdByName(groups: AdminGroupIdentityItem[], groupName: string): number | null {
  const wantedGroupName = groupName.trim()
  if (!wantedGroupName) return null
  const matched = groups.find((group) => group.name.trim() === wantedGroupName && accountIsActive(group))
  return matched?.id ?? null
}

export function calculatePoolRemainingPercent(accounts: unknown[], groupId: string | number | null = null, now = new Date()): number | null {
  const wantedGroupId = groupId === null ? '' : String(groupId).trim()
  const percents = accounts
    .filter((item) => accountMatchesGroupId(item, wantedGroupId))
    .filter((item) => accountIsActive(item))
    .map((item) => {
      if (!isRecord(item)) return null
      const extra = isRecord(item.extra) ? item.extra : item
      const used = read5hUsedPercent(extra, now)
      return used === null ? null : Math.max(0, 100 - used)
    })
    .filter((value): value is number => value !== null)

  if (percents.length === 0) return null
  return percents.reduce((sum, value) => sum + value, 0) / percents.length
}

export function findLatestPoolResetAt(accounts: unknown[], groupId: string | number | null = null): string | null {
  const wantedGroupId = groupId === null ? '' : String(groupId).trim()
  const resetTimes = accounts
    .filter((item) => accountMatchesGroupId(item, wantedGroupId))
    .filter((item) => accountIsActive(item))
    .map((item) => {
      if (!isRecord(item)) return null
      const extra = isRecord(item.extra) ? item.extra : item
      return read5hResetAt(extra)
    })
    .filter((value): value is number => value !== null)

  if (resetTimes.length === 0) return null
  return new Date(Math.max(...resetTimes)).toISOString()
}

export function formatTokenCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toFixed(2)
}

export function formatFirstToken(valueMs: number | null): string {
  if (valueMs === null || Number.isNaN(valueMs)) return '--'
  return `${(valueMs / 1000).toFixed(2)}s`
}

function unwrapData(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  if (isRecord(payload.data)) return payload.data
  return payload
}

export function readItems(payload: unknown): unknown[] {
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.data)) return payload.data
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.items)) return payload.data.items
    if (Array.isArray(payload.data.data)) return payload.data.data
  }
  return []
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readFirstNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  for (const key of keys) {
    const value = readNumber(record, key)
    if (value !== null) return value
  }
  return null
}

function read5hUsedPercent(extra: Record<string, unknown>, now: Date): number | null {
  const used = readNumber(extra, 'codex_5h_used_percent')
  if (used === null) return null
  if (isExpiredUsageWindow(extra, now)) return 0
  return Math.min(100, Math.max(0, used))
}

function read5hResetAt(extra: Record<string, unknown>): number | null {
  const resetAtRaw = extra.codex_5h_reset_at
  if (typeof resetAtRaw === 'string' && resetAtRaw.trim() !== '') {
    const resetAt = Date.parse(resetAtRaw)
    if (Number.isFinite(resetAt)) return resetAt
  }

  const resetAfterSeconds = readNumber(extra, 'codex_5h_reset_after_seconds')
  const updatedAtRaw = extra.codex_usage_updated_at
  if (resetAfterSeconds === null || typeof updatedAtRaw !== 'string' || updatedAtRaw.trim() === '') return null

  const updatedAt = Date.parse(updatedAtRaw)
  if (!Number.isFinite(updatedAt)) return null
  return updatedAt + resetAfterSeconds * 1000
}

function isExpiredUsageWindow(extra: Record<string, unknown>, now: Date): boolean {
  const resetAtRaw = extra.codex_5h_reset_at
  if (typeof resetAtRaw === 'string' && resetAtRaw.trim() !== '') {
    const resetAt = Date.parse(resetAtRaw)
    return Number.isFinite(resetAt) && now.getTime() >= resetAt
  }

  const resetAfterSeconds = readNumber(extra, 'codex_5h_reset_after_seconds')
  if (resetAfterSeconds === null) return false
  if (resetAfterSeconds <= 0) return true

  const updatedAtRaw = extra.codex_usage_updated_at
  if (typeof updatedAtRaw !== 'string' || updatedAtRaw.trim() === '') return false
  const updatedAt = Date.parse(updatedAtRaw)
  if (!Number.isFinite(updatedAt)) return false
  return now.getTime() >= updatedAt + resetAfterSeconds * 1000
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function accountIsActive(item: unknown): boolean {
  if (!isRecord(item)) return false
  const status = String(item.status ?? '').trim().toLowerCase()
  return status === '' || status === 'active'
}

function accountMatchesGroupId(item: unknown, groupId: string): boolean {
  if (!groupId) return true
  if (!isRecord(item)) return false
  const candidates = [item.group_id, item.groupId, item.group]
  if (candidates.some((value) => String(value ?? '') === groupId)) return true
  return [item.group_ids, item.groupIds, item.groups, item.account_groups, item.accountGroups].some((value) =>
    valueContainsGroupId(value, groupId)
  )
}

function valueContainsGroupId(value: unknown, groupId: string): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    if (String(item ?? '') === groupId) return true
    if (!isRecord(item)) return false
    return [item.id, item.group_id, item.groupId].some((candidate) => String(candidate ?? '') === groupId)
  })
}
