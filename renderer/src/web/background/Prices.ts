/**
 * poe.ninja 參考價(取代上游 APT `web/background/Prices.ts`;介面對齊上游,移植元件不用改):
 * `usePoeninja()` → `{ xchgRate, isLoading, lastFetchedAt, load(force), queuePricesFetch(), findPriceByQuery(), autoCurrency(), snapshot }`。
 *
 * 與上游不同處(exile-appraiser):
 * - 資料來源改 PobTools 同款的 item overview + exchange 端點(`@exile-appraiser/core/ninja`),有 baseType / 6L / 數量 / 低信心;
 *   上游的 `dense/overviews` 只有 name/variant,不分底材。
 * - 只在 `realm === 'intl'` 且聯盟可交易(非私人聯盟)時抓;poe.ninja 沒有台服價格 → 台服一律「沒有價格」。
 * - 價格表快照存 main 的 `userData/cache/ninja/<game>_<league>.json`(純瀏覽器存記憶體):
 *   啟動時先讀快取;快取 15 分鐘內算新鮮,不重抓。這次執行抓過之後照上游 31 分鐘更新一次。
 * - 上游在換聯盟時強制重抓;這裡換聯盟/遊戲只清空並讀快取,**最近 20 分鐘有人查價**(`queuePricesFetch`、PoE1 的剪貼簿查價事件)才上網抓。
 * - WP-R2:PoE2 也抓(目標本來就依 `game`;PoE2 的觸發者是符文塑形自動查價 `RuneshapePrices.vue` 收到掃描結果時的
 *   `queuePricesFetch`),`priceOf(refName, level?)` 給 PoE2 通貨類(符文 / 靈魂核心 / 未切割寶石…)查價,
 *   `exaltedRate`(1 ex = 幾 c,快照 schema 2)給崇高石計價。台服回 `{ status: 'no-source' }`。
 * - 第 24 步(查價面板「通貨價格區」):`findPriceByQuery` 另回 7 天走勢(`graph` = APT 欄位名)、每小時成交量
 *   (`volumeChaos`)、成交量最大的對手通貨(`maxVolumeCurrency`)與 `exchange`(來自 exchange 類 = 通貨區只顯示這種);
 *   `autoCurrency` 依遊戲換單位(PoE1 照 APT chaos / div;PoE2 崇高石 / 神聖石,規則在 core `ninja/units.ts`);
 *   PoE2 剪貼簿查價也算「有人在查價」(`queuePricesFetch`,節流與 20 分鐘閘門不變);
 *   PoE2 查價元件經 `poe2-price-source.ts` 轉接這裡(`poe2/src/web/background/Prices.ts`)。
 */
import { computed, readonly, shallowRef, watch } from 'vue'
import { createGlobalState } from '@vueuse/core'
import {
  autoCurrencyFor, createNinjaClient, denseInfoToDetailsId, isFresh, lookupPrice, ninjaDetailsUrl, parseSnapshot, toSnapshot,
  NINJA_CACHE_TTL_MS, type NinjaGame, type NinjaQuery, type NinjaSnapshot
} from '@exile-appraiser/core/ninja'
import { AppConfig } from '@/web/Config'
import { Host } from './IPC'
import { useLeagues } from './Leagues'
import { priceFromSnapshot, type PriceOfResult } from './price-of'
import { priceHitFields, type PriceTrendFields } from './price-trend'

export type { PriceOfResult, PriceOfHit } from './price-of'

const RETRY_INTERVAL_MS = 4 * 60 * 1000
const UPDATE_INTERVAL_MS = 31 * 60 * 1000
const INTEREST_SPAN_MS = 20 * 60 * 1000

export type DbQuery = NinjaQuery

export interface CurrencyValue {
  min: number
  max: number
  /** PoE1:chaos / div(APT);第 24 步 PoE2:exalted / div(沒有 exalted 匯率才 chaos) */
  currency: 'chaos' | 'div' | 'exalted'
}

export interface NinjaPriceHit extends PriceTrendFields {
  chaos: number
  /** poe.ninja 詳細頁 */
  url: string
  /** 掛單數(exchange 類沒有 → 0) */
  count: number
  /** 0 < count < 5 */
  lowConfidence: boolean
  detailsId: string
  // 第 24 步:graph / graphChange / exchange / volumeChaos / maxVolumeCurrency 見 price-trend.ts `PriceTrendFields`
}

export const usePoeninja = createGlobalState(() => {
  const leagues = useLeagues()

  const xchgRate = shallowRef<number | undefined>(undefined)
  /** WP-R2:1 exalted = 幾 chaos(PoE2;PoE1 為 undefined) */
  const exaltedRate = shallowRef<number | undefined>(undefined)
  const isLoading = shallowRef(false)
  const lastFetchedAt = shallowRef<number | undefined>(undefined)
  const lastError = shallowRef<string | null>(null)
  const snapshot = shallowRef<NinjaSnapshot | null>(null)

  let lastInterestTime = 0
  /** 這次執行真的上網抓成功的時間(0 = 還沒抓過,只有快取) */
  let lastSessionFetch = 0
  let downloadController: AbortController | undefined
  let cacheLoadedFor: string | undefined
  /**
   * 第 24 步:讀快取進行中的 promise。快取還沒讀完時又有人 `queuePricesFetch`(第一次查價就建立價格表 → watch 的讀快取
   * 與查價事件同時發生,PoE1 拆粉 `DustValue` 的 onMounted 也是),原本會因 snapshot 還是 null 而判定「不新鮮」直接上網抓,
   * 15 分鐘快取等於沒用(無頭驗證時發現)。現在先等快取讀完再判斷。
   */
  let cacheLoading: Promise<void> | undefined

  /** 目前要用哪個 ninja 價格表;null = 不抓(台服、沒選聯盟、私人聯盟)。 */
  const target = computed<{ game: NinjaGame, league: string } | null>(() => {
    const { realm, game } = AppConfig()
    const league = leagues.selected.value
    if (realm !== 'intl' || !league?.id || !league.isPopular) return null
    return { game, league: league.id }
  })
  const targetKey = computed(() => target.value ? `${target.value.game}|${target.value.league}` : '')

  function apply (snap: NinjaSnapshot) {
    snapshot.value = snap
    xchgRate.value = snap.divineRate ?? undefined
    exaltedRate.value = snap.exaltedRate ?? undefined
    lastFetchedAt.value = snap.fetchedAt
  }

  function clear () {
    downloadController?.abort()
    downloadController = undefined
    isLoading.value = false
    snapshot.value = null
    xchgRate.value = undefined
    exaltedRate.value = undefined
    lastFetchedAt.value = undefined
    lastError.value = null
    lastSessionFetch = 0
    cacheLoadedFor = undefined
    cacheLoading = undefined
  }

  async function load (force: boolean = false) {
    const t = target.value
    if (!t) return
    const key = targetKey.value

    if (cacheLoadedFor !== key) {
      cacheLoadedFor = key
      cacheLoading = (async () => {
        let text: string | null = null
        try { text = await Host.ninjaCacheLoad(t.game, t.league) } catch (e) { console.warn('[ninja] 讀快取失敗', e) }
        if (targetKey.value !== key) return
        const cached = parseSnapshot(text, t.game, t.league)
        if (cached && (!snapshot.value || cached.fetchedAt > snapshot.value.fetchedAt)) apply(cached)
      })()
    }
    if (cacheLoading) {
      await cacheLoading
      if (targetKey.value !== key) return
    }

    if (!force) {
      if (downloadController) return
      const age = Date.now() - (snapshot.value?.fetchedAt ?? 0)
      // 只有快取:15 分鐘 TTL;這次執行抓過:照上游 31 分鐘
      if (lastSessionFetch === 0 ? isFresh(snapshot.value, NINJA_CACHE_TTL_MS) : age < UPDATE_INTERVAL_MS) return
      if ((Date.now() - lastInterestTime) > INTEREST_SPAN_MS) return
    }
    downloadController?.abort()
    const ctrl = new AbortController()
    downloadController = ctrl
    isLoading.value = true
    try {
      const client = createNinjaClient({
        http: async (url, init) => await Host.proxy(url, init),
        game: t.game,
        league: t.league
      })
      const result = await client.fetchAll(undefined, { signal: ctrl.signal })
      if (ctrl.signal.aborted || targetKey.value !== key) return
      const snap = toSnapshot(result)
      apply(snap)
      lastSessionFetch = Date.now()
      lastError.value = result.failedTypes.length
        ? result.failedTypes.map(f => `${f.type}: ${f.error}`).join('; ')
        : null
      if (result.failedTypes.length) console.warn('[ninja] 部分類別失敗', result.failedTypes)
      try {
        await Host.ninjaCacheSave(t.game, t.league, JSON.stringify(snap))
      } catch (e) {
        console.warn('[ninja] 寫快取失敗', e)
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        lastError.value = e instanceof Error ? e.message : String(e)
        console.warn('[ninja] 抓價失敗', e)
      }
    } finally {
      if (downloadController === ctrl) {
        downloadController = undefined
        isLoading.value = false
      }
    }
  }

  function queuePricesFetch () {
    lastInterestTime = Date.now()
    void load()
  }

  function findPriceByQuery (query: DbQuery): NinjaPriceHit | null {
    const snap = snapshot.value
    const t = target.value
    if (!snap || !t || snap.game !== t.game || snap.league !== t.league) return null
    const hit = lookupPrice(snap, query)
    if (!hit) return null
    return {
      chaos: hit.entry.c,
      url: ninjaDetailsUrl(t.game, t.league, hit, query),
      count: hit.entry.n,
      lowConfidence: hit.entry.lc,
      detailsId: hit.entry.id ?? denseInfoToDetailsId(query),
      ...priceHitFields(hit.key, hit.entry)
    }
  }

  /**
   * WP-R2:PoE2 通貨類以英文 refName 查價(符文塑形自動查價用)。未切割寶石可給 `level`
   * (refName 已帶 `(Level N)` 時不必)。台服 → `no-source`(poe.ninja 只有國際服)。
   */
  function priceOf (refName: string, level?: number): PriceOfResult {
    if (AppConfig().realm === 'tw') return { status: 'no-source' }
    const t = target.value
    if (!t) return { status: 'no-league' }
    const snap = snapshot.value
    if (!snap || snap.game !== t.game || snap.league !== t.league) return { status: 'loading' }
    return priceFromSnapshot(snap, refName, level) ?? { status: 'no-price' }
  }

  /**
   * chaos → 顯示單位。PoE1 與 APT 逐條相同(chaos / div);第 24 步 PoE2 改崇高石 / 神聖石(≥ 1 div 換神聖石,
   * 與符文塑形徽章同規則;`coreOnly` = 不換神聖石)。規則在 core `ninja/units.ts`。
   */
  function autoCurrency (value: number | [number, number], opts: { coreOnly?: boolean } = {}): CurrencyValue {
    const game = target.value?.game ?? AppConfig().game
    return autoCurrencyFor(game, value, { divineRate: xchgRate.value, exaltedRate: exaltedRate.value }, opts)
  }

  setInterval(() => { void load() }, RETRY_INTERVAL_MS)

  // 剪貼簿查價 = 有人在查價(上游由 PriceCheckWindow 呼叫 queuePricesFetch)。
  // 第 24 步起 PoE2 也算(查價面板「通貨價格區」經 poe2-price-source.ts 讀這份價格表);台服 / 私人聯盟 target 為 null,load 直接 return。
  // 節流不變:只有快取時 15 分鐘 TTL、這次執行抓過後 31 分鐘、抓價中不重複。
  Host.onItemText(() => {
    queuePricesFetch()
  })

  // 換區 / 換遊戲 / 換聯盟 → 清空,讀新目標的快取(有人在查價才上網)
  watch(targetKey, () => {
    clear()
    void load()
  }, { immediate: true })

  return {
    xchgRate: readonly(xchgRate),
    exaltedRate: readonly(exaltedRate),
    isLoading: readonly(isLoading),
    lastFetchedAt: readonly(lastFetchedAt),
    lastError: readonly(lastError),
    snapshot: readonly(snapshot),
    load,
    queuePricesFetch,
    findPriceByQuery,
    priceOf,
    autoCurrency,
    initialLoading: () => isLoading.value && !snapshot.value
  }
})

export function displayRounding (value: number, fraction = false): string {
  if (fraction && Math.abs(value) < 1) {
    if (value === 0) return '0'
    return '1∕' + displayRounding(1 / value)
  }
  if (Math.abs(value) < 10) {
    return Number(value.toFixed(1)).toString().replace(/\.0$/, '')
  }
  return Math.round(value).toString()
}
