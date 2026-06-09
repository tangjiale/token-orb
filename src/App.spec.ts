import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { settingsStorageKey, type AppSettings } from '@/domain/settings'
import { fetchAdminMonitorMetrics, fetchSub2apiMetrics } from '@/domain/sub2apiClient'

vi.mock('@/domain/sub2apiClient', () => ({
  fetchAdminMonitorMetrics: vi.fn(async () => ({
    todayTotalTokens: null,
    poolRemainingPercent: null,
    poolLatestResetAt: null,
    poolResetItems: [],
    poolAccounts: null,
    poolCapacity: null,
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
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)

    await wrapper.get('button.primary-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('配置已保存')
  })
})
