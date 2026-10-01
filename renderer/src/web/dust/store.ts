/**
 * 拆粉排行面板(WP-B)的狀態。模組層級單例:關掉面板再開,選項、捲動外的狀態都還在。
 *
 * - 資料:`./data/poe1/{en,cmn-Hant}/items.ndjson`(APT disenchantValue + 繁中名,以 refName 對接)+ `./data/dust/poe-dust.json`
 *   (goldCost / slots;以英文名+基底對接)。dev 由 vite 的 data-dir plugin 供應,正式版在 `app://…/data/`。
 * - 價格:`usePoeninja().snapshot`(WP-A,只有國際服、熱門聯盟);排行計算在 `@exile-appraiser/core/dust` 的 `rankUniques`(有 vitest)。
 * - 記憶:`core/src/dust/ui-state.ts` 的 `DustUiState`(選項 + 按聯盟的標記/隱藏),經 `Host.dustUiLoad/Save`
 *   (main 寫 `userData/dust_ui.json`,tmp + rename;純瀏覽器 localStorage)。所有改動都走 `saveSoon()`。
 */
import { computed, reactive, shallowRef, watch } from 'vue'
import {
  defaultDustUiState, dustTradeRequest, dustUniquesFromNdjson, filterRanked, indexPoeDust, parseDustUiState, parsePoeDust,
  rankUniques, serializeDustUiState, toggleDustMark, type DustUiState, type DustUnique, type PoeDustRow, type RankedDust
} from '@exile-appraiser/core/dust'
import { ninjaDetailsUrl, uniqueKey } from '@exile-appraiser/core/ninja'
import { webSearchUrl, type Poe1TradeRequest } from '@exile-appraiser/poe1'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { useLeagues } from '@/web/background/Leagues'
import { usePoeninja } from '@/web/background/Prices'

type Phase = 'idle' | 'loading' | 'ready' | 'error'

/** 表頭點選的排序;`metric` = 依選項的效率指標(rankUniques 的順序) */
export type SortKey = 'metric' | 'name' | 'dust' | 'price' | 'gold'

const phase = shallowRef<Phase>('idle')
const loadError = shallowRef('')
const uniques = shallowRef<DustUnique[]>([])
const dustIndex = shallowRef<Map<string, PoeDustRow>>(new Map())
const ui = reactive<DustUiState>(defaultDustUiState())
const stateLoaded = shallowRef(false)
const saveError = shallowRef('')
const sortKey = shallowRef<SortKey>('metric')
const sortDesc = shallowRef(true)
const search = shallowRef('')
/** 最後一次開的交易站網址(除錯 / 驗證用;DOM 也掛在 data-last-trade-url) */
const lastTradeUrl = shallowRef('')
/** 最後存檔(或載入)的內容;相同就不寫(開面板不會平白產生檔案) */
let lastSavedText = ''

async function fetchText (url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return await res.text()
}

let loading: Promise<void> | null = null

/** 載入資料檔(只載一次;失敗可重試)與記憶狀態。 */
export function loadDust (force = false): Promise<void> {
  if (loading && !force) return loading
  if (phase.value === 'ready' && !force) return Promise.resolve()
  phase.value = 'loading'
  loadError.value = ''
  loading = (async () => {
    try {
      const [en, zh, dust] = await Promise.all([
        fetchText('./data/poe1/en/items.ndjson'),
        fetchText('./data/poe1/cmn-Hant/items.ndjson'),
        fetchText('./data/dust/poe-dust.json')
      ])
      uniques.value = dustUniquesFromNdjson(en, zh)
      dustIndex.value = indexPoeDust(parsePoeDust(dust))
      if (!stateLoaded.value) {
        let text: string | null = null
        try { text = await Host.dustUiLoad() } catch (e) { console.warn('[dust] 讀取面板狀態失敗', e) }
        // options 物件保持同一個(面板直接綁它),只換內容
        const parsed = parseDustUiState(text)
        Object.assign(ui.options, parsed.options)
        ui.leagues = parsed.leagues
        lastSavedText = serializeDustUiState(ui)
        stateLoaded.value = true
      }
      phase.value = 'ready'
      console.log(`[dust] 載入 ${uniques.value.length} 件傳奇、poe-dust ${dustIndex.value.size} 筆`)
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e)
      phase.value = 'error'
      console.error('[dust] 載入失敗', e)
    } finally {
      loading = null
    }
  })()
  return loading
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveChain: Promise<void> = Promise.resolve()
/** 存檔(短暫合併連續輸入);回傳這次存檔完成的 promise。 */
export function saveSoon (delay = 250): Promise<void> {
  if (!stateLoaded.value) return Promise.resolve()
  clearTimeout(saveTimer)
  return new Promise<void>((resolve) => {
    saveTimer = setTimeout(() => {
      const text = serializeDustUiState(ui)
      if (text === lastSavedText) {
        resolve()
        return
      }
      lastSavedText = text
      saveChain = saveChain.then(async () => {
        try {
          await Host.dustUiSave(text)
          saveError.value = ''
        } catch (e) {
          lastSavedText = '' // 下次一定重寫
          saveError.value = e instanceof Error ? e.message : String(e)
          console.error('[dust] 存檔失敗', e)
        }
      })
      void saveChain.then(resolve)
    }, delay)
  })
}

watch(() => ui.options, () => { void saveSoon() }, { deep: true })

export function useDustStore () {
  const ninja = usePoeninja()
  const leagues = useLeagues()

  const league = computed(() => leagues.selectedId.value ?? '')
  /** 標記/隱藏按聯盟分開;沒有聯盟時用空字串 */
  const marks = computed(() => ui.leagues[league.value] ?? { marked: [], hidden: [] })
  const markedSet = computed(() => new Set(marks.value.marked))
  const hiddenSet = computed(() => new Set(marks.value.hidden))

  /** 價格快照只在 PoE1 國際服時可用(其他情況排行只有 dust) */
  const snapshot = computed(() => {
    const s = ninja.snapshot.value
    return s && s.game === 'poe1' && AppConfig().game === 'poe1' && AppConfig().realm === 'intl' ? s : null
  })

  const ranked = computed(() => rankUniques({
    items: uniques.value,
    dust: dustIndex.value,
    snapshot: snapshot.value,
    opts: {
      ilvl: ui.options.ilvl,
      quality: ui.options.quality,
      catalyst: ui.options.catalyst,
      goldValueChaos: ui.options.goldValueChaos,
      metric: ui.options.metric
    }
  }))

  const visible = computed<RankedDust[]>(() => {
    const o = ui.options
    const rows = filterRanked(ranked.value.rows, {
      minDust: o.minDust > 0 ? o.minDust : undefined,
      maxGold: o.maxGold > 0 ? o.maxGold : undefined,
      hideNoPrice: o.hideNoPrice,
      hideLowConfidence: o.hideLowConfidence,
      hidden: hiddenSet.value,
      hideHidden: o.hideHidden,
      search: search.value
    })
    if (sortKey.value === 'metric') {
      if (sortDesc.value) return rows
      // 反向時算不出效率的仍留在最後
      return [...rows.filter(r => r.metricValue !== undefined).reverse(), ...rows.filter(r => r.metricValue === undefined)]
    }
    const en = AppConfig().uiLanguage === 'en'
    const val = (r: RankedDust): number | string | undefined => {
      switch (sortKey.value) {
        case 'name': return en ? r.item.name : (r.item.nameZh ?? r.item.name)
        case 'dust': return r.dust
        case 'price': return r.price?.c
        case 'gold': return r.goldFee
        default: return undefined
      }
    }
    const dir = sortDesc.value ? -1 : 1
    return [...rows].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (av === undefined && bv === undefined) return 0
      if (av === undefined) return 1 // 沒值的永遠在後
      if (bv === undefined) return -1
      if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv)
      return dir * ((av as number) - (bv as number))
    })
  })

  function setSort (key: SortKey) {
    if (sortKey.value === key) sortDesc.value = !sortDesc.value
    else {
      sortKey.value = key
      sortDesc.value = key !== 'name'
    }
  }

  function toggleMark (row: RankedDust, kind: 'marked' | 'hidden') {
    toggleDustMark(ui, league.value, kind, row.key)
    void saveSoon(0)
  }

  /** 交易站搜尋網址(目前區服;國際服送英文名、台服送繁中名) */
  function tradeUrl (row: RankedDust): string {
    const realm = AppConfig().realm
    const tw = realm === 'tw'
    const req = dustTradeRequest({
      name: tw ? (row.item.nameZh ?? row.item.name) : row.item.name,
      type: tw ? (row.item.baseZh ?? row.item.baseType) : row.item.baseType,
      ilvlMin: ui.options.ilvl,
      corrupted: ui.options.corrupted,
      indexed: ui.options.indexed
    })
    // 結構是上游 TradeRequest 的子集(query.status/name/type/stats/filters + sort)
    return webSearchUrl(realm, league.value, req as unknown as Poe1TradeRequest)
  }

  function ninjaUrl (row: RankedDust): string | undefined {
    const snap = snapshot.value
    if (!snap || !row.price) return undefined
    return ninjaDetailsUrl('poe1', snap.league, { key: uniqueKey(row.item.name, row.item.baseType, 0), entry: row.price }, { name: row.item.name })
  }

  /** 只問「有沒有 ninja 連結」(按鈕可用狀態):與 `ninjaUrl(row) !== undefined` 同條件,不組字串 */
  function hasNinja (row: RankedDust): boolean {
    return !!snapshot.value && !!row.price
  }

  return {
    phase,
    loadError,
    ui,
    saveError,
    stateLoaded,
    league,
    snapshot,
    ranked,
    visible,
    markedSet,
    hiddenSet,
    sortKey,
    sortDesc,
    search,
    lastTradeUrl,
    setSort,
    toggleMark,
    tradeUrl,
    ninjaUrl,
    hasNinja,
    load: loadDust
  }
}
