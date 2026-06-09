import { describe, expect, it } from 'vitest'
import {
  buildSub2apiHeaders,
  calculatePoolRemainingPercent,
  countPoolAccounts,
  findExactGroupIdByName,
  findExactGroupIdsByNames,
  findLatestPoolResetAt,
  findPoolCapacitySummary,
  formatFirstToken,
  formatPoolCapacity,
  formatPoolAccountCount,
  formatTokenCount,
  listPoolResetItems,
  normalizeBaseUrl,
  parseGroups,
  parseLatestFirstTokenMs,
  parseTodayTokens,
  parseUserRanking,
  parseUsers
} from './tokenMetrics'
import { buildRealtimeUrl } from './sub2apiClient'

describe('tokenMetrics', () => {
  it('normalizes sub2api base url without trailing slash', () => {
    expect(normalizeBaseUrl(' http://127.0.0.1:8081/ ')).toBe('http://127.0.0.1:8081')
  })

  it('parses today token count from dashboard stats', () => {
    expect(parseTodayTokens({ today_tokens: 55900000 })).toBe(55900000)
    expect(parseTodayTokens({ data: { today_tokens: 42 } })).toBe(42)
  })

  it('parses latest first token from usage list', () => {
    expect(parseLatestFirstTokenMs({ items: [{ first_token_ms: 14620 }] })).toBe(14620)
    expect(parseLatestFirstTokenMs({ data: { items: [{ first_token_ms: 7060 }] } })).toBe(7060)
  })

  it('finds concurrency capacity summary by group id', () => {
    const payload = {
      data: [
        { group_id: 2, concurrency_used: 3, concurrency_max: 40 },
        { group_id: 5, concurrency_used: '1', concurrency_max: '10' }
      ]
    }

    expect(findPoolCapacitySummary(payload, 2)).toEqual({ groupId: 2, concurrencyUsed: 3, concurrencyMax: 40 })
    expect(findPoolCapacitySummary(payload, '5')).toEqual({ groupId: 5, concurrencyUsed: 1, concurrencyMax: 10 })
    expect(findPoolCapacitySummary(payload, 9)).toBeNull()
  })

  it('aggregates concurrency capacity summary by multiple group ids', () => {
    const payload = {
      data: [
        { group_id: 2, concurrency_used: 3, concurrency_max: 40 },
        { group_id: 5, concurrency_used: '1', concurrency_max: '10' },
        { group_id: 8, concurrency_used: 2, concurrency_max: 20 }
      ]
    }

    expect(findPoolCapacitySummary(payload, [2, '5'])).toEqual({ groupId: null, concurrencyUsed: 4, concurrencyMax: 50 })
    expect(findPoolCapacitySummary(payload, [9])).toBeNull()
  })

  it('counts active and total accounts for selected group', () => {
    const accounts = [
      { group_id: 2, status: 'active' },
      { group_id: 2, status: 'rate_limited' },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active' },
      { group_id: 5, status: 'active' },
      { group_id: 2, status: 'disabled' }
    ]

    expect(countPoolAccounts(accounts, 2)).toEqual({ active: 2, limited: 1, error: 0, total: 4 })
  })

  it('counts active and total accounts across selected groups', () => {
    const accounts = [
      { group_id: 2, status: 'active' },
      { group_id: 5, status: 'rate_limited' },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active' },
      { group_id: 8, status: 'active' },
      { group_ids: [5], status: 'error' }
    ]

    expect(countPoolAccounts(accounts, [2, 5])).toEqual({ active: 2, limited: 1, error: 1, total: 4 })
  })

  it('excludes limited and errored accounts from selected group active count', () => {
    const accounts = [
      { group_id: 2, status: 'active' },
      { group_id: 2, status: 'active' },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active' },
      { group_id: 2, status: 'inactive' },
      { group_id: 2, status: 'active', rate_limit_reset_at: '2099-03-15T00:00:00Z' },
      {
        group_id: 2,
        status: 'active',
        extra: {
          model_rate_limits: {
            'claude-sonnet-4-5': {
              rate_limited_at: '2026-03-15T00:00:00Z',
              rate_limit_reset_at: '2099-03-15T00:00:00Z'
            }
          }
        }
      },
      { group_id: 2, status: 'error', error_message: 'upstream auth failed' }
    ]

    expect(countPoolAccounts(accounts, 2)).toEqual({ active: 3, limited: 2, error: 1, total: 7 })
  })

  it('formats compact values for orb display', () => {
    expect(formatTokenCount(101330000)).toBe('101.33M')
    expect(formatTokenCount(55900000)).toBe('55.90M')
    expect(formatTokenCount(204200)).toBe('204.20K')
    expect(formatTokenCount(980)).toBe('980.00')
    expect(formatFirstToken(14620)).toBe('14.62s')
    expect(formatFirstToken(null)).toBe('--')
    expect(formatPoolCapacity({ groupId: 2, concurrencyUsed: 3, concurrencyMax: 40 })).toBe('3 / 40')
    expect(formatPoolCapacity(null)).toBe('--')
    expect(formatPoolAccountCount({ active: 2, limited: 1, error: 0, total: 4 })).toEqual({
      active: '2',
      limited: '1',
      error: '0',
      total: '4'
    })
    expect(formatPoolAccountCount(null)).toEqual({ active: '--', limited: '--', error: '--', total: '--' })
  })

  it('builds bearer headers without duplicating prefix', () => {
    expect(buildSub2apiHeaders('abc').Authorization).toBe('Bearer abc')
    expect(buildSub2apiHeaders('Bearer xyz').Authorization).toBe('Bearer xyz')
  })

  it('adds a changing cache buster to realtime admin urls', () => {
    expect(buildRealtimeUrl('http://127.0.0.1/api/v1/admin/accounts?page=1', 1710000000000)).toBe(
      'http://127.0.0.1/api/v1/admin/accounts?page=1&_ts=1710000000000'
    )
    expect(buildRealtimeUrl('http://127.0.0.1/api/v1/admin/groups/capacity-summary', 1710000000000)).toBe(
      'http://127.0.0.1/api/v1/admin/groups/capacity-summary?_ts=1710000000000'
    )
  })

  it('parses user token ranking for admin monitor list', () => {
    expect(parseUserRanking({ ranking: [{ user_id: 2, email: 'a@test.com', tokens: 1200 }] })).toEqual([
      { rank: 1, userId: 2, name: '用户', email: 'a@test.com', displayName: '用户（a@test.com）', tokens: 1200 }
    ])
  })

  it('uses admin user list username for today usage ranking names', () => {
    const users = parseUsers({ data: [{ id: 2, email: 'a@test.com', username: '阿唐' }] })
    expect(parseUserRanking({ ranking: [{ user_id: 2, email: 'a@test.com', tokens: 1200 }] }, users)).toEqual([
      { rank: 1, userId: 2, name: '阿唐', email: 'a@test.com', displayName: '阿唐（a@test.com）', tokens: 1200 }
    ])
  })

  it('limits today usage ranking to top 10 and accepts backend token aliases', () => {
    const ranking = Array.from({ length: 12 }, (_, index) => ({
      user_id: index + 1,
      email: `user${index + 1}@test.com`,
      total_tokens: (index + 1) * 1000
    }))

    const parsed = parseUserRanking({ ranking })
    expect(parsed).toHaveLength(10)
    expect(parsed[0].tokens).toBe(12000)
    expect(parsed[9].tokens).toBe(3000)
  })

  it('calculates average remaining percent for selected group accounts', () => {
    const accounts = [
      { group_ids: [1], status: 'active', extra: { codex_5h_used_percent: 60 } },
      { groups: [{ id: 1, name: 'gpt-plus' }], status: 'active', extra: { codex_5h_used_percent: 40 } },
      { group_id: 2, extra: { codex_5h_used_percent: 90 } }
    ]
    expect(calculatePoolRemainingPercent(accounts, '1')).toBe(50)
  })

  it('calculates average remaining percent for selected group accounts across multiple groups', () => {
    const accounts = [
      { group_ids: [1], status: 'active', extra: { codex_5h_used_percent: 60 } },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active', extra: { codex_5h_used_percent: 40 } },
      { group_id: 3, status: 'active', extra: { codex_5h_used_percent: 90 } }
    ]

    expect(calculatePoolRemainingPercent(accounts, [1, 2])).toBe(50)
  })

  it('calculates 5h pool remaining by active and rate-limited accounts in the named group', () => {
    const poolGroupId = findExactGroupIdByName(
      parseGroups({
        data: [
          { id: 1, name: 'codex池', status: 'active' },
          { id: 2, name: 'codex池备用', status: 'active' }
        ]
      }),
      'codex池'
    )
    const accounts = [
      { status: 'active', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 0 } },
      { status: 'active', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 3 } },
      { status: 'active', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 5 } },
      { status: 'rate_limited', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 100 } },
      { status: 'error', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 100 } },
      { status: 'active', groups: [{ id: 2, name: '其它池' }], extra: { codex_5h_used_percent: 100 } }
    ]

    expect(poolGroupId).toBe(1)
    expect(calculatePoolRemainingPercent(accounts, poolGroupId)).toBeCloseTo(73, 2)
  })

  it('treats expired 5h usage windows as fully remaining', () => {
    const accounts = [
      {
        status: 'active',
        groups: [{ id: 1, name: 'codex池' }],
        extra: {
          codex_5h_used_percent: 42,
          codex_5h_reset_at: '2026-03-16T10:00:00Z'
        }
      }
    ]

    expect(calculatePoolRemainingPercent(accounts, 1, new Date('2026-03-16T12:00:00Z'))).toBe(100)
  })

  it('finds nearest future 5h reset time from counted accounts in selected group', () => {
    const accounts = [
      {
        status: 'active',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T10:00:00Z' }
      },
      {
        status: 'rate_limited',
        groups: [{ id: 1, name: 'codex池' }],
        extra: {
          codex_usage_updated_at: '2026-03-16T08:00:00Z',
          codex_5h_reset_after_seconds: 12600
        }
      },
      {
        status: 'error',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T20:00:00Z' }
      },
      {
        status: 'active',
        groups: [{ id: 2, name: '其它池' }],
        extra: { codex_5h_reset_at: '2026-03-16T22:00:00Z' }
      }
    ]

    expect(findLatestPoolResetAt(accounts, 1, new Date('2026-03-16T09:00:00Z'))).toBe('2026-03-16T10:00:00.000Z')
  })

  it('lists pool reset times by nearest first with normal and limited status', () => {
    const accounts = [
      {
        status: 'active',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T12:00:00Z' }
      },
      {
        status: 'active',
        rate_limit_reset_at: '2026-03-16T11:00:00Z',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T10:00:00Z' }
      },
      {
        status: 'active',
        groups: [{ id: 2, name: '其它池' }],
        extra: { codex_5h_reset_at: '2026-03-16T09:30:00Z' }
      }
    ]

    expect(listPoolResetItems(accounts, 1, new Date('2026-03-16T09:00:00Z'))).toEqual([
      { status: 'limited', resetAt: '2026-03-16T10:00:00.000Z' },
      { status: 'normal', resetAt: '2026-03-16T12:00:00.000Z' }
    ])
  })

  it('does not fuzzy match group names before resolving group id', () => {
    const groups = parseGroups({
      data: [
        { id: 1, name: 'codex池', status: 'active' },
        { id: 2, name: 'codex池备用', status: 'active' },
        { id: 3, name: 'codex', status: 'inactive' }
      ]
    })

    expect(findExactGroupIdByName(groups, 'codex池')).toBe(1)
    expect(findExactGroupIdByName(groups, 'codex')).toBeNull()
    expect(findExactGroupIdByName(groups, 'codex池备')).toBeNull()
  })

  it('resolves multiple exact active group names and removes duplicates', () => {
    const groups = parseGroups({
      data: [
        { id: 1, name: 'codex池', status: 'active' },
        { id: 2, name: 'codex池备用', status: 'active' },
        { id: 3, name: 'codex', status: 'inactive' }
      ]
    })

    expect(findExactGroupIdsByNames(groups, ['codex池', 'codex池备用', 'codex池'])).toEqual([1, 2])
    expect(findExactGroupIdsByNames(groups, ['codex'])).toEqual([])
  })
})
