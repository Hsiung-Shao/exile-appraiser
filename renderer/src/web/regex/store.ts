/**
 * Poe Regex 面板的狀態(WP5 + WP-C)。模組層級單例:切到別的設定分頁再回來、關掉設定再開,勾選與篩選都還在。
 *
 * - 清單:`./data/regex/regex_<game>.json`(dev 由 vite 的 serveDataDir 供應,prod 在 `app://…/data/regex/`),
 *   兩個遊戲都載(書籤跨遊戲要查頁名、舊書籤要由 page id 補 game),一檔壞不拖垮另一檔(regex_data.cpp `Load`)。
 * - 演算法頁(WP-C):清單檔自帶 `labels`(schema 2)逐鍵優先,暫代檔 `./data/regex/labels.<game>.json` 補缺鍵,
 *   再以 `algoPages()` 組出數值頁 / 商店頁接在語料頁後面(同一個 `cat.pages`,清單、勾選、書籤共用)。
 * - 合併:`combined` = 目前頁所屬物品組(R10,regex/src/sections.ts planMerge)的有勾選頁 + 自訂文字 + 排除詞 經 `combine()` 合成一串
 *   (輸入由 regex/src/embed.ts `mergeSels` 組;其他物品組的勾選不併入,`mergeSkipped` 計數)。
 * - 範本 `./data/regex/templates.json`、分享碼(regex/src/share.ts)都走 `applyCombo()`:覆蓋目前遊戲全部頁的勾選。
 * - 記憶:`regex/src/state.ts` 的 `RegexUiState`(schema 2 多了 numeric / custom / excludes / outScope),
 *   經 `Host.regexStateLoad/Save`(main 寫 `userData/regex_state.json`,tmp + rename;純瀏覽器 localStorage)。
 *   所有改變勾選的動作都走 `setPicksOn()`(書籤 / 範本 / 分享碼走 `syncCurrent()` + `scheduleSave()`)。
 * - **數值區(第 32 步)**:地圖 / 換界石數值條件(`map_numeric` / `waystone_numeric`)不在頁面下拉選單,而是宿主詞綴頁
 *   (`map_mods` / `waystone_mods`)頂端的可收合區塊;勾選在記憶體以內部頁 id 存在 `picks`,存檔 / 書籤 / 分享碼以宿主頁為鍵
 *   (`regex/src/sections.ts`、`embed.ts`;舊格式讀入時遷移)。合併與單頁輸出都把數值區緊接在宿主頁之後(`combineSels`)。
 * - **書籤快捷存取(第 33 步)**:書籤個別熱鍵存在書籤上(`hotkey`,state schema 4);`regexBookmarkHotkeyList`(`bookmark-hotkeys.ts`)
 *   跟著書籤更新 → Config.ts 併進 host-config 讓 main 註冊。啟動時就讀狀態(`ensureStateLoaded`,不載 ~3 MB 清單),
 *   清單到第一次執行書籤(`quick.ts` `runRegexBookmark`)或打開正則分頁才載。
 * - **物品詞綴數值頁(第 37 步)**:`item_mod_values`(PoE1)/ `item_mod_values_poe2`(PoE2)在清單載入時先放一個**沒有項目**的頁
 *   (`itemModPage(game, null)`,下拉選單看得到);第一次選到它、或存檔 / 書籤 / 分享碼引用它時才 fetch 兩語 `stats.ndjson`
 *   (各 ~2.5 MB)→ `buildItemModData`(只留模板與錨點)→ 換成有項目的頁(`slot.cat` 換新物件,computed 全部重算)→ 再還原那一頁的勾選。
 *   沒載入前不還原那一頁(否則存檔的鍵會被當成「還原不到」)。
 * - **書籤資料夾(第 36 步)**:書籤 `folder` + 依遊戲各一組的資料夾清單(state schema 5,純函式在 `regex/src/folders.ts`);
 *   同遊戲書籤在 `ui.bookmarks` 裡永遠依資料夾順序排好(= 顯示順序 = 熱鍵註冊順序)。這裡的包裝(`addBookmarkFolder` …
 *   `moveBookmarkStep`)只多做 `scheduleSave()`;收合狀態存 state,管理頁 / 書籤列 / 快速面板共用(`bookmarkGroupsOf`)。
 * - 行為移植自 PobTools `host/regex_tool_ui.cpp`(`restoreState` :308、`switchGame` :1006、`loadBookmark` :832、
 *   `updateBookmark` :868、`commitName` :944)。
 */
import { computed, markRaw, reactive, shallowRef, watch } from 'vue'
import {
  algoPages, bookmarkApplyOf, bookmarkBodyOf, buildCorpus, combine, combineSels, mergeSels, decodeShare, defaultRegexState,
  encodeShare, hostIdOf, isAlgoPage, isSectionPage, listedPages, mergeLabels, numericKeyOf, pageKeysOf, parseLabels,
  parseRegexCatalogue, parseRegexState, parseTemplates, picksFor, resolveState, resolvedValues, savedPicksOf, sectionPageOf,
  serializeRegexState, shareStateOf, visibleRows, bookmarkHotkeys, regexStateSchemaOf, ITEM_MOD_PAGE_IDS, buildItemModData,
  isItemModPageId, itemModPage, parseStatsNdjson,
  addFolder, deleteFolder, groupBookmarks, moveBookmark, moveBookmarkBy, moveFolderBy, moveFolderTo, normalizeFolders, renameFolder,
  setFolderCollapsed,
  type FolderResult, type GroupedBookmarks,
  type AlgoEntry, type AlgoPage, type AlgoValue, type CombineResult, type Mode, type RegexBookmark, type RegexCatalogue,
  type RegexGame, type RegexLabels, type RegexLang, type RegexPage, type RegexTemplate, type Result, type ShareState, type T17Filter,
  type RegexUiState, type ResolvedState, type BookmarkPack, type MergeResult, bookmarkMissed, mergeBookmarks
} from '@exile-appraiser/regex'
import type { CurrentCombo } from './incoming-share'
import { Host } from '@/web/background/IPC'
import { AppConfig } from '@/web/Config'
import { regexBookmarkFolders, regexBookmarkHotkeyList } from './bookmark-hotkeys'

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

/** 第 37 步:物品詞綴數值頁的載入狀態(每個遊戲一份;`ms` = 讀檔 + 建索引耗時,`count` = 可選詞綴數) */
const itemMods = reactive<Record<RegexGame, { phase: LoadPhase, error: string, ms: number, count: number }>>({
  poe1: { phase: 'idle', error: '', ms: 0, count: 0 },
  poe2: { phase: 'idle', error: '', ms: 0, count: 0 }
})
const itemModLoads: Partial<Record<RegexGame, Promise<boolean>>> = {}

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
    cat.pages.push(...algoPages(game, labels), itemModPage(game, null))
    // 清單 ~3 MB 且載入後唯讀(沒有任何地方就地修改):markRaw 避免整份被包成深層 reactive proxy
    slot.cat = markRaw(cat)
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
let stateLoading: Promise<void> | null = null

/**
 * 只讀記憶狀態(勾選 + 書籤;不載清單)。第 33 步起 renderer 啟動時就呼叫:書籤熱鍵要在打開正則分頁之前就註冊。
 * 讀完把書籤熱鍵交給 `regexBookmarkHotkeyList`(之後書籤變動自動更新)。
 */
export function ensureStateLoaded (): Promise<void> {
  if (stateLoading) return stateLoading
  stateLoading = (async () => {
    let migrated = false
    try {
      const text = await Host.regexStateLoad()
      if (text) {
        const r = parseRegexState(text)
        if (r.ok) {
          Object.assign(ui, r.state)
          // 第 32 步:舊結構(schema ≤ 2,數值頁 map_numeric / waystone_numeric)已在 parseRegexState 轉成新結構 → 立刻寫回;
          // 第 33 步:schema 3 → 4 只多了書籤熱鍵(沒有 = 不變),不必為了版號寫回;
          // 第 36 步:schema 4 → 5 只多了資料夾(舊檔 = 全部未分類),同樣不為了版號寫回
          migrated = regexStateSchemaOf(text) < 3
        } else console.warn('[regex] regex_state 無法解析,改用預設值')
      }
    } catch (e) {
      console.warn('[regex] regex_state 讀取失敗', e)
    }
    stateLoaded.value = true
    if (migrated) scheduleSave()
    watch(() => bookmarkHotkeys(ui.bookmarks), (list) => {
      if (JSON.stringify(list) !== JSON.stringify(regexBookmarkHotkeyList.value)) regexBookmarkHotkeyList.value = list
    }, { immediate: true, deep: true })
    // 第 36 步:熱鍵總表的書籤列標資料夾名(不進 host-config)
    watch(() => ui.bookmarks.map(b => b.folder ?? ''), (list) => {
      if (list.join('\u0000') !== regexBookmarkFolders.value.join('\u0000')) regexBookmarkFolders.value = list
    }, { immediate: true })
  })()
  return stateLoading
}

/** 面板第一次掛上時呼叫;`preferGame` = 目前 AppConfig().game(面板預設跟著目前遊戲,記住的頁屬於它才沿用) */
export function ensureStarted (preferGame: RegexGame): Promise<void> {
  if (started) return started
  selGame.value = preferGame
  started = (async () => {
    await ensureStateLoaded()
    await Promise.all([...GAMES.map(fetchCatalogue), fetchTemplates()])
  })()
  return started
}

/**
 * 第 33 步:某遊戲的清單(執行書籤用)。沒載過就載(兩個遊戲一起載,同 ensureStarted;面板預設遊戲 = 目前 AppConfig().game);
 * 載入失敗 = null。
 */
export async function catalogueFor (game: RegexGame, pageId?: string): Promise<RegexCatalogue | null> {
  await ensureStarted(AppConfig().game)
  // 第 37 步:書籤指向物品詞綴數值頁 → 先把那一頁載進來(清單物件會換新,所以載完再取)
  if (pageId && isItemModPageId(pageId)) await ensureItemMods(game)
  return catalogues[game].cat
}

/** 物品詞綴數值頁是否已載入(有項目) */
function itemModsReady (game: RegexGame): boolean {
  return itemMods[game].phase === 'ready'
}

/**
 * 第 37 步:載入物品詞綴數值頁(兩語 stats.ndjson → `buildItemModData`)。同一遊戲只載一次(失敗可重試);
 * 載完換掉清單裡的空頁並還原它的勾選。回傳是否成功。
 */
export function ensureItemMods (game: RegexGame): Promise<boolean> {
  const st = itemMods[game]
  if (st.phase === 'ready') return Promise.resolve(true)
  const running = itemModLoads[game]
  if (running) return running
  const job = (async () => {
    st.phase = 'loading'
    st.error = ''
    try {
      const t0 = performance.now()
      const [zh, en] = await Promise.all([
        fetchText(`./data/${game}/cmn-Hant/stats.ndjson`),
        fetchText(`./data/${game}/en/stats.ndjson`)
      ])
      const data = buildItemModData(game, parseStatsNdjson(zh), parseStatsNdjson(en))
      const cat = catalogues[game].cat
      if (!cat) throw new Error('lists not loaded')
      const id = ITEM_MOD_PAGE_IDS[game]
      const page = itemModPage(game, data)
      const next = markRaw({ ...cat, pages: cat.pages.map(p => (p.id === id ? page : p)) })
      catalogues[game].cat = next
      st.ms = Math.round(performance.now() - t0)
      st.count = data.entries.length
      st.phase = 'ready'
      console.info(`[regex] 物品詞綴數值頁 ${game}:${data.entries.length} 條,${st.ms} ms`)
      onCatalogueReady(next)
      return true
    } catch (e) {
      st.phase = 'error'
      st.error = e instanceof Error ? e.message : String(e)
      console.error(`[regex] 物品詞綴數值頁載入失敗 ${game}`, e)
      return false
    } finally {
      delete itemModLoads[game]
    }
  })()
  itemModLoads[game] = job
  return job
}

/** 存檔 / 分享碼 / 書籤引用到的頁裡有沒有還沒載入的物品詞綴數值頁 → 先載 */
async function prepareItemMods (game: RegexGame, pageIds: Iterable<string>): Promise<void> {
  for (const id of pageIds) {
    if (isItemModPageId(id) && !itemModsReady(game)) { await ensureItemMods(game); return }
  }
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
  // 第 36 步:補上遊戲的舊書籤可能帶資料夾 → 補資料夾清單、依資料夾排好(沒資料夾的舊檔不會有任何變動)
  if (dirty) normalizeFolders(ui)
  // 上次的勾選(每頁一次);還原不到的計數回報,不靜默丟掉
  let missedTotal = 0
  let firstPage = ''
  for (const page of cat.pages) {
    if (!views[page.id]) views[page.id] = { search: '', group: -1, t17: 'all' }
    if (restored.has(page.id)) continue
    // 物品詞綴數值頁還沒載入(沒有項目):先不還原,存檔有引用就去載(載完會再走一次這裡)
    if (isItemModPageId(page.id) && !itemModsReady(cat.game)) continue
    restored.add(page.id)
    // 數值區的勾選存在宿主頁那筆的 `num`(savedPicksOf 分派)
    const r = savedPicksOf(page, ui)
    if (!r) continue
    picks[page.id] = r.picked
    if (r.missed > 0) {
      missedTotal += r.missed
      const shown = isSectionPage(page) ? cat.pages.find(p => p.id === page.sectionOf) ?? page : page
      if (!firstPage) firstPage = (AppConfig().uiLanguage === 'en' ? shown.titleEn : '') || shown.title
    }
  }
  if (missedTotal > 0) notice.value = { key: 'ppz.regex.notice_restore_missed', params: { n: missedTotal, page: firstPage } }
  // 目前選的遊戲的清單到了:選頁(記住的頁若屬於這個遊戲就用它;數值區不是可選的頁)
  const shownPages = listedPages(cat.pages)
  if (cat.game === selGame.value && !shownPages.some(p => p.id === selPageId.value)) {
    selPageId.value = shownPages.some(p => p.id === ui.page) ? ui.page : shownPages[0].id
  }
  if (dirty) scheduleSave()
  // 上次的勾選 / 記住的頁在物品詞綴數值頁 → 背景載入(載完自動還原)
  const imv = ITEM_MOD_PAGE_IDS[cat.game]
  if (!itemModsReady(cat.game) && (ui.current.some(c => c.page === imv && c.keys.length) || (cat.game === selGame.value && selPageId.value === imv))) {
    void ensureItemMods(cat.game)
  }
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
/** 頁面下拉選單上的頁(不含數值區) */
const listed = computed<RegexPage[]>(() => catalogue.value ? listedPages(catalogue.value.pages) : [])
const page = computed<RegexPage | null>(() => {
  const l = listed.value
  return l.find(p => p.id === selPageId.value) ?? l[0] ?? null
})
/** 目前頁的數值區(只有宿主詞綴頁有) */
const section = computed<AlgoPage | null>(() => {
  const cat = catalogue.value
  const p = page.value
  return cat && p ? sectionPageOf(cat.pages, p) : null
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

/** 演算法頁 / 數值區項目目前的值(沒存過 = 預設值;數值區的值存在宿主頁 id 底下) */
export function valueOf (pageId: string, e: AlgoEntry): AlgoValue {
  return ui.numeric[numericKeyOf(pageId)]?.[e.id] ?? e.input.def
}

/** 目前這一頁單獨的輸出(語料頁 = build().query;演算法頁 = 該頁 term;宿主詞綴頁 = 詞綴 + 數值區合成一條) */
const pageCombined = computed<CombineResult | null>(() => {
  const cat = catalogue.value
  const p = page.value
  if (!cat || !p) return null
  return combine({ lang: ui.lang, mode: ui.mode, pages: combineSels(cat.pages, picks, ui.numeric, p.id) })
})

/**
 * R10:合併只取目前頁所屬物品組的有勾選頁(regex/src embed.ts mergeSels;PobTools regex_tool_ui.cpp mergeIdx)。
 * `skippedPages` = 其他物品組的有勾選頁數(介面提示「另有 N 頁…未併入」)。
 */
const merge = computed(() => {
  const cat = catalogue.value
  if (!cat) return null
  return mergeSels(cat.pages, picks, ui.numeric, page.value?.id ?? '')
})

/** 目前頁物品組的有勾選頁 + 自訂文字 + 排除詞(數值區緊接宿主頁) */
const combined = computed<CombineResult | null>(() => {
  const m = merge.value
  if (!m) return null
  return combine({
    lang: ui.lang,
    mode: ui.mode,
    pages: m.sels,
    custom: ui.custom,
    excludes: ui.excludes
  })
})

/** 併入合併的各頁勾選數(合併檢視用;數值區自成一列,排在宿主頁後面) */
const pickedPages = computed(() => (merge.value?.picked ?? []).map(s => ({ page: s.page, n: s.picks.length })))

/** 其他物品組、未併入合併的有勾選頁數 */
const mergeSkipped = computed(() => merge.value?.skippedPages ?? 0)

/** 目前遊戲任一頁(不分物品組)有勾選:「全部清除」、分享碼用 */
const anyPicked = computed(() => {
  const cat = catalogue.value
  return !!cat && combineSels(cat.pages, picks, ui.numeric).length > 0
})

/** 下拉選單 / 書籤用:這一頁(含它的數值區)總共勾了幾項 */
export function pagePickCount (p: RegexPage): number {
  const cat = catalogues[p.game]?.cat
  const sec = cat ? sectionPageOf(cat.pages, p) : null
  return (picks[p.id]?.length ?? 0) + (sec ? picks[sec.id]?.length ?? 0 : 0)
}

/** 勾選(索引)→ 存檔的鍵;數值區寫進宿主頁那筆的 `num` */
function syncCurrent (p: RegexPage): void {
  if (isSectionPage(p)) {
    const slot = picksFor(ui, p.sectionOf!)
    const num = pageKeysOf(p, picks[p.id] ?? []).keys
    if (num.length) slot.num = num
    else delete slot.num
    return
  }
  const k = pageKeysOf(p, picks[p.id] ?? [])
  const slot = picksFor(ui, p.id)
  slot.keys = k.keys
  slot.alt = k.alt
}

function findPage (pageId: string): RegexPage | null {
  return catalogue.value?.pages.find(p => p.id === pageId) ?? null
}

function setPicksOn (pageId: string, list: Iterable<number>): void {
  const p = findPage(pageId)
  if (!p) return
  picks[p.id] = [...new Set(list)].sort((a, b) => a - b)
  syncCurrent(p)
  ui.game = selGame.value
  if (page.value) ui.page = page.value.id
  scheduleSave()
}

function setPicks (list: Iterable<number>): void {
  const p = page.value
  if (!p) return
  setPicksOn(p.id, list)
}

/** 指定頁(數值區用它的內部頁 id)的勾選 */
export function picksOf (pageId: string): number[] {
  return picks[pageId] ?? []
}

export function togglePickOn (pageId: string, i: number, on: boolean): void {
  const s = new Set(picksOf(pageId))
  if (on) s.add(i)
  else s.delete(i)
  setPicksOn(pageId, s)
}

export function clearPicksOn (pageId: string): void {
  setPicksOn(pageId, [])
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

/** 演算法頁 / 數值區:改值(順手勾起該列——改了值卻沒勾,輸出不會變,容易以為沒生效) */
export function setValue (pageId: string, e: AlgoEntry, v: AlgoValue, tick = true): void {
  const key = numericKeyOf(pageId)
  const m = { ...(ui.numeric[key] ?? {}) }
  m[e.id] = { ...v }
  ui.numeric[key] = m
  const p = findPage(pageId)
  if (tick && p) {
    const i = p.entries.indexOf(e)
    if (i >= 0 && !picksOf(pageId).includes(i)) { togglePickOn(pageId, i, true); return }
  }
  scheduleSave()
}

/** 數值區收合(以宿主頁 id 記,存檔;預設展開) */
export function isCollapsed (hostId: string): boolean {
  return ui.collapsed.includes(hostId)
}

export function setCollapsed (hostId: string, on: boolean): void {
  if (on === isCollapsed(hostId)) return
  ui.collapsed = on ? [...ui.collapsed, hostId] : ui.collapsed.filter(x => x !== hostId)
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
  selPageId.value = cat ? listedPages(cat.pages)[0]?.id ?? '' : ''
  ui.game = g
  if (cat) ui.page = selPageId.value
  scheduleSave()
}

export function switchPage (pageId: string): void {
  // 合併檢視的數值區列 → 宿主頁(數值區不是可選的頁)
  const cat = catalogue.value
  const id = cat ? hostIdOf(cat.pages, pageId) : pageId
  panelView.value = 'page'
  if (isItemModPageId(id)) void ensureItemMods(selGame.value)
  if (id === selPageId.value) return
  selPageId.value = id
  ui.game = selGame.value
  ui.page = id
  scheduleSave()
}

/** 物品詞綴數值頁載入失敗後重試 */
export function retryItemMods (game: RegexGame): void {
  void ensureItemMods(game)
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

/** 目前遊戲的勾選 → ShareState v2(只含有勾選的頁;數值區在 `sections`;數值只含已勾選項目) */
export function currentShareState (): ShareState | null {
  const cat = catalogue.value
  if (!cat) return null
  return shareStateOf(selGame.value, cat.pages, picks, ui.numeric, { mode: ui.mode, custom: ui.custom, excludes: ui.excludes })
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
  }
  // 數值:以存放鍵併入(數值區 = 宿主頁 id)
  for (const [key, m] of Object.entries(resolvedValues(r.values))) ui.numeric[key] = { ...(ui.numeric[key] ?? {}), ...m }
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
  const name = AppConfig().uiLanguage === 'en' ? t.name.en : t.name.zh
  void prepareItemMods(t.state.game, [...Object.keys(t.state.pages), ...Object.keys(t.state.numeric)])
    .then(() => applyCombo(t.state, 'template', name))
}

/** 貼上分享碼 = 套用;失敗丟例外(訊息給 UI 顯示) */
export async function applyShareCode (code: string): Promise<string[]> {
  const d = await decodeShare(code)
  await prepareItemMods(d.state.game, [...Object.keys(d.state.pages), ...Object.keys(d.state.numeric)])
  applyCombo(d.state, 'share', gameLabel(d.state.game))
  return d.warnings
}

/**
 * 一鍵從 PobTools 送分享碼(`incoming-share.ts`):確認對話框要的資料 —— 清單載好、引用到的物品詞綴數值頁先載,
 * 再以與 `applyCombo` 相同的 `resolveState` 算出會套用什麼。清單載入失敗 = null。
 */
export async function prepareShareState (s: ShareState): Promise<{ pages: readonly RegexPage[], resolved: ResolvedState } | null> {
  await ensureStarted(AppConfig().game)
  await prepareItemMods(s.game, [...Object.keys(s.pages), ...Object.keys(s.numeric)])
  const cat = catalogues[s.game].cat
  if (!cat) return null
  return { pages: cat.pages, resolved: resolveState(s, cat.pages) }
}

/** 某遊戲目前的勾選(頁 id → 勾選數,含數值區)與自訂文字 / 排除詞 / 模式(確認對話框「會覆蓋」用) */
export function currentComboOf (game: RegexGame): CurrentCombo {
  const cat = catalogues[game].cat
  const pages: Array<{ id: string, n: number }> = []
  for (const p of cat?.pages ?? []) {
    const n = picks[p.id]?.length ?? 0
    if (n) pages.push({ id: p.id, n })
  }
  return { pages, custom: ui.custom.length, excludes: ui.excludes.length, mode: ui.mode }
}

/** 使用者在確認對話框按「套用」:與貼上分享碼相同(`applyCombo`,覆蓋該遊戲全部清單) */
export function applySharedState (s: ShareState): void {
  applyCombo(s, 'share', gameLabel(s.game))
}

/**
 * 第 40 步:PobTools 送來的書籤包 —— 確認對話框要的資料:相關遊戲的清單載好(物品詞綴數值頁書籤先載那一頁)、
 * 預覽合併(`mergeBookmarks`,不改狀態)與每筆書籤找不到幾項(`bookmarkMissed`)。清單載入失敗 = null。
 */
export async function prepareBookmarkPack (pack: BookmarkPack): Promise<{ merge: MergeResult, missed: number[] } | null> {
  await ensureStarted(AppConfig().game)
  const games = [...new Set(pack.bookmarks.map(b => b.game))].filter((g): g is RegexGame => g === 'poe1' || g === 'poe2')
  for (const g of games) await prepareItemMods(g, pack.bookmarks.filter(b => b.game === g).map(b => b.page))
  if (games.some(g => !catalogues[g].cat)) return null
  return {
    merge: mergeBookmarks(ui, pack),
    missed: pack.bookmarks.map(b => bookmarkMissed(catalogues[b.game as RegexGame].cat!.pages, b))
  }
}

/** 加入後要在書籤卡片顯示的那幾筆(RegexBookmarks.vue 監看:切分頁、捲到卡片、短暫醒目);`seq` 讓同一批再送一次也會觸發 */
export const bookmarkReveal = shallowRef<{ game: RegexGame, keys: string[], seq: number } | null>(null)
let revealSeq = 0

/** 使用者在確認對話框按「加入」:書籤包併進書籤(不動勾選;同名改名),展開放進去的資料夾 */
export function addBookmarksFromPack (pack: BookmarkPack): void {
  const r = mergeBookmarks(ui, pack)
  ui.bookmarks = r.state.bookmarks
  ui.folders = r.state.folders
  for (const a of r.added) setFolderCollapsed(ui, a.game, a.folder, false)
  notice.value = { key: 'ppz.regex.notice_bm_added', params: { n: r.added.length, renamed: r.renamed.length } }
  const first = r.added[0]
  if (first) {
    bookmarkReveal.value = {
      game: first.game,
      keys: r.added.filter(a => a.game === first.game).map(a => `${a.folder}\u0000${a.name}`),
      seq: ++revealSeq
    }
  }
  scheduleSave()
}

// ---- 書籤 ----------------------------------------------------------------------

/**
 * 各遊戲的書籤數與找不到清單的孤兒數(regex_tool_ui.cpp drawBookmarks :739)。
 * 第 36 步起管理卡片上方是 PoE1 / PoE2 分頁(不再只列目前遊戲 + 「另一個遊戲還有 N 筆」)。
 */
const bookmarkCounts = computed(() => {
  const c = { poe1: 0, poe2: 0, orphans: 0 }
  for (const b of ui.bookmarks) {
    if (!b.game) c.orphans++
    else c[b.game]++
  }
  return c
})

/** 書籤 = 目前頁的快照(宿主詞綴頁含數值區:`num` + `numeric`) */
function currentBookmarkBody (): Omit<RegexBookmark, 'name'> | null {
  const cat = catalogue.value
  const p = page.value
  if (!cat || !p) return null
  return bookmarkBodyOf(cat.pages, p, picks, ui.numeric, { game: selGame.value, mode: ui.mode, lang: ui.lang })
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
  if (!body.num) delete b.num
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

/** 第 33 步:書籤個別熱鍵('' = 清除);存在書籤上(state schema 4) */
export function setBookmarkHotkey (index: number, hotkey: string): void {
  const b = ui.bookmarks[index]
  if (!b) return
  const hk = hotkey.trim()
  if ((b.hotkey ?? '') === hk) return
  if (hk) b.hotkey = hk
  else delete b.hotkey
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
  // 物品詞綴數值頁還沒載入:先載,載完再套用書籤
  if (isItemModPageId(b.page)) {
    const g: RegexGame = b.page === ITEM_MOD_PAGE_IDS.poe2 ? 'poe2' : 'poe1'
    if (!itemModsReady(g)) { void ensureItemMods(g).then(ok => { if (ok) loadBookmark(index) }); return }
  }
  const target = pageById(b.page)
  const cat = target ? catalogues[target.game].cat : null
  const a = cat ? bookmarkApplyOf(cat.pages, b) : null
  if (!cat || !a) {
    notice.value = { key: 'ppz.regex.notice_missing_page', params: { name: b.name, page: b.page } }
    return
  }
  // 書籤自帶遊戲:載入後選擇器一定指向它;宿主詞綴頁書籤一併覆寫數值區(整頁快照)
  selGame.value = a.page.game
  selPageId.value = a.page.id
  panelView.value = 'page'
  ui.mode = b.mode
  ui.lang = b.lang
  for (const [id, list] of Object.entries(a.picks)) {
    picks[id] = list
    const p = cat.pages.find(x => x.id === id)
    if (p) syncCurrent(p)
  }
  for (const [key, m] of Object.entries(a.values)) ui.numeric[key] = { ...(ui.numeric[key] ?? {}), ...m }
  notice.value = a.missed > 0
    ? { key: 'ppz.regex.notice_loaded_missed', params: { name: b.name, n: a.missed } }
    : { key: 'ppz.regex.notice_loaded', params: { name: b.name } }
  ui.game = selGame.value
  ui.page = a.page.id
  scheduleSave()
}

// ---- 書籤資料夾(第 36 步;純函式在 regex/src/folders.ts)-------------------------

/** 某遊戲的書籤依資料夾分組(管理頁不略過空資料夾;書籤列 / 快速面板 `skipEmpty`) */
export function bookmarkGroupsOf (game: RegexGame, skipEmpty = false): GroupedBookmarks {
  return groupBookmarks(ui, game, { skipEmpty })
}

export function addBookmarkFolder (game: RegexGame, name: string): FolderResult {
  const r = addFolder(ui, game, name)
  if (r === 'ok') scheduleSave()
  return r
}

export function renameBookmarkFolder (game: RegexGame, from: string, to: string): FolderResult {
  const r = renameFolder(ui, game, from, to)
  if (r === 'ok') scheduleSave()
  return r
}

/** 刪除資料夾(書籤移回未分類);回傳移回的書籤數 */
export function deleteBookmarkFolder (game: RegexGame, name: string): number {
  const n = deleteFolder(ui, game, name)
  if (n >= 0) {
    notice.value = { key: 'ppz.regex.fd_notice_deleted', params: { name, n } }
    scheduleSave()
  }
  return n
}

/** 資料夾上移 / 下移(`delta`)或移到第 `to` 個(拖曳) */
export function moveBookmarkFolder (game: RegexGame, name: string, move: { delta: number } | { to: number }): void {
  const ok = 'delta' in move ? moveFolderBy(ui, game, name, move.delta) : moveFolderTo(ui, game, name, move.to)
  if (ok) scheduleSave()
}

/** 收合 / 展開('' = 未分類);管理頁、書籤列、快速面板共用 */
export function setBookmarkFolderCollapsed (game: RegexGame, folder: string, on: boolean): void {
  if (setFolderCollapsed(ui, game, folder, on)) scheduleSave()
}

/** 書籤移到資料夾(`before` = 放在那個書籤前面,拖曳用);回傳新索引(-1 = 沒動) */
export function moveBookmarkToFolder (index: number, folder: string, before?: number): number {
  const was = ui.bookmarks[index]
  const r = moveBookmark(ui, index, folder, before)
  if (r >= 0 && was) scheduleSave()
  return r
}

/** 書籤在同資料夾內上移 / 下移;回傳新索引 */
export function moveBookmarkStep (index: number, delta: number): number {
  const r = moveBookmarkBy(ui, index, delta)
  if (r !== index) scheduleSave()
  return r
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
    listed,
    section,
    view,
    picked,
    pickedSet,
    visible,
    result,
    pageCombined,
    combined,
    pickedPages,
    mergeSkipped,
    anyPicked,
    panelView,
    templates,
    notice,
    saveError,
    bookmarkCounts,
    pageById,
    itemMods
  }
}
