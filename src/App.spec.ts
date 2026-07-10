import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { settingsStorageKey, type AppSettings } from '@/domain/settings'
import { fetchAdminMonitorMetrics, fetchSub2apiMetrics } from '@/domain/sub2apiClient'

vi.mock('@/domain/sub2apiClient', () => ({
  fetchAdminMonitorMetrics: vi.fn(async () => ({
    todayTotalTokens: null,
    todayTotalCost: null,
    poolRemainingPercent: null,
    poolLatestResetAt: null,
    poolResetItems: [],
    poolAccounts: null,
    poolCapacity: null,
    poolAccountDetails: [],
    userRanking: [],
    updatedAt: new Date().toISOString()
  })),
  fetchSub2apiMetrics: vi.fn(async () => ({
    todayTokens: null,
    firstTokenMs: null,
    updatedAt: new Date().toISOString()
  }))
}))

const baseSettings: AppSettings = {
  sub2apiBaseUrl: 'http://127.0.0.1:8081',
  adminApiKey: 'admin-key',
  personalToken: '',
  poolGroupName: '旧分组',
  poolGroupNames: ['旧分组'],
  refreshSeconds: 10
}

describe('App settings sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()
    window.history.replaceState({}, '', '/?view=platform')
  })

  it('refreshes platform metrics with updated pool group names after settings storage changes', async () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    mount(App)
    await flushPromises()

    expect(fetchAdminMonitorMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      poolGroupNames: ['旧分组']
    }))

    const nextSettings: AppSettings = {
      ...baseSettings,
      poolGroupName: '新分组',
      poolGroupNames: ['新分组', '备用分组']
    }
    localStorage.setItem(settingsStorageKey, JSON.stringify(nextSettings))
    window.dispatchEvent(new StorageEvent('storage', {
      key: settingsStorageKey,
      newValue: JSON.stringify(nextSettings)
    }))
    await flushPromises()

    expect(fetchSub2apiMetrics).not.toHaveBeenCalled()
    expect(fetchAdminMonitorMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      poolGroupNames: ['新分组', '备用分组']
    }))
  })

  it('shows a saved confirmation after saving settings', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalToken: 'bad-jwt'
    }))
    vi.mocked(fetchSub2apiMetrics).mockRejectedValueOnce(new Error('请求失败'))
    const wrapper = mount(App)

    await wrapper.get('button.primary-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('配置已保存')
    expect(wrapper.text()).not.toContain('请求失败')
    expect(fetchAdminMonitorMetrics).toHaveBeenCalled()
    expect(fetchSub2apiMetrics).toHaveBeenCalled()
  })

  it('tests personal JWT independently from admin API settings', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalToken: 'personal-jwt'
    }))
    const wrapper = mount(App)
    await flushPromises()
    vi.clearAllMocks()

    await wrapper.get('button.secondary-mini-button').trigger('click')
    await flushPromises()

    expect(fetchSub2apiMetrics).toHaveBeenCalledWith({
      baseUrl: baseSettings.sub2apiBaseUrl,
      token: 'personal-jwt'
    })
    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('个人 JWT 正常')
  })

  it('shows the actual personal JWT test error message', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalToken: 'expired-jwt'
    }))
    const wrapper = mount(App)
    await flushPromises()
    vi.clearAllMocks()
    vi.mocked(fetchSub2apiMetrics).mockRejectedValueOnce('认证失败，Token 错误或已失效（HTTP 401）')

    await wrapper.get('button.secondary-mini-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('认证失败，Token 错误或已失效（HTTP 401）')
    expect(wrapper.text()).not.toContain('个人 JWT 测试失败')
  })

  it('keeps usage ranking visible and toggles group account details', async () => {
    vi.setSystemTime(new Date('2026-03-16T09:00:00.000Z'))
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: 52220000,
      todayTotalCost: 32.481,
      poolRemainingPercent: 91,
      poolLatestResetAt: '2026-03-16T12:37:00.000Z',
      poolResetItems: [],
      poolAccounts: { active: 5, limited: 1, error: 1, total: 7 },
      poolCapacity: { groupId: null, concurrencyUsed: 0, concurrencyMax: 50 },
      poolAccountDetails: [
        {
          rank: 1,
          name: '由磊（707200583@163.com）',
          status: 'normal',
          statusText: '正常',
          schedulable: true,
          scheduleText: '调度中',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayRequests: 159,
          todayTokens: 52220000,
          usageWindows: [
            { type: '5h', remainingPercent: 91, resetAt: '2026-03-16T12:37:00.000Z' },
            { type: '7d', remainingPercent: 93, resetAt: '2026-03-23T09:00:00.000Z' }
          ]
        }
      ],
      userRanking: [
        {
          rank: 1,
          userId: 2,
          name: '由磊',
          email: '707200583@163.com',
          displayName: '由磊（707200583@163.com）',
          tokens: 52220000,
          actualCost: 13.08
        }
      ],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('今日用量榜')
    expect(wrapper.text()).toContain('账号信息')
    expect(wrapper.text()).not.toContain('分组账号详情')
    expect(wrapper.text()).toContain('账号：5/1/1/7')
    expect(wrapper.text()).toContain('容量：0 / 50')
    expect(wrapper.text()).toContain('由磊（707200583@163.com）')
    expect(wrapper.get('.monitor-card .token-cost').text()).toBe('$32.48')
    expect(wrapper.get('.ranking-value .token-cost').text()).toBe('$13.08')
    expect(wrapper.text()).not.toContain('调度中')
    expect(wrapper.text()).not.toContain('剩余 91%')

    await wrapper.get('button.account-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('调度中')
    expect(wrapper.text()).toContain('0 / 10')
    expect(wrapper.text()).toContain('请求 159')
    expect(wrapper.text()).toContain('Token 52.2M')
    expect(wrapper.text()).toContain('5h剩余 91% · 3h 37m')
    expect(wrapper.text()).toContain('7d剩余 93% · 7d')

    await wrapper.get('button.account-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('调度中')
    expect(wrapper.text()).not.toContain('5h剩余 91%')
  })

  it('switches the ranking between token usage and actual cost', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: 15000000,
      todayTotalCost: 3.5,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [
        {
          rank: 1,
          userId: 1,
          name: '高用量',
          email: 'usage@example.com',
          displayName: '高用量（usage@example.com）',
          tokens: 12000000,
          actualCost: 1.2
        },
        {
          rank: 2,
          userId: 2,
          name: '高消费',
          email: 'cost@example.com',
          displayName: '高消费（cost@example.com）',
          tokens: 3000000,
          actualCost: 9.9
        }
      ],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    const firstRow = () => wrapper.findAll('.ranking-row')[0].text()

    expect(wrapper.get('.ranking-tab.active').text()).toBe('今日用量榜')
    expect(firstRow()).toContain('高用量')
    expect(firstRow()).toContain('12.00M')
    expect(firstRow()).toContain('$1.20')

    await wrapper.findAll('.ranking-tab')[1].trigger('click')
    await flushPromises()

    expect(wrapper.get('.ranking-tab.active').text()).toBe('今日消费榜')
    expect(firstRow()).toContain('高消费')
    expect(firstRow()).toContain('3.00M')
    expect(firstRow()).toContain('$9.90')
  })
})
