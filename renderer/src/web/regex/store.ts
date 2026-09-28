/**
 * Poe Regex 面板的狀態(WP5)。模組層級單例:切到別的設定分頁再回來、關掉設定再開,勾選與篩選都還在。
 *
 * - 清單:`./data/regex/regex_<game>.json`(dev 由 vite 的 serveDataDir 供應,prod 在 `app://…/data/regex/`),
 *   兩個遊戲都載(書籤跨遊戲要查頁名、舊書籤要由 page id 補 game),一檔壞不拖垮另一檔(regex_data.cpp `Load`)。
 * - 記憶:`regex/src/state.ts` 的 `RegexUiState`,經 `Host.regexStateLoad/Save`(main 寫 `userData/regex_state.json`,
 *   tmp + rename;純瀏覽器 localStorage)。所有改變勾選的動作都走 `picksChanged()`,只有一個地方可能忘了存。
 * - 行為移植自 PobTools `host/regex_tool_ui.cpp`(`restoreState` :308、`switchGame` :1006、`loadBookmark` :832、
 *   `updateBookmark` :868、`commitName` :944)。
 */
import { computed, reactive, shallowRef } from 'vue'
import {
  applyKeys, buildCorpus, collectKeys, defaultRegexState, parseRegexCatalogue, parseRegexState, picksFor,
  serializeRegexState, visibleRows,
  type Mode, type RegexBookmark, type RegexCatalogue, type RegexGame, type RegexLang, type RegexPage, type Result,
  type T17Filter, type RegexUiState
} from '@exile-appraiser/regex'
import { Host } from '@/web/background/IPC'
import { AppConfig } from '@/web/Config'

export const GAMES: readonly RegexGame[] = ['poe1', 'poe2']
export const gameLabel = (g: RegexGame | ''): string => g === 'poe2' ? 'PoE2' : g === 'poe1' ? 'PoE1' : '?'

/** 面板顯示的一次性訊息(書籤載入、還原不到的鍵…),以 i18n 鍵 + 參數表示,切介面語言也跟著換 */
export interface Notice { key: string, params?: Record<string, string | number> }

type LoadPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface PageView {
  search: string
  group: number
  t17: T17Filter
}

const catalogues = reactive<Record<RegexGame, { phase: LoadPhase, error: string, cat: RegexCatalogue | null }>>({
  poe1: { phase: 'idle', error: '', cat: null },
  poe2: { phase: 'idle', error: '', cat: null }
})

/** 記憶狀態(存檔的內容);UI 讀寫都經過這份 */
const ui = reactive<RegexUiState>(defaultRegexState())
/** 每頁勾選(列索引,遞增);與 `ui.current` 同步(後者是鍵) */
const picks = reactive<Record<string, number[]>>({})
/** 每頁篩選(不存檔,C++ 也不存) */
const views = reactive<Record<string, PageView>>({})
const selGame = shallowRef<RegexGame>('poe1')
const selPageId = shallowRef('')
const notice = shallowRef<Notice | null>(null)
const saveError = shallowRef('')
const stateLoaded = shallowRef(false)
/** 已經套用過 `ui.current` 的頁(每頁只還原一次) */
const restored = new Set<string>()

// ---- 載入 ----------------------------------------------------------------------

async function fetchCatalogue (game: RegexGame): Promise<void> {
  const slot = catalogues[game]
  slot.phase = 'loading'
  slot.error = ''
  try {
    const res = await fetch(`./data/regex/regex_${game}.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const cat = parseRegexCatalogue(await res.text(), game)
    if (!cat.pages.length) throw new Error('no pages')
    slot.cat = cat
    slot.phase = 'ready'
    onCatalogueReady(cat)
  } catch (e) {
    slot.cat = null
    slot.phase = 'error'
    slot.error = e instanceof Error ? e.message : String(e)
    console.error(`[regex] 清單載入失敗 ${game}`, e)
  }
}

let started: Promise<void> | null = null

/** 面板第一次掛上時呼叫;`preferGame` = 目前 AppConfig().game(面板預設跟著目前遊戲,記住的頁屬於它才沿用) */
export function ensureStarted (preferGame: RegexGame): Promise<void> {
  if (started) return started
  selGame.value = preferGame
  started = (async () => {
    try {
      const text = await Host.regexStateLoad()
      if (text) {
        const r = parseRegexState(text)
        if (r.ok) Object.assign(ui, r.state)
        else console.warn('[regex] regex_state 無法解析,改用預設值')
      }
    } catch (e) {
      console.warn('[regex] regex_state 讀取失敗', e)
    }
    stateLoaded.value = true
    await Promise.all(GAMES.map(fetchCatalogue))
  })()
  return started
}

export function retryCatalogue (game: RegexGame): void {
  void fetchCatalogue(game)
}

function onCatalogueReady (cat: RegexCatalogue): void {
  // 舊書籤沒有 game:由 page id 補上並寫回(regex_tool_ui.cpp restoreState :319)
  let dirty = false
  for (const b of ui.bookmarks) {
    if (b.game || !cat.pages.some(p => p.id === b.page)) continue
    b.game = cat.game
    dirty = true
  }
  // 上次的勾選(每頁一次);還原不到的計數回報,不靜默丟掉
  let missedTotal = 0
  let firstPage = ''
  for (const page of cat.pages) {
    if (!views[page.id]) views[page.id] = { search: '', group: -1, t17: 'all' }
    if (restored.has(page.id)) continue
    restored.add(page.id)
    const saved = ui.current.find(p => p.page === page.id)
    if (!saved) continue
    const r = applyKeys(page, saved.keys, saved.alt)
    picks[page.id] = r.picked
    if (r.missed > 0) {
      missedTotal += r.missed
      if (!firstPage) firstPage = (AppConfig().uiLanguage === 'en' ? page.titleEn : '') || page.title
    }
  }
  if (missedTotal > 0) notice.value = { key: 'ppz.regex.notice_restore_missed', params: { n: missedTotal, page: firstPage } }
  // 目前選的遊戲的清單到了:選頁(記住的頁若屬於這個遊戲就用它)
  if (cat.game === selGame.value && !cat.pages.some(p => p.id === selPageId.value)) {
    selPageId.value = cat.pages.some(p => p.id === ui.page) ? ui.page : cat.pages[0].id
  }
  if (dirty) scheduleSave()
}

// ---- 存檔 ----------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<void> = Promise.resolve()

export function scheduleSave (): void {
  if (!stateLoaded.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void flushSave() }, 300)
}

/** 有排定的存檔就立刻寫(面板卸載時);回傳這一次寫入完成的 promise */
export function flushSave (): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (!stateLoaded.value) return saving
  const text = serializeRegexState(ui)
  saving = saving.then(async () => {
    try {
      await Host.regexStateSave(text)
      saveError.value = ''
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : String(e)
      console.error('[regex] regex_state 存檔失敗', e)
    }
  })
  return saving
}

export function hasPendingSave (): boolean {
  return saveTimer != null
}

// ---- 選擇 ----------------------------------------------------------------------

const catalogue = computed(() => catalogues[selGame.value].cat)
const page = computed<RegexPage | null>(() => {
  const cat = catalogue.value
  if (!cat) return null
  return cat.pages.find(p => p.id === selPageId.value) ?? cat.pages[0] ?? null
})

function pageById (id: string): RegexPage | null {
  for (const g of GAMES) {
    const p = catalogues[g].cat?.pages.find(x => x.id === id)
    if (p) return p
  }
  return null
}

/** views 在清單載入時就為每頁建好(onCatalogueReady),computed 裡只讀不寫 */
const NO_VIEW: PageView = { search: '', group: -1, t17: 'all' }
function viewOf (id: string): PageView {
  return views[id] ?? NO_VIEW
}

const view = computed<PageView>(() => page.value ? viewOf(page.value.id) : NO_VIEW)
const picked = computed<number[]>(() => page.value ? (picks[page.value.id] ?? []) : [])
const pickedSet = computed(() => new Set(picked.value))
const visible = computed(() => page.value ? visibleRows(page.value, pickedSet.value, view.value) : [])

/** 語料以整頁建(不是只拿勾選的):「這段字會不會也中別的」是對整份清單問的(regex_tool_ui.cpp:1055) */
const result = computed<Result | null>(() => {
  const p = page.value
  if (!p) return null
  return buildCorpus(p, ui.lang).build(picked.value, ui.mode)
})

function picksChanged (): void {
  const p = page.value
  if (!p) return
  const k = collectKeys(p, picks[p.id] ?? [])
  const slot = picksFor(ui, p.id)
  slot.keys = k.keys
  slot.alt = k.alt
  ui.game = selGame.value
  ui.page = p.id
  scheduleSave()
}

function setPicks (list: Iterable<number>): void {
  const p = page.value
  if (!p) return
  picks[p.id] = [...new Set(list)].sort((a, b) => a - b)
  picksChanged()
}

export function togglePick (i: number, on: boolean): void {
  const s = new Set(picked.value)
  if (on) s.add(i)
  else s.delete(i)
  setPicks(s)
}

/** 全選「目前篩選出來的」(不動其他已勾選) */
export function selectVisible (): void {
  setPicks([...picked.value, ...visible.value])
}

export function clearPicks (): void {
  setPicks([])
}

/** 換遊戲 = 換到它的第一份清單;每頁的勾選都留著 */
export function switchGame (g: RegexGame): void {
  if (g === selGame.value) return
  selGame.value = g
  const cat = catalogues[g].cat
  selPageId.value = cat?.pages[0]?.id ?? ''
  ui.game = g
  if (cat) ui.page = selPageId.value
  scheduleSave()
}

export function switchPage (id: string): void {
  if (id === selPageId.value) return
  selPageId.value = id
  ui.game = selGame.value
  ui.page = id
  scheduleSave()
}

export function setMode (m: Mode): void {
  if (m === ui.mode) return
  ui.mode = m
  scheduleSave()
}

export function setLang (l: RegexLang): void {
  if (l === ui.lang) return
  ui.lang = l
  scheduleSave()
}

export function setBilingual (on: boolean): void {
  ui.bilingual = on
  scheduleSave()
}

// ---- 書籤 ----------------------------------------------------------------------

/** 目前遊戲的書籤數、另一個遊戲的(被過濾掉的)數、找不到清單的孤兒數(regex_tool_ui.cpp drawBookmarks :739) */
const bookmarkCounts = computed(() => {
  let mine = 0; let elsewhere = 0; let orphans = 0
  for (const b of ui.bookmarks) {
    if (!b.game) orphans++
    else if (b.game === selGame.value) mine++
    else elsewhere++
  }
  return { mine, elsewhere, orphans }
})

/** 目前遊戲的書籤(帶原始索引,改名/刪除用) */
const myBookmarks = computed(() => ui.bookmarks
  .map((b, index) => ({ b, index }))
  .filter(x => x.b.game === selGame.value))

function currentBookmarkBody (): Omit<RegexBookmark, 'name'> | null {
  const p = page.value
  if (!p) return null
  const k = collectKeys(p, picked.value)
  if (!k.keys.length) return null
  return { page: p.id, game: selGame.value, mode: ui.mode, lang: ui.lang, keys: k.keys, alt: k.alt }
}

export function saveBookmark (name: string): boolean {
  const body = currentBookmarkBody()
  if (!body || !name) return false
  ui.bookmarks.push({ name, ...body })
  notice.value = { key: 'ppz.regex.notice_saved', params: { name } }
  scheduleSave()
  return true
}

/** 用目前的清單、模式、輸出語言與勾選覆寫;一項都沒勾就不動(要清空請刪除) */
export function updateBookmark (index: number): void {
  const b = ui.bookmarks[index]
  if (!b) return
  const body = currentBookmarkBody()
  if (!body) {
    notice.value = { key: 'ppz.regex.notice_update_empty' }
    return
  }
  Object.assign(b, body)
  notice.value = { key: 'ppz.regex.notice_updated', params: { name: b.name } }
  scheduleSave()
}

export function renameBookmark (index: number, name: string): void {
  const b = ui.bookmarks[index]
  if (!b || !name) return
  b.name = name
  notice.value = { key: 'ppz.regex.notice_renamed', params: { name } }
  scheduleSave()
}

export function deleteBookmark (index: number): void {
  const b = ui.bookmarks[index]
  if (!b) return
  ui.bookmarks.splice(index, 1)
  notice.value = { key: 'ppz.regex.notice_deleted', params: { name: b.name } }
  scheduleSave()
}

export function loadBookmark (index: number): void {
  const b = ui.bookmarks[index]
  if (!b) return
  const target = pageById(b.page)
  if (!target) {
    notice.value = { key: 'ppz.regex.notice_missing_page', params: { name: b.name, page: b.page } }
    return
  }
  // 書籤自帶遊戲:載入後選擇器一定指向它
  selGame.value = target.game
  selPageId.value = target.id
  ui.mode = b.mode
  ui.lang = b.lang
  const r = applyKeys(target, b.keys, b.alt)
  picks[target.id] = r.picked
  notice.value = r.missed > 0
    ? { key: 'ppz.regex.notice_loaded_missed', params: { name: b.name, n: r.missed } }
    : { key: 'ppz.regex.notice_loaded', params: { name: b.name } }
  picksChanged()
}

export function dismissNotice (): void {
  notice.value = null
}

export function useRegexStore () {
  return {
    catalogues,
    ui,
    selGame,
    page,
    catalogue,
    view,
    picked,
    pickedSet,
    visible,
    result,
    notice,
    saveError,
    bookmarkCounts,
    myBookmarks,
    pageById
  }
}
