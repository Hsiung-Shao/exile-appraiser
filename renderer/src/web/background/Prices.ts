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
 */
import { computed, readonly, shallowRef, watch } from 'vue'
import { createGlobalState } from '@vueuse/core'
import {
  createNinjaClient, denseInfoToDetailsId, isFresh, lookupPrice, ninjaDetailsUrl, parseSnapshot, toSnapshot,
  NINJA_CACHE_TTL_MS, type NinjaGame, type NinjaQuery, type NinjaSnapshot
} from '@exile-appraiser/core/ninja'
import { AppConfig } from '@/web/Config'
import { Host } from './IPC'
import { useLeagues } from './Leagues'

const RETRY_INTERVAL_MS = 4 * 60 * 1000
const UPDATE_INTERVAL_MS = 31 * 60 * 1000
const INTEREST_SPAN_MS = 20 * 60 * 1000

export type DbQuery = NinjaQuery

export interface CurrencyValue {
  min: number
  max: number
  currency: 'chaos' | 'div'
}

export interface NinjaPriceHit {
  chaos: number
  /** poe.ninja 詳細頁 */
  url: string
  /** 掛單數(exchange 類沒有 → 0) */
  count: number
  /** 0 < count < 5 */
  lowConfidence: boolean
  detailsId: string
}

export const usePoeninja = createGlobalState(() => {
  const leagues = useLeagues()

  const xchgRate = shallowRef<number | undefined>(undefined)
  const isLoading = shallowRef(false)
  const lastFetchedAt = shallowRef<number | undefined>(undefined)
  const lastError = shallowRef<string | null>(null)
  const snapshot = shallowRef<NinjaSnapshot | null>(null)

  let lastInterestTime = 0
  /** 這次執行真的上網抓成功的時間(0 = 還沒抓過,只有快取) */
  let lastSessionFetch = 0
  let downloadController: AbortController | undefined
  let cacheLoadedFor: string | undefined

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
    lastFetchedAt.value = snap.fetchedAt
  }

  function clear () {
    downloadController?.abort()
    downloadController = undefined
    isLoading.value = false
    snapshot.value = null
    xchgRate.value = undefined
    lastFetchedAt.value = undefined
    lastError.value = null
    lastSessionFetch = 0
    cacheLoadedFor = undefined
  }

  async function load (force: boolean = false) {
    const t = target.value
    if (!t) return
    const key = targetKey.value

    if (cacheLoadedFor !== key) {
      cacheLoadedFor = key
      let text: string | null = null
      try { text = await Host.ninjaCacheLoad(t.game, t.league) } catch (e) { console.warn('[ninja] 讀快取失敗', e) }
      if (targetKey.value !== key) return
      const cached = parseSnapshot(text, t.game, t.league)
      if (cached && (!snapshot.value || cached.fetchedAt > snapshot.value.fetchedAt)) apply(cached)
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
      detailsId: hit.entry.id ?? denseInfoToDetailsId(query)
    }
  }

  function autoCurrency (value: number | [number, number]): CurrencyValue {
    if (Array.isArray(value)) {
      if (value[1] > (xchgRate.value || 9999)) {
        return { min: chaosToStable(value[0]), max: chaosToStable(value[1]), currency: 'div' }
      }
      return { min: value[0], max: value[1], currency: 'chaos' }
    }
    if (value > ((xchgRate.value || 9999) * 0.94)) {
      if (value < ((xchgRate.value || 9999) * 1.06)) {
        return { min: 1, max: 1, currency: 'div' }
      } else {
        return { min: chaosToStable(value), max: chaosToStable(value), currency: 'div' }
      }
    }
    return { min: value, max: value, currency: 'chaos' }
  }

  function chaosToStable (count: number) {
    return count / (xchgRate.value || 9999)
  }

  setInterval(() => { void load() }, RETRY_INTERVAL_MS)

  // 剪貼簿查價 = 有人在查價(上游由 PriceCheckWindow 呼叫 queuePricesFetch)。只算 PoE1:
  // PoE2 的元件用 poe2/src 自己的 Prices,這裡替 PoE2 抓價不會有人用。
  Host.onItemText(() => {
    if (AppConfig().game === 'poe1') queuePricesFetch()
  })

  // 換區 / 換遊戲 / 換聯盟 → 清空,讀新目標的快取(有人在查價才上網)
  watch(targetKey, () => {
    clear()
    void load()
  }, { immediate: true })

  return {
    xchgRate: readonly(xchgRate),
    isLoading: readonly(isLoading),
    lastFetchedAt: readonly(lastFetchedAt),
    lastError: readonly(lastError),
    snapshot: readonly(snapshot),
    load,
    queuePricesFetch,
    findPriceByQuery,
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
