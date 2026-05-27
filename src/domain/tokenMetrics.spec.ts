import { describe, expect, it } from 'vitest'
import {
  buildSub2apiHeaders,
  calculatePoolRemainingPercent,
  findExactGroupIdByName,
  formatFirstToken,
  formatTokenCount,
  normalizeBaseUrl,
  parseGroups,
  parseLatestFirstTokenMs,
  parseTodayTokens,
  parseUserRanking,
  parseUsers
} from './tokenMetrics'

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

  it('formats compact values for orb display', () => {
    expect(formatTokenCount(55900000)).toBe('55.9M')
    expect(formatTokenCount(204200)).toBe('204.2K')
    expect(formatFirstToken(14620)).toBe('14.62s')
    expect(formatFirstToken(null)).toBe('--')
  })

  it('builds bearer headers without duplicating prefix', () => {
    expect(buildSub2apiHeaders('abc').Authorization).toBe('Bearer abc')
    expect(buildSub2apiHeaders('Bearer xyz').Authorization).toBe('Bearer xyz')
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

  it('calculates average remaining percent for selected group accounts', () => {
    const accounts = [
      { group_ids: [1], status: 'active', extra: { codex_5h_used_percent: 60 } },
      { groups: [{ id: 1, name: 'gpt-plus' }], status: 'active', extra: { codex_5h_used_percent: 40 } },
      { group_id: 2, extra: { codex_5h_used_percent: 90 } }
    ]
    expect(calculatePoolRemainingPercent(accounts, '1')).toBe(50)
  })

  it('calculates 5h pool remaining by active accounts in the named group', () => {
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
      { status: 'error', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 100 } },
      { status: 'active', groups: [{ id: 2, name: '其它池' }], extra: { codex_5h_used_percent: 100 } }
    ]

    expect(poolGroupId).toBe(1)
    expect(calculatePoolRemainingPercent(accounts, poolGroupId)).toBeCloseTo(97.33, 2)
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
})
