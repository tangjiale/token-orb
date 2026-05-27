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

      <label class="field">
        <span>个人 JWT / Bearer Token（可选）</span>
        <input v-model="draft.personalToken" type="password" placeholder="用于悬浮球个人数据" />
      </label>

      <label class="field">
        <span>号池分组名称（可选）</span>
        <input v-model="draft.poolGroupName" placeholder="留空统计全部正常账号" />
      </label>

      <label class="field compact-field">
        <span>刷新间隔</span>
        <input v-model.number="draft.refreshSeconds" min="10" max="300" step="5" type="number" />
        <em>秒</em>
      </label>

      <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

      <div class="settings-panel__actions">
        <button class="primary-button" type="button" @click="saveDraft">保存配置</button>
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
        <strong>v{{ appVersion }}</strong>
      </div>

      <div v-if="updateVersion" class="update-summary">
        <span>最新版本</span>
        <strong>v{{ updateVersion }}</strong>
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
        <time>{{ platformUpdatedText }}</time>
      </div>

      <div v-if="hasAdmin" class="monitor-grid">
        <article class="monitor-card">
          <span>今日总 Token</span>
          <strong>{{ formattedAdminToday }}</strong>
        </article>
        <article class="monitor-card">
          <span>5小时号池剩余量</span>
          <strong :class="poolStatusClass">{{ formattedPoolRemaining }}</strong>
          <div class="pool-progress" :class="poolStatusClass">
            <i :style="{ width: poolProgressWidth }"></i>
          </div>
        </article>
      </div>

      <div v-if="hasAdmin" class="ranking-box">
        <div class="section-title">
          <Users :size="16" />
          <span>今日用户用量榜</span>
        </div>
        <div v-if="adminMetrics.userRanking.length === 0" class="empty-line">暂无数据</div>
        <div v-for="item in adminMetrics.userRanking" :key="item.userId ?? item.displayName" class="ranking-row">
          <b>#{{ item.rank }}</b>
          <span>{{ item.displayName }}</span>
          <strong>{{ formatTokenCount(item.tokens) }}</strong>
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
  ListChecks,
  MonitorDot,
  PanelRightClose,
  RefreshCw,
  Users
} from 'lucide-vue-next'
import { fetchAdminMonitorMetrics, fetchSub2apiMetrics } from '@/domain/sub2apiClient'
import {
  formatFirstToken,
  formatTokenCount,
  type AdminMonitorMetrics,
  type TokenOrbMetrics
} from '@/domain/tokenMetrics'
import {
  hasAdminSettings,
  hasPersonalSettings,
  loadSettings,
  saveSettings,
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

const floatingStorageKey = 'token-orb-floating-v1'
const expandedSize = { width: 184, height: 132 }
const collapsedSize = { width: 44, height: 44 }
const settings = ref<AppSettings>(loadSettings())
const draft = reactive<AppSettings>({ ...settings.value })
const personalMetrics = ref<TokenOrbMetrics>({ todayTokens: null, firstTokenMs: null, updatedAt: null })
const adminMetrics = ref<AdminMonitorMetrics>({
  todayTotalTokens: null,
  poolRemainingPercent: null,
  userRanking: [],
  updatedAt: null
})
const view = new URLSearchParams(window.location.search).get('view') ?? 'personal'
const isSettingsView = view === 'settings'
const isPlatformView = view === 'platform'
const isUpdaterView = view === 'updater'
const loading = ref(false)
const errorMessage = ref('')
const personalCollapsed = ref(false)
const appVersion = ref('0.1.0')
const updateVersion = ref('')
const updateBody = ref('')
const updateState = ref<'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'installed' | 'error'>('idle')
const updateMessage = ref('点击重新检查获取最新版本。')
const downloadPercent = ref<number | null>(null)
let availableUpdate: import('@tauri-apps/plugin-updater').Update | null = null
let timer: number | null = null
let unlistenMoved: (() => void) | null = null
let tauriWindowApi: TauriWindowApi | null = null
let collapsedDragStarted = false
let collapsedDragStartAt = 0

const hasAdmin = computed(() => hasAdminSettings(settings.value))
const hasPersonal = computed(() => hasPersonalSettings(settings.value))
const formattedPersonalToday = computed(() => formatTokenCount(personalMetrics.value.todayTokens))
const formattedFirstToken = computed(() => formatFirstToken(personalMetrics.value.firstTokenMs))
const formattedAdminToday = computed(() => formatTokenCount(adminMetrics.value.todayTotalTokens))
const formattedPoolRemaining = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent
  return value === null ? '--' : `${Math.round(value)}%`
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
const platformShellStyle = computed(() => {
  const rankingRows = hasAdmin.value ? Math.min(adminMetrics.value.userRanking.length, 10) : 0
  const height = Math.max(300, 226 + rankingRows * 30)
  return { height: `${height}px` }
})
const platformWindowHeight = computed(() => {
  const rankingRows = hasAdmin.value ? Math.min(adminMetrics.value.userRanking.length, 10) : 0
  return Math.max(300, 226 + rankingRows * 30)
})
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
  try {
    await Promise.all([refreshPersonal(), refreshAdmin()])
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '请求失败'
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
    poolGroupName: settings.value.poolGroupName
  })
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
      updateState.value = 'latest'
      updateMessage.value = '当前已经是最新版本。'
      return
    }

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
  settings.value = saveSettings({ ...draft })
  scheduleRefresh()
  void refreshAll()
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

async function initFloatingWindow() {
  if (isSettingsView || isPlatformView) return
  const api = await loadTauriWindowApi()
  if (!api) return
  const appWindow = api.getCurrentWindow()
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

onMounted(() => {
  if (isUpdaterView) {
    void initUpdaterView()
    return
  }
  scheduleRefresh()
  void refreshAll()
  void initFloatingWindow()
})

watch(platformWindowHeight, async (height) => {
  if (!isPlatformView) return
  const api = await loadTauriWindowApi()
  if (!api) return
  await api.getCurrentWindow().setSize(new api.LogicalSize(370, height))
}, { immediate: true })

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
  if (unlistenMoved) unlistenMoved()
})
</script>
