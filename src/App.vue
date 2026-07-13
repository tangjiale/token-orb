<template>
  <main v-if="isSettingsView" class="settings-shell">
    <section class="settings-panel standalone">
      <div class="section-title">
        <MonitorDot :size="18" />
        <span>连接设置</span>
      </div>

      <label class="field">
        <span>sub2api Base URL</span>
        <input v-model="draft.sub2apiBaseUrl" placeholder="http://172.16.5.12:8081" />
      </label>

      <label class="field">
        <span>管理员 API Key</span>
        <input v-model="draft.adminApiKey" type="password" placeholder="用于读取系统监控数据" />
      </label>

      <label class="field switch-field">
        <span>悬浮球</span>
        <span class="switch-control">
          <input v-model="draft.personalFloatingEnabled" name="personal-floating-enabled" type="checkbox" />
          <i></i>
        </span>
      </label>

      <label v-if="draft.personalFloatingEnabled" class="field personal-token-field">
        <span class="field-heading">
          <span>个人 JWT / Bearer Token（可选）</span>
          <button class="secondary-mini-button" type="button" :disabled="personalTokenTesting" @click.prevent.stop="testPersonalToken">
            {{ personalTokenTesting ? '测试中' : '测试' }}
          </button>
        </span>
        <input v-model="draft.personalToken" type="password" placeholder="用于悬浮球个人数据" />
        <em v-if="personalTokenTestMessage" class="field-message" :class="personalTokenTestState">
          {{ personalTokenTestMessage }}
        </em>
      </label>

      <label class="field pool-group-field">
        <span>号池分组名称（可选）</span>
        <div class="tag-input" @click="focusPoolGroupInput">
          <button
            v-for="name in draft.poolGroupNames"
            :key="name"
            class="tag-chip"
            type="button"
            :title="`移除 ${name}`"
            @click.stop="removePoolGroupName(name)"
          >
            <span>{{ name }}</span>
            <X :size="13" />
          </button>
          <input
            ref="poolGroupInputRef"
            v-model="poolGroupNameInput"
            placeholder="输入后按回车添加，留空统计全部正常账号"
            @keydown.enter.prevent="addPoolGroupName"
            @keydown.backspace="removeLastPoolGroupNameWhenEmpty"
          />
        </div>
      </label>

      <label class="field compact-field">
        <span>刷新间隔</span>
        <input v-model.number="draft.refreshSeconds" min="10" max="300" step="5" type="number" />
        <em>秒</em>
      </label>

      <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

      <div class="settings-panel__actions">
        <button class="primary-button" type="button" @click="saveDraft">保存配置</button>
        <span v-if="saveMessage" class="save-message">{{ saveMessage }}</span>
      </div>
    </section>
  </main>

  <main v-else-if="isUpdaterView" class="settings-shell update-shell">
    <section class="settings-panel standalone update-panel">
      <div class="section-title">
        <RefreshCw :class="{ spinning: updateState === 'checking' || updateState === 'downloading' }" :size="18" />
        <span>检查更新</span>
      </div>

      <div class="update-summary">
        <span>当前版本</span>
        <strong class="current-version">v{{ appVersion }}</strong>
      </div>

      <div v-if="updateVersion" class="update-summary">
        <span>最新版本</span>
        <strong class="latest-version">v{{ updateVersion }}</strong>
      </div>

      <div class="update-status" :class="updateState">{{ updateMessage }}</div>

      <div v-if="updateBody" class="update-notes">
        <span>更新内容</span>
        <pre>{{ updateBody }}</pre>
      </div>

      <div v-if="downloadPercent !== null" class="update-progress">
        <i :style="{ width: `${downloadPercent}%` }"></i>
      </div>

      <div class="settings-panel__actions update-actions">
        <button class="secondary-button" type="button" :disabled="updateBusy" @click="checkForAppUpdate">重新检查</button>
        <button v-if="updateState === 'available'" class="primary-button" type="button" @click="installAppUpdate">
          立即更新
        </button>
        <button v-if="updateState === 'installed'" class="primary-button" type="button" @click="restartApp">
          重启完成更新
        </button>
      </div>
    </section>
  </main>

  <main v-else-if="isPlatformView" class="platform-shell" :style="platformShellStyle">
    <section class="monitor-panel" :style="platformShellStyle" data-tauri-drag-region>
      <div class="section-title">
        <ListChecks :size="16" />
        <span>平台信息</span>
        <button v-if="platformUpdateAvailable" class="platform-update-button" type="button" @click.stop="openUpdateWindow">
          <RefreshCw :size="12" />
          <span>有版本更新</span>
        </button>
        <time>{{ platformUpdatedText }}</time>
      </div>

      <div v-if="hasAdmin" class="monitor-grid">
        <article class="monitor-card">
          <span>今日总 Token</span>
          <strong>{{ formattedAdminToday }}</strong>
          <em class="token-cost">{{ formattedAdminTodayCost }}</em>
        </article>
        <article class="monitor-card">
          <span>5小时号池剩余量</span>
          <div class="pool-value-line">
            <strong :class="poolStatusClass">{{ formattedPoolRemaining }}</strong>
            <span v-if="formattedPoolLatestReset !== '--'" class="pool-reset-hover">
              <em>{{ formattedPoolLatestReset }} 后刷新</em>
              <span class="pool-reset-popover">
                <span class="pool-reset-popover__title">刷新时间列表</span>
                <span v-if="formattedPoolResetItems.length === 0" class="pool-reset-empty">暂无刷新时间</span>
                <span v-for="(item, index) in formattedPoolResetItems" :key="`${item.resetAt}-${index}`" class="pool-reset-row">
                  <span class="pool-reset-status" :class="item.statusClass">{{ item.statusText }}</span>
                  <time>{{ item.displayTime }}</time>
                </span>
              </span>
            </span>
          </div>
          <div class="pool-progress" :class="poolStatusClass">
            <i :style="{ width: poolProgressWidth }"></i>
          </div>
        </article>
      </div>

      <div v-if="hasAdmin" class="ranking-box">
        <div class="section-title">
          <Users :size="16" />
          <span class="ranking-title-label">排行榜</span>
          <div class="ranking-tabs" role="tablist" aria-label="今日榜单切换">
            <button
              class="ranking-tab"
              :class="{ active: rankingMode === 'tokens' }"
              type="button"
              role="tab"
              :aria-selected="rankingMode === 'tokens'"
              @click="rankingMode = 'tokens'"
            >
              今日用量榜
            </button>
            <button
              class="ranking-tab"
              :class="{ active: rankingMode === 'cost' }"
              type="button"
              role="tab"
              :aria-selected="rankingMode === 'cost'"
              @click="rankingMode = 'cost'"
            >
              今日消费榜
            </button>
          </div>
        </div>
        <div v-if="adminMetrics.userRanking.length === 0" class="empty-line">暂无数据</div>
        <div v-for="(item, index) in displayedUserRanking" :key="item.userId ?? item.displayName" class="ranking-row">
          <b>#{{ index + 1 }}</b>
          <span>{{ item.displayName }}</span>
          <div class="ranking-value" :class="{ 'ranking-value--cost': rankingMode === 'cost' }">
            <strong>{{ formatTokenCount(item.tokens) }}</strong>
            <em class="token-cost">{{ formatCost(item.actualCost) }}</em>
          </div>
        </div>
      </div>

      <div v-if="hasAdmin" class="account-details-box">
        <div class="account-details-header">
          <span class="account-details-title">
            <Users :size="16" />
            <span>账号信息</span>
          </span>
          <span class="pool-summary-badges">
            <span class="pool-summary-badge account-badge" title="账号：正常 / 限流中 / 错误 / 总数量">
              <Users :size="12" />
              <span>账号：</span>
              <strong class="account-counts">
                <button
                  class="account-filter account-status-filter normal"
                  :aria-pressed="selectedAccountStatus === 'normal'"
                  data-status="normal"
                  title="筛选正常账号"
                  type="button"
                  @click="setAccountStatusFilter('normal')"
                >{{ formattedPoolAccounts.active }}</button>
                <span class="account-separator">/</span>
                <button
                  class="account-filter account-status-filter limited"
                  :aria-pressed="selectedAccountStatus === 'limited'"
                  data-status="limited"
                  title="筛选限流中账号"
                  type="button"
                  @click="setAccountStatusFilter('limited')"
                >{{ formattedPoolAccounts.limited }}</button>
                <span class="account-separator">/</span>
                <button
                  class="account-filter account-status-filter error"
                  :aria-pressed="selectedAccountStatus === 'error'"
                  data-status="error"
                  title="筛选错误账号"
                  type="button"
                  @click="setAccountStatusFilter('error')"
                >{{ formattedPoolAccounts.error }}</button>
                <span class="account-separator">/</span>
                <button
                  class="account-filter account-status-filter total"
                  :aria-pressed="selectedAccountStatus === 'all'"
                  data-status="all"
                  title="显示全部账号"
                  type="button"
                  @click="setAccountStatusFilter('all')"
                >{{ formattedPoolAccounts.total }}</button>
              </strong>
            </span>
            <span class="pool-summary-badge capacity-badge" title="当前容量 / 总容量">
              <Network :size="12" />
              <span>容量：</span>
              <strong>{{ formattedPoolCapacity }}</strong>
            </span>
          </span>
          <button
            class="account-details-toggle"
            :aria-expanded="accountDetailsExpanded"
            :title="accountDetailsExpanded ? '收起账号详情' : '展开账号详情'"
            type="button"
            @click="toggleAccountDetails"
          >
          <ChevronUp v-if="accountDetailsExpanded" class="account-details-chevron" :size="16" />
          <ChevronDown v-else class="account-details-chevron" :size="16" />
          </button>
        </div>

        <div v-if="accountDetailsExpanded" class="account-details-list">
          <div v-if="filteredPoolAccountDetails.length === 0" class="empty-line">暂无符合条件的账号</div>
          <article
            v-for="item in filteredPoolAccountDetails"
            :key="`${item.rank}-${item.name}`"
            class="account-detail-card"
            :class="item.status"
          >
            <div class="account-detail-card__head">
              <span class="account-detail-card__identity">
                <b>#{{ item.rank }}</b>
                <span>{{ item.name }}</span>
              </span>
              <span class="account-status-pill" :class="item.status">{{ item.statusText }}</span>
            </div>
            <div class="account-detail-card__meta">
              <span class="account-today-stats">
                <span>请求 <strong>{{ formatRequestCount(item.todayRequests) }}</strong></span>
                <span>Token <strong>{{ formatCompactTokenCount(item.todayTokens) }}</strong></span>
              </span>
              <span class="account-schedule-stack">
                <span class="schedule-pill" :class="{ off: !item.schedulable }">
                  <i></i>
                  {{ item.scheduleText }}
                </span>
                <span class="account-capacity-pill" :class="{ active: (item.capacityUsed ?? 0) > 0 }">{{ item.capacityText }}</span>
              </span>
              <span class="usage-windows">
                <span v-if="item.usageWindows.length === 0" class="usage-window empty">无可用窗口</span>
                <span v-for="window in item.usageWindows" :key="window.type" class="usage-window">
                  <span class="usage-window-label">{{ window.type }}</span>
                  <span class="usage-window-bar">
                    <i :style="{ width: formatAccountWindowWidth(window.remainingPercent) }"></i>
                  </span>
                  <span>{{ formatAccountWindowText(window) }}</span>
                </span>
              </span>
            </div>
          </article>
        </div>
      </div>

      <div v-else class="empty-line">配置管理员 API Key 后显示系统监控列表</div>
    </section>
  </main>

  <main v-else class="personal-shell" :class="{ collapsed: personalCollapsed }">
    <button
      v-if="personalCollapsed"
      class="collapsed-orb"
      :class="poolStatusClass"
      :style="poolFillStyle"
      type="button"
      title="展开个人信息"
      @click="toggleCollapsedOrb"
      @mousedown="startCollapsedOrbDrag"
    >
      <span>{{ formattedFirstToken }}</span>
      <em>{{ formattedPoolRemaining }}</em>
    </button>

    <section v-else class="orb" @mousedown.self="startWindowDrag">
      <div class="orb__header" @mousedown.self="startWindowDrag">
        <div class="orb__identity">
          <div class="orb__status" :class="statusClass"></div>
          <span>个人信息</span>
        </div>
        <div class="orb__actions">
          <button class="icon-button" type="button" title="折叠到屏幕边缘" @click.stop="togglePersonalCollapsed">
            <PanelRightClose :size="15" />
          </button>
          <button class="icon-button" type="button" title="关闭个人悬浮球" @click.stop="hidePersonalOrb">
            <X :size="15" />
          </button>
        </div>
      </div>

      <div class="metric-row">
        <span class="metric-row__label">今日 Token</span>
        <strong>{{ formattedPersonalToday }}</strong>
      </div>
      <div class="metric-row">
        <span class="metric-row__label">首 Token</span>
        <strong>{{ formattedFirstToken }}</strong>
      </div>

      <div class="orb__footer">
        <span>{{ footerText }}</span>
        <button class="icon-button" type="button" title="刷新" :disabled="loading" @click.stop="refreshAll">
          <RefreshCw :class="{ spinning: loading }" :size="15" />
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  ListChecks,
  MonitorDot,
  Network,
  PanelRightClose,
  RefreshCw,
  Users,
  X
} from 'lucide-vue-next'
import { fetchAdminMonitorMetrics, fetchSub2apiMetrics } from '@/domain/sub2apiClient'
import {
  formatCost,
  formatFirstToken,
  formatPoolAccountCount,
  formatPoolCapacity,
  formatTokenCount,
  type AdminMonitorMetrics,
  type PoolAccountUsageWindow,
  type PoolResetItem,
  type TokenOrbMetrics,
  type UserTodayUsageRankItem
} from '@/domain/tokenMetrics'
import {
  hasAdminSettings,
  hasPersonalSettings,
  loadSettings,
  saveSettings,
  settingsStorageKey,
  type AppSettings
} from '@/domain/settings'

type TauriWindowApi = typeof import('@tauri-apps/api/window')

interface FloatingState {
  x: number | null
  y: number | null
  collapsed: boolean
  expandedX: number | null
  expandedY: number | null
}

type AccountStatusFilter = 'normal' | 'limited' | 'error' | 'all'

const floatingStorageKey = 'token-orb-floating-v1'
const accountFilterStorageKey = 'token-orb-account-filter-v1'
const expandedSize = { width: 184, height: 132 }
const collapsedSize = { width: 44, height: 44 }
const settings = ref<AppSettings>(loadSettings())
const draft = reactive<AppSettings>(createSettingsDraft(settings.value))
const poolGroupNameInput = ref('')
const poolGroupInputRef = ref<HTMLInputElement | null>(null)
const personalMetrics = ref<TokenOrbMetrics>({ todayTokens: null, firstTokenMs: null, updatedAt: null })
const adminMetrics = ref<AdminMonitorMetrics>({
  todayTotalTokens: null,
  todayTotalCost: null,
  poolRemainingPercent: null,
  poolLatestResetAt: null,
  poolResetItems: [],
  poolAccounts: null,
  poolCapacity: null,
  poolAccountDetails: [],
  userRanking: [],
  updatedAt: null
})
const view = new URLSearchParams(window.location.search).get('view') ?? 'personal'
const isSettingsView = view === 'settings'
const isPlatformView = view === 'platform'
const isUpdaterView = view === 'updater'
const loading = ref(false)
const errorMessage = ref('')
const saveMessage = ref('')
const personalTokenTesting = ref(false)
const personalTokenTestState = ref<'success' | 'error' | ''>('')
const personalTokenTestMessage = ref('')
const personalCollapsed = ref(false)
const personalOrbDismissed = ref(false)
const accountDetailsExpanded = ref(false)
const selectedAccountStatus = ref<AccountStatusFilter>(loadAccountStatusFilter())
const rankingMode = ref<'tokens' | 'cost'>('tokens')
const platformUpdateAvailable = ref(false)
const appVersion = ref('0.1.0')
const updateVersion = ref('')
const updateBody = ref('')
const updateState = ref<'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'installed' | 'error'>('idle')
const updateMessage = ref('点击重新检查获取最新版本。')
const downloadPercent = ref<number | null>(null)
let availableUpdate: import('@tauri-apps/plugin-updater').Update | null = null
let timer: number | null = null
let saveMessageTimer: number | null = null
let unlistenMoved: (() => void) | null = null
let unlistenSettingsChanged: (() => void) | null = null
let tauriWindowApi: TauriWindowApi | null = null
let floatingWindowInitialized = false
let collapsedDragStarted = false
let collapsedDragStartAt = 0

const hasAdmin = computed(() => hasAdminSettings(settings.value))
const hasPersonal = computed(() => hasPersonalSettings(settings.value))
const formattedPersonalToday = computed(() => formatTokenCount(personalMetrics.value.todayTokens))
const formattedFirstToken = computed(() => formatFirstToken(personalMetrics.value.firstTokenMs))
const formattedAdminToday = computed(() => formatTokenCount(adminMetrics.value.todayTotalTokens))
const formattedAdminTodayCost = computed(() => formatCost(adminMetrics.value.todayTotalCost))
const formattedPoolAccounts = computed(() => formatPoolAccountCount(adminMetrics.value.poolAccounts))
const formattedPoolCapacity = computed(() => formatPoolCapacity(adminMetrics.value.poolCapacity))
const formattedPoolRemaining = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent
  return value === null ? '--' : `${Math.round(value)}%`
})
const formattedPoolLatestReset = computed(() => formatResetRemain(adminMetrics.value.poolLatestResetAt))
const formattedPoolResetItems = computed(() => adminMetrics.value.poolResetItems.map(formatPoolResetItem))
const displayedUserRanking = computed(() => sortUserRanking(adminMetrics.value.userRanking, rankingMode.value))
const filteredPoolAccountDetails = computed(() => {
  if (selectedAccountStatus.value === 'all') return adminMetrics.value.poolAccountDetails
  return adminMetrics.value.poolAccountDetails.filter((item) => item.status === selectedAccountStatus.value)
})
const poolProgressWidth = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent
  if (value === null || Number.isNaN(value)) return '0%'
  return `${Math.min(100, Math.max(0, value))}%`
})
const poolStatusClass = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent
  if (value === null || Number.isNaN(value)) return 'unknown'
  if (value < 10) return 'danger'
  if (value < 20) return 'warning'
  return 'healthy'
})
const poolFillStyle = computed(() => {
  const colorMap = {
    healthy: '#20e3b2',
    warning: '#f59e0b',
    danger: '#fb4d5f',
    unknown: '#64748b'
  }
  return {
    '--fill-level': poolProgressWidth.value,
    '--fill-color': colorMap[poolStatusClass.value]
  }
})
const platformWindowHeight = computed(() => {
  const rankingRows = hasAdmin.value ? Math.min(adminMetrics.value.userRanking.length, 10) : 0
  const accountDetailsRows = accountDetailsExpanded.value ? Math.min(filteredPoolAccountDetails.value.length, 6) : 0
  const accountDetailsHeight = accountDetailsExpanded.value ? 84 + accountDetailsRows * 66 : 72
  return Math.max(363, 253 + rankingRows * 42 + accountDetailsHeight)
})
const platformShellStyle = computed(() => ({ height: `${platformWindowHeight.value}px` }))
const statusClass = computed(() => {
  if (!hasAdmin.value && !hasPersonal.value) return 'idle'
  return errorMessage.value ? 'error' : 'online'
})
const footerText = computed(() => {
  if (!hasAdmin.value && !hasPersonal.value) return '待配置'
  if (errorMessage.value) return '连接异常'
  const updatedAt = personalMetrics.value.updatedAt || adminMetrics.value.updatedAt
  if (!updatedAt) return '待刷新'
  return new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
})
const platformUpdatedText = computed(() => {
  const updatedAt = adminMetrics.value.updatedAt || personalMetrics.value.updatedAt
  if (!updatedAt) return '待刷新'
  return new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
})
const updateBusy = computed(() => updateState.value === 'checking' || updateState.value === 'downloading')

async function refreshAll() {
  if (!hasAdmin.value && !hasPersonal.value) return
  loading.value = true
  errorMessage.value = ''
  const errors: string[] = []
  let successCount = 0
  try {
    if (hasAdmin.value) {
      try {
        await refreshAdmin()
        successCount += 1
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '管理员 API 请求失败')
      }
    }
    if (hasPersonal.value) {
      try {
        await refreshPersonal()
        successCount += 1
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '个人 JWT 请求失败')
      }
    }
    if (errors.length > 0 && successCount === 0) {
      errorMessage.value = errors[0] || '请求失败'
    }
  } finally {
    loading.value = false
  }
}

async function refreshPersonal() {
  if (!hasPersonal.value) return
  personalMetrics.value = await fetchSub2apiMetrics({
    baseUrl: settings.value.sub2apiBaseUrl,
    token: settings.value.personalToken
  })
}

async function refreshAdmin() {
  if (!hasAdmin.value) return
  adminMetrics.value = await fetchAdminMonitorMetrics({
    baseUrl: settings.value.sub2apiBaseUrl,
    apiKey: settings.value.adminApiKey,
    poolGroupNames: settings.value.poolGroupNames
  })
}

function toggleAccountDetails() {
  accountDetailsExpanded.value = !accountDetailsExpanded.value
}

function loadAccountStatusFilter(): AccountStatusFilter {
  const storedStatus = localStorage.getItem(accountFilterStorageKey)
  return storedStatus === 'normal' || storedStatus === 'limited' || storedStatus === 'error' || storedStatus === 'all'
    ? storedStatus
    : 'all'
}

function setAccountStatusFilter(status: AccountStatusFilter) {
  selectedAccountStatus.value = status
  localStorage.setItem(accountFilterStorageKey, status)
}

function formatAccountWindowWidth(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '0%'
  return `${Math.min(100, Math.max(0, Math.round(value)))}%`
}

function formatRequestCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

function formatCompactTokenCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value >= 1_000_000_000) return `${formatCompactNumber(value / 1_000_000_000)}B`
  if (value >= 1_000_000) return `${formatCompactNumber(value / 1_000_000)}M`
  if (value >= 1_000) return `${formatCompactNumber(value / 1_000)}K`
  return formatCompactNumber(value)
}

function formatCompactNumber(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

function sortUserRanking(items: UserTodayUsageRankItem[], mode: 'tokens' | 'cost'): UserTodayUsageRankItem[] {
  return [...items].sort((left, right) => {
    if (mode === 'cost') {
      const costDiff = (right.actualCost ?? 0) - (left.actualCost ?? 0)
      if (costDiff !== 0) return costDiff
    }

    const tokenDiff = right.tokens - left.tokens
    if (tokenDiff !== 0) return tokenDiff
    return (left.userId ?? 0) - (right.userId ?? 0)
  })
}

function formatAccountWindowText(item: PoolAccountUsageWindow): string {
  const remaining = Math.round(item.remainingPercent)
  const resetRemain = formatUsageWindowRemain(item.resetAt)
  return resetRemain === '--' ? `剩余 ${remaining}%` : `剩余 ${remaining}% · ${resetRemain}`
}

function formatUsageWindowRemain(value: string | null): string {
  if (!value) return '--'
  const resetAt = Date.parse(value)
  if (!Number.isFinite(resetAt)) return '--'
  const remainingMs = resetAt - Date.now()
  if (remainingMs <= 0) return '现在'
  const totalMinutes = Math.ceil(remainingMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

async function initUpdaterView() {
  if (!isUpdaterView) return
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = '0.1.0'
  }

  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      await listen('token-orb-check-update', () => {
        void checkForAppUpdate()
      })
    } catch {
      // 事件监听失败时仍允许手动点击检查。
    }
  }

  await checkForAppUpdate()
}

async function checkForAppUpdate() {
  updateState.value = 'checking'
  updateMessage.value = '正在检查更新...'
  updateVersion.value = ''
  updateBody.value = ''
  downloadPercent.value = null
  availableUpdate = null

  if (!('__TAURI_INTERNALS__' in window)) {
    updateState.value = 'error'
    updateMessage.value = 'Web 调试模式不支持在线更新，请在桌面应用中检查。'
    return
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      await syncTrayUpdateStatus(false)
      updateState.value = 'latest'
      updateMessage.value = '当前已经是最新版本。'
      return
    }

    await syncTrayUpdateStatus(true)
    availableUpdate = update
    updateVersion.value = update.version
    updateBody.value = update.body || '暂无更新说明。'
    updateState.value = 'available'
    updateMessage.value = '发现新版本，可以立即更新。'
  } catch (error) {
    updateState.value = 'error'
    updateMessage.value = error instanceof Error ? error.message : '检查更新失败'
  }
}

async function checkPlatformUpdate() {
  if (!isPlatformView || !('__TAURI_INTERNALS__' in window)) return
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    platformUpdateAvailable.value = (await check()) !== null
  } catch {
    platformUpdateAvailable.value = false
  }
}

async function openUpdateWindow() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('token-orb-open-update')
  } catch {
    // 更新窗口打开失败时保留平台页，不影响监控数据展示。
  }
}

async function syncTrayUpdateStatus(available: boolean) {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('token-orb-update-status', { available })
  } catch {
    // 托盘菜单状态同步失败不影响更新窗口本身。
  }
}

async function installAppUpdate() {
  if (!availableUpdate) return
  updateState.value = 'downloading'
  updateMessage.value = '正在下载更新...'
  downloadPercent.value = 0
  let downloaded = 0
  let total = 0

  try {
    await availableUpdate.download((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
        downloaded = 0
      }
      if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        downloadPercent.value = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
      }
      if (event.event === 'Finished') {
        downloadPercent.value = 100
        updateMessage.value = '下载完成，正在安装...'
      }
    })
    await availableUpdate.install()
    updateState.value = 'installed'
    updateMessage.value = '更新已安装，点击重启完成更新。'
  } catch (error) {
    updateState.value = 'error'
    updateMessage.value = error instanceof Error ? error.message : '更新安装失败'
  }
}

async function restartApp() {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

function saveDraft() {
  addPoolGroupName()
  settings.value = saveSettings({ ...draft })
  syncSettingsDraft(settings.value)
  personalTokenTestMessage.value = ''
  personalTokenTestState.value = ''
  showSaveMessage()
  scheduleRefresh()
  void refreshAll()
  void notifySettingsChanged()
}

async function testPersonalToken() {
  const baseUrl = draft.sub2apiBaseUrl.trim()
  const token = draft.personalToken.trim()
  personalTokenTestMessage.value = ''
  personalTokenTestState.value = ''
  if (!baseUrl) {
    personalTokenTestState.value = 'error'
    personalTokenTestMessage.value = '请先填写 Base URL'
    return
  }
  if (!token) {
    personalTokenTestState.value = 'error'
    personalTokenTestMessage.value = '请先填写个人 JWT'
    return
  }

  personalTokenTesting.value = true
  try {
    await fetchSub2apiMetrics({ baseUrl, token })
    personalTokenTestState.value = 'success'
    personalTokenTestMessage.value = '个人 JWT 正常'
  } catch (error) {
    personalTokenTestState.value = 'error'
    personalTokenTestMessage.value = formatErrorMessage(error, '个人 JWT 测试失败')
  } finally {
    personalTokenTesting.value = false
  }
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  if (typeof error === 'string' && error.trim() !== '') return error.trim()
  return fallback
}

function showSaveMessage() {
  saveMessage.value = '配置已保存'
  if (saveMessageTimer !== null) window.clearTimeout(saveMessageTimer)
  saveMessageTimer = window.setTimeout(() => {
    saveMessage.value = ''
    saveMessageTimer = null
  }, 2400)
}

function syncExternalSettingsChange(event: StorageEvent) {
  if (isUpdaterView) return
  if (event.key !== settingsStorageKey || event.newValue === null) return
  applyLatestSettings()
}

function applyLatestSettings() {
  settings.value = loadSettings()
  syncSettingsDraft(settings.value)
  scheduleRefresh()
  void refreshAll()
  void initFloatingWindow()
}

async function notifySettingsChanged() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('token-orb-settings-updated')
  } catch {
    // 浏览器 storage 事件仍作为非桌面环境的同步兜底。
  }
}

async function listenForSettingsChanges() {
  if (isSettingsView || isUpdaterView || !('__TAURI_INTERNALS__' in window)) return
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenSettingsChanged = await listen('token-orb-settings-updated', applyLatestSettings)
  } catch {
    // Tauri 事件不可用时保留浏览器 storage 事件同步。
  }
}

function createSettingsDraft(source: AppSettings): AppSettings {
  return {
    ...source,
    poolGroupNames: [...source.poolGroupNames]
  }
}

function syncSettingsDraft(source: AppSettings) {
  Object.assign(draft, createSettingsDraft(source))
}

function addPoolGroupName() {
  const name = poolGroupNameInput.value.trim()
  if (!name) return
  if (!draft.poolGroupNames.includes(name)) {
    draft.poolGroupNames.push(name)
  }
  draft.poolGroupName = draft.poolGroupNames[0] ?? ''
  poolGroupNameInput.value = ''
}

function removePoolGroupName(name: string) {
  draft.poolGroupNames = draft.poolGroupNames.filter((item) => item !== name)
  draft.poolGroupName = draft.poolGroupNames[0] ?? ''
}

function removeLastPoolGroupNameWhenEmpty() {
  if (poolGroupNameInput.value !== '' || draft.poolGroupNames.length === 0) return
  draft.poolGroupNames.pop()
  draft.poolGroupName = draft.poolGroupNames[0] ?? ''
}

function focusPoolGroupInput() {
  poolGroupInputRef.value?.focus()
}

function scheduleRefresh() {
  if (timer !== null) window.clearInterval(timer)
  timer = window.setInterval(refreshAll, settings.value.refreshSeconds * 1000)
}

async function startWindowDrag() {
  if (isSettingsView || isPlatformView) return
  const api = await loadTauriWindowApi()
  if (!api) return
  await api.getCurrentWindow().startDragging()
}

async function startCollapsedOrbDrag(event: MouseEvent) {
  if (event.button !== 0) return
  collapsedDragStarted = false
  collapsedDragStartAt = Date.now()
  const markDragged = () => {
    collapsedDragStarted = true
  }
  window.addEventListener('mousemove', markDragged, { once: true })
  window.setTimeout(() => {
    window.removeEventListener('mousemove', markDragged)
  }, 220)
  await startWindowDrag()
}

function toggleCollapsedOrb() {
  if (collapsedDragStarted || Date.now() - collapsedDragStartAt > 220) {
    collapsedDragStarted = false
    return
  }
  void togglePersonalCollapsed()
}

async function togglePersonalCollapsed() {
  const api = await loadTauriWindowApi()
  if (!api) {
    personalCollapsed.value = !personalCollapsed.value
    return
  }

  const appWindow = api.getCurrentWindow()
  const state = loadFloatingState()
  const monitor = await api.currentMonitor()
  const monitorX = monitor?.position.x ?? 0
  const monitorWidth = monitor?.size.width ?? 1440
  const scaleFactor = await appWindow.scaleFactor()
  const expandedPhysicalWidth = expandedSize.width * scaleFactor
  const collapsedPhysicalWidth = collapsedSize.width * scaleFactor
  const position = await appWindow.outerPosition()

  if (!personalCollapsed.value) {
    const edgeX = position.x + expandedPhysicalWidth / 2 < monitorX + monitorWidth / 2 ? monitorX : monitorX + monitorWidth - collapsedPhysicalWidth
    await appWindow.setSize(new api.LogicalSize(collapsedSize.width, collapsedSize.height))
    await appWindow.setPosition(new api.PhysicalPosition(edgeX, position.y))
    personalCollapsed.value = true
    saveFloatingState({ ...state, collapsed: true, expandedX: position.x, expandedY: position.y, x: edgeX, y: position.y })
    return
  }

  const fallbackX = position.x <= monitorX + 4 ? monitorX : monitorX + monitorWidth - expandedPhysicalWidth
  const nextX = state.expandedX ?? fallbackX
  const nextY = state.expandedY ?? position.y
  await appWindow.setSize(new api.LogicalSize(expandedSize.width, expandedSize.height))
  await appWindow.setPosition(new api.PhysicalPosition(nextX, nextY))
  personalCollapsed.value = false
  saveFloatingState({ ...state, collapsed: false, x: nextX, y: nextY })
}

async function hidePersonalOrb() {
  const api = await loadTauriWindowApi()
  if (!api) return
  await api.getCurrentWindow().hide()
  personalOrbDismissed.value = true
}

async function initFloatingWindow() {
  if (isSettingsView || isPlatformView) return
  const api = await loadTauriWindowApi()
  if (!api) return
  const appWindow = api.getCurrentWindow()
  if (!settings.value.personalFloatingEnabled) {
    personalOrbDismissed.value = false
    await appWindow.hide()
    return
  }
  if (personalOrbDismissed.value) return

  if (floatingWindowInitialized) {
    await appWindow.show()
    return
  }

  const state = loadFloatingState()
  personalCollapsed.value = state.collapsed
  await appWindow.setShadow(false)

  if (state.collapsed) {
    await appWindow.setSize(new api.LogicalSize(collapsedSize.width, collapsedSize.height))
  } else {
    await appWindow.setSize(new api.LogicalSize(expandedSize.width, expandedSize.height))
  }

  if (typeof state.x === 'number' && typeof state.y === 'number') {
    await appWindow.setPosition(new api.PhysicalPosition(state.x, state.y))
  }

  unlistenMoved = await appWindow.onMoved((event) => {
    const current = loadFloatingState()
    if (personalCollapsed.value) {
      saveFloatingState({ ...current, x: event.payload.x, y: event.payload.y })
      return
    }
    saveFloatingState({
      ...current,
      x: event.payload.x,
      y: event.payload.y,
      expandedX: event.payload.x,
      expandedY: event.payload.y
    })
  })
  floatingWindowInitialized = true
  await appWindow.show()
}

async function loadTauriWindowApi(): Promise<TauriWindowApi | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null
  if (tauriWindowApi) return tauriWindowApi
  try {
    tauriWindowApi = await import('@tauri-apps/api/window')
    return tauriWindowApi
  } catch {
    return null
  }
}

function loadFloatingState(): FloatingState {
  const fallback: FloatingState = { x: null, y: null, collapsed: false, expandedX: null, expandedY: null }
  const raw = localStorage.getItem(floatingStorageKey)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<FloatingState>
    return {
      x: typeof parsed.x === 'number' ? parsed.x : null,
      y: typeof parsed.y === 'number' ? parsed.y : null,
      collapsed: parsed.collapsed === true,
      expandedX: typeof parsed.expandedX === 'number' ? parsed.expandedX : null,
      expandedY: typeof parsed.expandedY === 'number' ? parsed.expandedY : null
    }
  } catch {
    return fallback
  }
}

function saveFloatingState(state: FloatingState) {
  localStorage.setItem(floatingStorageKey, JSON.stringify(state))
}

function formatResetRemain(value: string | null): string {
  if (!value) return '--'
  const resetAt = Date.parse(value)
  if (!Number.isFinite(resetAt)) return '--'
  const remainingMs = resetAt - Date.now()
  if (remainingMs <= 0) return '0m'
  const totalMinutes = Math.ceil(remainingMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function formatPoolResetItem(item: PoolResetItem) {
  const date = new Date(item.resetAt)
  return {
    resetAt: item.resetAt,
    statusClass: item.status,
    statusText: item.status === 'limited' ? '限流中' : '正常',
    displayTime: Number.isNaN(date.getTime())
      ? '--'
      : date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
  }
}

onMounted(() => {
  window.addEventListener('storage', syncExternalSettingsChange)
  if (isUpdaterView) {
    void initUpdaterView()
    return
  }
  scheduleRefresh()
  void listenForSettingsChanges()
  void refreshAll()
  void checkPlatformUpdate()
  void initFloatingWindow()
})

watch(platformWindowHeight, async (height) => {
  if (!isPlatformView) return
  const api = await loadTauriWindowApi()
  if (!api) return
  await api.getCurrentWindow().setSize(new api.LogicalSize(410, height))
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('storage', syncExternalSettingsChange)
  if (timer !== null) window.clearInterval(timer)
  if (saveMessageTimer !== null) window.clearTimeout(saveMessageTimer)
  if (unlistenMoved) unlistenMoved()
  if (unlistenSettingsChanged) unlistenSettingsChanged()
})
</script>
