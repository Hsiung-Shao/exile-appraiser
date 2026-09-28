/**
 * Poe Regex 面板的狀態(WP5 + WP-C)。模組層級單例:切到別的設定分頁再回來、關掉設定再開,勾選與篩選都還在。
 *
 * - 清單:`./data/regex/regex_<game>.json`(dev 由 vite 的 serveDataDir 供應,prod 在 `app://…/data/regex/`),
 *   兩個遊戲都載(書籤跨遊戲要查頁名、舊書籤要由 page id 補 game),一檔壞不拖垮另一檔(regex_data.cpp `Load`)。
 * - 演算法頁(WP-C):清單檔自帶 `labels`(schema 2)逐鍵優先,暫代檔 `./data/regex/labels.<game>.json` 補缺鍵,
 *   再以 `algoPages()` 組出數值頁 / 商店頁接在語料頁後面(同一個 `cat.pages`,清單、勾選、書籤共用)。
 * - 合併:`combined` = 目前遊戲所有有勾選的頁 + 自訂文字 + 排除詞 經 `combine()` 合成一串(regex/src/combine.ts)。
 * - 範本 `./data/regex/templates.json`、分享碼(regex/src/share.ts)都走 `applyCombo()`:覆蓋目前遊戲全部頁的勾選。
 * - 記憶:`regex/src/state.ts` 的 `RegexUiState`(schema 2 多了 numeric / custom / excludes / outScope),
 *   經 `Host.regexStateLoad/Save`(main 寫 `userData/regex_state.json`,tmp + rename;純瀏覽器 localStorage)。
 *   所有改變勾選的動作都走 `picksChanged()`,只有一個地方可能忘了存。
 * - 行為移植自 PobTools `host/regex_tool_ui.cpp`(`restoreState` :308、`switchGame` :1006、`loadBookmark` :832、
 *   `updateBookmark` :868、`commitName` :944)。
 */
import { computed, reactive, shallowRef } from 'vue'
import {
  algoPages, applyPageKeys, mergeLabels, buildCorpus, combine, decodeShare, defaultRegexState, encodeShare, isAlgoPage, pageKeysOf,
  parseLabels, parseRegexCatalogue, parseRegexState, parseTemplates, picksFor, resolveState, serializeRegexState, visibleRows,
  type AlgoEntry, type AlgoValue, type CombineResult, type CombineSel, type Mode, type RegexBookmark, type RegexCatalogue,
  type RegexGame, type RegexLabels, type RegexLang, type RegexPage, type RegexTemplate, type Result, type ShareState, type T17Filter,
  type RegexUiState
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

/** 清單區顯示:合併檢視(已選)或單頁清單 */
export type PanelView = 'combined' | 'page'

const catalogues = reactive<Record<RegexGame, { phase: LoadPhase, error: string, cat: RegexCatalogue | null, labelsFrom: '' | 'data' | 'fallback' }>>({
  poe1: { phase: 'idle', error: '', cat: null, labelsFrom: '' },
  poe2: { phase: 'idle', error: '', cat: null, labelsFrom: '' }
})

/** 記憶狀態(存檔的內容);UI 讀寫都經過這份 */
const ui = reactive<RegexUiState>(defaultRegexState())
/** 每頁勾選(列索引,遞增);與 `ui.current` 同步(後者是鍵) */
const picks = reactive<Record<string, number[]>>({})
/** 每頁篩選(不存檔,C++ 也不存) */
const views = reactive<Record<string, PageView>>({})
const selGame = shallowRef<RegexGame>('poe1')
const selPageId = shallowRef('')
const panelView = shallowRef<PanelView>('page')
const notice = shallowRef<Notice | null>(null)
const saveError = shallowRef('')
const stateLoaded = shallowRef(false)
const templates = shallowRef<RegexTemplate[]>([])
/** 已經套用過 `ui.current` 的頁(每頁只還原一次) */
const restored = new Set<string>()

// ---- 載入 ----------------------------------------------------------------------

async function fetchText (url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

async function fetchCatalogue (game: RegexGame): Promise<void> {
  const slot = catalogues[game]
  slot.phase = 'loading'
  slot.error = ''
  try {
    const cat = parseRegexCatalogue(await fetchText(`./data/regex/regex_${game}.json`), game)
    if (!cat.pages.length) throw new Error('no pages')
    // 演算法頁:資料檔自帶 labels(schema 2)逐鍵優先,暫代檔 labels.<game>.json 補缺鍵;兩者都沒有 = 只有語料頁(不擋主清單)
    let fallback: RegexLabels | null = null
    try {
      fallback = parseLabels(await fetchText(`./data/regex/labels.${game}.json`))
    } catch (e) {
      console.warn(`[regex] labels.${game}.json 載入失敗`, e)
    }
    const labels = mergeLabels(cat.labels, fallback)
    slot.labelsFrom = cat.labels ? 'data' : fallback ? 'fallback' : ''
    cat.pages.push(...algoPages(game, labels))
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

async function fetchTemplates (): Promise<void> {
  try {
    const r = parseTemplates(await fetchText('./data/regex/templates.json'))
    if (r.errors.length) console.warn('[regex] templates.json 有壞掉的範本', r.errors)
    templates.value = r.templates
  } catch (e) {
    console.warn('[regex] templates.json 載入失敗', e)
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
    await Promise.all([...GAMES.map(fetchCatalogue), fetchTemplates()])
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
    const r = applyPageKeys(page, saved.keys, saved.alt)
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

/** 語料以整頁建(不是只拿勾選的):「這段字會不會也中別的」是對整份清單問的(regex_tool_ui.cpp:1055)。演算法頁 = null */
const result = computed<Result | null>(() => {
  const p = page.value
  if (!p || isAlgoPage(p)) return null
  return buildCorpus(p, ui.lang).build(picked.value, ui.mode)
})

/** 演算法頁項目目前的值(沒存過 = 預設值) */
export function valueOf (pageId: string, e: AlgoEntry): AlgoValue {
  return ui.numeric[pageId]?.[e.id] ?? e.input.def
}

function selOf (p: RegexPage): CombineSel {
  return { page: p, picks: picks[p.id] ?? [], values: ui.numeric[p.id] }
}

/** 目前這一頁單獨的輸出(語料頁 = build().query;演算法頁 = 該頁 term) */
const pageCombined = computed<CombineResult | null>(() => {
  const p = page.value
  if (!p) return null
  return combine({ lang: ui.lang, mode: ui.mode, pages: [selOf(p)] })
})

/** 目前遊戲所有有勾選的頁 + 自訂文字 + 排除詞 */
const combined = computed<CombineResult | null>(() => {
  const cat = catalogue.value
  if (!cat) return null
  return combine({
    lang: ui.lang,
    mode: ui.mode,
    pages: cat.pages.filter(p => (picks[p.id]?.length ?? 0) > 0).map(selOf),
    custom: ui.custom,
    excludes: ui.excludes
  })
})

/** 目前遊戲各頁勾選數(合併檢視用) */
const pickedPages = computed(() => (catalogue.value?.pages ?? [])
  .map(p => ({ page: p, n: picks[p.id]?.length ?? 0 }))
  .filter(x => x.n > 0))

function syncCurrent (p: RegexPage): void {
  const k = pageKeysOf(p, picks[p.id] ?? [])
  const slot = picksFor(ui, p.id)
  slot.keys = k.keys
  slot.alt = k.alt
}

function picksChanged (): void {
  const p = page.value
  if (!p) return
  syncCurrent(p)
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

/** 演算法頁:改值(順手勾起該列——改了值卻沒勾,輸出不會變,容易以為沒生效) */
export function setValue (pageId: string, e: AlgoEntry, v: AlgoValue, tick = true): void {
  const m = { ...(ui.numeric[pageId] ?? {}) }
  m[e.id] = { ...v }
  ui.numeric[pageId] = m
  const p = page.value
  if (tick && p && p.id === pageId) {
    const i = p.entries.indexOf(e)
    if (i >= 0 && !pickedSet.value.has(i)) { togglePick(i, true); return }
  }
  scheduleSave()
}

/** 清除目前遊戲所有頁的勾選(合併檢視的「全部清除」) */
export function clearAllPicks (): void {
  const cat = catalogue.value
  if (!cat) return
  for (const p of cat.pages) {
    if (!picks[p.id]?.length) continue
    picks[p.id] = []
    syncCurrent(p)
  }
  scheduleSave()
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
  panelView.value = 'page'
  if (id === selPageId.value) return
  selPageId.value = id
  ui.game = selGame.value
  ui.page = id
  scheduleSave()
}

export function setPanelView (v: PanelView): void {
  panelView.value = v
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

export function setOutScope (s: 'combined' | 'page'): void {
  if (s === ui.outScope) return
  ui.outScope = s
  scheduleSave()
}

// ---- 自訂文字 / 排除詞 ----------------------------------------------------------

export function addCustom (kind: 'custom' | 'excludes', text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const list = ui[kind]
  if (list.includes(t)) return false
  ui[kind] = [...list, t]
  scheduleSave()
  return true
}

export function removeCustom (kind: 'custom' | 'excludes', index: number): void {
  const list = ui[kind].slice()
  list.splice(index, 1)
  ui[kind] = list
  scheduleSave()
}

// ---- 範本 / 分享碼 --------------------------------------------------------------

/** 目前遊戲的勾選 → ShareState(只含有勾選的頁;數值只含已勾選項目) */
export function currentShareState (): ShareState | null {
  const cat = catalogue.value
  if (!cat) return null
  const s: ShareState = { v: 1, game: selGame.value, mode: ui.mode, pages: {}, numeric: {}, custom: [...ui.custom], excludes: [...ui.excludes] }
  for (const p of cat.pages) {
    const pk = picks[p.id] ?? []
    if (!pk.length) continue
    s.pages[p.id] = pageKeysOf(p, pk).keys
    if (isAlgoPage(p)) {
      const m: Record<string, AlgoValue> = {}
      for (const i of pk) {
        const e = p.entries[i]
        m[e.id] = { ...valueOf(p.id, e) }
      }
      s.numeric[p.id] = m
    }
  }
  return s
}

export async function makeShareCode (): Promise<string> {
  const s = currentShareState()
  if (!s) throw new Error('lists not loaded')
  return await encodeShare(s)
}

/**
 * 套用 ShareState(範本 / 分享碼):**覆蓋**該遊戲全部頁的勾選、數值、自訂文字、排除詞與模式。
 * 還原不到的鍵與不存在的頁計數回報。
 */
function applyCombo (s: ShareState, what: 'template' | 'share', name: string): void {
  const cat = catalogues[s.game].cat
  if (!cat) {
    notice.value = { key: 'ppz.regex.notice_combo_not_loaded', params: { game: gameLabel(s.game) } }
    return
  }
  if (s.game !== selGame.value) switchGame(s.game)
  const r = resolveState(s, cat.pages)
  for (const p of cat.pages) {
    picks[p.id] = r.picks[p.id] ?? []
    syncCurrent(p)
    if (isAlgoPage(p)) ui.numeric[p.id] = { ...(ui.numeric[p.id] ?? {}), ...(r.values[p.id] ?? {}) }
  }
  ui.custom = [...s.custom]
  ui.excludes = [...s.excludes]
  ui.mode = s.mode
  ui.game = s.game
  ui.outScope = 'combined'
  panelView.value = 'combined'
  const lost = r.missed
  notice.value = lost > 0 || r.unknownPages.length
    ? { key: `ppz.regex.notice_${what}_missed`, params: { name, n: lost, pages: r.unknownPages.join(', ') || '-' } }
    : { key: `ppz.regex.notice_${what}_applied`, params: { name } }
  scheduleSave()
}

export function applyTemplate (t: RegexTemplate): void {
  applyCombo(t.state, 'template', AppConfig().uiLanguage === 'en' ? t.name.en : t.name.zh)
}

/** 貼上分享碼 = 套用;失敗丟例外(訊息給 UI 顯示) */
export async function applyShareCode (code: string): Promise<string[]> {
  const d = await decodeShare(code)
  applyCombo(d.state, 'share', gameLabel(d.state.game))
  return d.warnings
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
  const k = pageKeysOf(p, picked.value)
  if (!k.keys.length) return null
  const body: Omit<RegexBookmark, 'name'> = { page: p.id, game: selGame.value, mode: ui.mode, lang: ui.lang, keys: k.keys, alt: k.alt }
  if (isAlgoPage(p)) {
    const m: Record<string, AlgoValue> = {}
    for (const i of picked.value) m[p.entries[i].id] = { ...valueOf(p.id, p.entries[i]) }
    body.numeric = m
  }
  return body
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
  if (!body.numeric) delete b.numeric
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
  panelView.value = 'page'
  ui.mode = b.mode
  ui.lang = b.lang
  const r = applyPageKeys(target, b.keys, b.alt)
  picks[target.id] = r.picked
  if (b.numeric && isAlgoPage(target)) ui.numeric[target.id] = { ...(ui.numeric[target.id] ?? {}), ...b.numeric }
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
    picks,
    selGame,
    page,
    catalogue,
    view,
    picked,
    pickedSet,
    visible,
    result,
    pageCombined,
    combined,
    pickedPages,
    panelView,
    templates,
    notice,
    saveError,
    bookmarkCounts,
    myBookmarks,
    pageById
  }
}
