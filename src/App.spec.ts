import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { settingsStorageKey, type AppSettings } from '@/domain/settings'
import { fetchAdminMonitorMetrics, fetchSub2apiMetrics } from '@/domain/sub2apiClient'

const { checkForAvailableUpdate, emitTauriEvent, getSettingsUpdatedListener, hidePersonalFloatingOrb, listenTauriEvent, resetSettingsUpdatedListener, tauriWindow } = vi.hoisted(() => {
  let settingsUpdatedListener: (() => void) | undefined
  const checkForAvailableUpdate = vi.fn(async () => ({
    body: '修复平台更新提示',
    version: '0.4.2'
  }))
  const hidePersonalFloatingOrb = vi.fn()
  const emitTauriEvent = vi.fn(async () => undefined)
  const listenTauriEvent = vi.fn(async (eventName: string, listener: () => void) => {
    if (eventName === 'token-orb-settings-updated') {
      settingsUpdatedListener = listener
    }
    return vi.fn()
  })
  const tauriWindow = {
    hide: hidePersonalFloatingOrb,
    onMoved: vi.fn(async () => vi.fn()),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    scaleFactor: vi.fn(async () => 1),
    show: vi.fn(async () => undefined),
    setPosition: vi.fn(async () => undefined),
    setShadow: vi.fn(async () => undefined),
    setSize: vi.fn(async () => undefined)
  }

  return {
    checkForAvailableUpdate,
    emitTauriEvent,
    getSettingsUpdatedListener: () => settingsUpdatedListener,
    hidePersonalFloatingOrb,
    listenTauriEvent,
    resetSettingsUpdatedListener: () => {
      settingsUpdatedListener = undefined
    },
    tauriWindow
  }
})

const localStorageMock = (() => {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, String(value))
    }
  } satisfies Storage
})()

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

vi.mock('@tauri-apps/api/window', () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
  PhysicalPosition: class {},
  currentMonitor: vi.fn(async () => null),
  getCurrentWindow: vi.fn(() => tauriWindow)
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitTauriEvent,
  listen: listenTauriEvent
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: checkForAvailableUpdate
}))

const baseSettings: AppSettings = {
  sub2apiBaseUrl: 'http://127.0.0.1:8081',
  adminApiKey: 'admin-key',
  personalFloatingEnabled: true,
  personalToken: '',
  poolGroupName: '旧分组',
  poolGroupNames: ['旧分组'],
  refreshSeconds: 10
}

describe('App settings sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetSettingsUpdatedListener()
    vi.stubGlobal('localStorage', localStorageMock)
    Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })
    localStorage.clear()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
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

  it('uses a 410px platform window to keep the account summary on one line', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    Object.defineProperty(wrapper.get('.monitor-panel').element, 'scrollHeight', { configurable: true, value: 242 })
    await flushPromises()

    expect(tauriWindow.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 410, height: 242 }))
  })

  it('shows the 7d pool by default and switches to the 5h pool', async () => {
    vi.setSystemTime(new Date('2026-03-16T09:00:00Z'))
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: 91,
      poolLatestResetAt: '2026-03-16T12:37:00.000Z',
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z',
      poolSevenDayRemainingPercent: 73,
      poolSevenDayLatestResetAt: '2026-03-23T05:02:00.000Z',
      poolSevenDayResetItems: []
    } as Awaited<ReturnType<typeof fetchAdminMonitorMetrics>>)
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('7日号池剩余量')
    expect(wrapper.text()).toContain('73%')
    expect(wrapper.text()).toContain('6d 20h 2m 后刷新')
    expect(wrapper.get('button.pool-window-tab[data-window="7d"]').text()).toBe('7d')
    expect(wrapper.get('button.pool-window-tab[data-window="5h"]').text()).toBe('5h')

    await wrapper.get('button.pool-window-tab[data-window="5h"]').trigger('click')

    expect(wrapper.text()).toContain('5小时号池剩余量')
    expect(wrapper.text()).toContain('91%')
  })

  it('resizes the platform window to the rendered account panel height after expanding details', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 0, error: 0, total: 1 },
      poolCapacity: null,
      poolAccountDetails: [
        { rank: 1, name: '正常账号', status: 'normal', statusText: '正常', schedulable: true, scheduleText: '调度中', capacityText: '0 / 10', capacityUsed: 0, todayRequests: 1, todayTokens: 1, usageWindows: [] }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()
    Object.defineProperty(wrapper.get('.monitor-panel').element, 'scrollHeight', { configurable: true, value: 278 })
    tauriWindow.setSize.mockClear()

    await wrapper.get('button.account-details-toggle').trigger('click')
    await flushPromises()

    expect(tauriWindow.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 410, height: 278 }))
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

  it('emits the settings update event after saving configuration in Tauri', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)

    await wrapper.get('button.primary-button').trigger('click')
    await flushPromises()

    expect(emitTauriEvent).toHaveBeenCalledWith('token-orb-settings-updated')
  })

  it('shows the personal floating window after receiving updated settings from Tauri', async () => {
    window.history.replaceState({}, '', '/?view=personal')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: false
    }))
    mount(App)
    await flushPromises()
    vi.clearAllMocks()

    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: true
    }))
    const settingsUpdatedListener = getSettingsUpdatedListener()

    expect(settingsUpdatedListener).toEqual(expect.any(Function))
    if (!settingsUpdatedListener) return

    settingsUpdatedListener()
    await flushPromises()

    expect(tauriWindow.show).toHaveBeenCalledOnce()
  })

  it('shows a version update button beside the platform title when a new version is available', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('.monitor-panel > .section-title button').text()).toBe('有版本更新')
  })

  it('emits the native update event after clicking the platform version update button', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('.monitor-panel > .section-title button').trigger('click')
    await flushPromises()

    expect(emitTauriEvent).toHaveBeenCalledWith('token-orb-open-update')
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

  it('defaults the personal floating orb to disabled and hides its JWT field', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    const { personalFloatingEnabled: _personalFloatingEnabled, ...legacySettings } = baseSettings
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...legacySettings,
      personalToken: 'personal-jwt'
    }))
    const wrapper = mount(App)

    const floatingToggle = wrapper.find('input[name="personal-floating-enabled"]')

    expect(floatingToggle.exists()).toBe(true)
    expect((floatingToggle.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.find('input[placeholder="用于悬浮球个人数据"]').exists()).toBe(false)
  })

  it('shows the personal JWT field after enabling the personal floating orb', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: false,
      personalToken: 'personal-jwt'
    }))
    const wrapper = mount(App)

    await wrapper.get('input[name="personal-floating-enabled"]').setValue(true)

    expect(wrapper.find('input[placeholder="用于悬浮球个人数据"]').exists()).toBe(true)
  })

  it('closes the personal floating orb through the Tauri window hide API', async () => {
    window.history.replaceState({}, '', '/?view=personal')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: true
    }))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button[title="关闭个人悬浮球"]').trigger('click')
    await flushPromises()

    expect(hidePersonalFloatingOrb).toHaveBeenCalledOnce()
  })

  it('shows group account details by default and allows collapsing them', async () => {
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
    expect(wrapper.get('.ranking-box .section-title').text()).toContain('排行榜')
    expect(wrapper.text()).toContain('账号信息')
    expect(wrapper.text()).not.toContain('分组账号详情')
    expect(wrapper.text()).toContain('账号：5/1/1/7')
    expect(wrapper.text()).toContain('容量：0 / 50')
    expect(wrapper.text()).toContain('由磊（707200583@163.com）')
    expect(wrapper.get('button.account-details-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.monitor-card .token-cost').text()).toBe('$32.48')
    expect(wrapper.get('.ranking-value .token-cost').text()).toBe('$13.08')
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

    await wrapper.get('button.account-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('调度中')
    expect(wrapper.text()).toContain('5h剩余 91% · 3h 37m')
  })

  it('filters group account details from status values and only toggles them from the arrow', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 1, error: 1, total: 4 },
      poolCapacity: null,
      poolAccountDetails: [
        { rank: 1, name: '正常账号', status: 'normal', statusText: '正常', schedulable: true, scheduleText: '调度中', capacityText: '0 / 10', capacityUsed: 0, todayRequests: 1, todayTokens: 1, usageWindows: [] },
        { rank: 2, name: '限流账号', status: 'limited', statusText: '限流', schedulable: false, scheduleText: '限流中', capacityText: '1 / 10', capacityUsed: 1, todayRequests: 2, todayTokens: 2, usageWindows: [] },
        { rank: 3, name: '错误账号', status: 'error', statusText: '错误', schedulable: false, scheduleText: '不可调度', capacityText: '2 / 10', capacityUsed: 2, todayRequests: 3, todayTokens: 3, usageWindows: [] },
        { rank: 4, name: '停用账号', status: 'disabled', statusText: '停用', schedulable: false, scheduleText: '已停用', capacityText: '0 / 10', capacityUsed: 0, todayRequests: 4, todayTokens: 4, usageWindows: [] }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.account-filter.limited').trigger('click')

    expect(wrapper.get('button.account-filter.limited').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('token-orb-account-filter-v1')).toBe('limited')
    expect(wrapper.text()).toContain('限流账号')
    expect(wrapper.text()).not.toContain('正常账号')
    expect(wrapper.text()).not.toContain('错误账号')
    expect(wrapper.text()).not.toContain('停用账号')

    await wrapper.get('button.account-filter.total').trigger('click')

    expect(wrapper.text()).toContain('正常账号')
    expect(wrapper.text()).toContain('限流账号')
    expect(wrapper.text()).toContain('错误账号')
    expect(wrapper.text()).toContain('停用账号')
  })

  it('restores the persisted account status filter after reopening the platform window', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 1, error: 0, total: 2 },
      poolCapacity: null,
      poolAccountDetails: [
        { rank: 1, name: '正常账号', status: 'normal', statusText: '正常', schedulable: true, scheduleText: '调度中', capacityText: '0 / 10', capacityUsed: 0, todayRequests: 1, todayTokens: 1, usageWindows: [] },
        { rank: 2, name: '限流账号', status: 'limited', statusText: '限流', schedulable: false, scheduleText: '限流中', capacityText: '1 / 10', capacityUsed: 1, todayRequests: 2, todayTokens: 2, usageWindows: [] }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    localStorage.setItem('token-orb-account-filter-v1', 'limited')
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('button.account-filter.limited').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('限流账号')
    expect(wrapper.text()).not.toContain('正常账号')
  })

  it('filters normal and errored account details while expanded by default', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValue({
      todayTotalTokens: 52220000,
      todayTotalCost: 32.481,
      poolRemainingPercent: 91,
      poolLatestResetAt: '2026-03-16T12:37:00.000Z',
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 1, error: 1, total: 3 },
      poolCapacity: { groupId: null, concurrencyUsed: 0, concurrencyMax: 50 },
      poolAccountDetails: [
        {
          rank: 1,
          name: '正常账号',
          status: 'normal',
          statusText: '正常',
          schedulable: true,
          scheduleText: '调度中',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayRequests: 159,
          todayTokens: 52220000,
          usageWindows: []
        },
        {
          rank: 2,
          name: '限流账号',
          status: 'limited',
          statusText: '限流中',
          schedulable: false,
          scheduleText: '限流中',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayRequests: 0,
          todayTokens: 0,
          usageWindows: []
        },
        {
          rank: 3,
          name: '错误账号',
          status: 'error',
          statusText: '错误',
          schedulable: false,
          scheduleText: '不可调度',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayRequests: 0,
          todayTokens: 0,
          usageWindows: []
        }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.account-status-filter[data-status="normal"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.account-details-list').exists()).toBe(true)
    expect(wrapper.get('button.account-status-filter[data-status="normal"]').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('token-orb-account-filter-v1')).toBe('normal')

    expect(wrapper.text()).toContain('正常账号')
    expect(wrapper.text()).not.toContain('限流账号')
    expect(wrapper.text()).not.toContain('错误账号')

    await wrapper.get('button.account-status-filter[data-status="error"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('button.account-status-filter[data-status="error"]').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('token-orb-account-filter-v1')).toBe('error')
    expect(wrapper.text()).toContain('错误账号')
    expect(wrapper.text()).not.toContain('正常账号')
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
    expect(wrapper.get('.ranking-value').classes()).toContain('ranking-value--cost')
    expect(firstRow()).toContain('高消费')
    expect(firstRow()).toContain('3.00M')
    expect(firstRow()).toContain('$9.90')
  })
})
