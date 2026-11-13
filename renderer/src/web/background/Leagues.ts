/**
 * 聯盟清單(取代上游 `web/background/Leagues.ts`):過濾/預設規則在 core,這裡只負責
 * 狀態與「按 game + realm 分開存選擇」(PoE1 `/api/leagues`、PoE2 `/api/trade2/data/leagues`,規則見 core)。介面與上游相同(`useLeagues()` → selectedId / selected / list / load)。
 */
import { computed, shallowRef, readonly, watch } from 'vue'
import { createGlobalState } from '@vueuse/core'
import { fetchLeagues, isPrivateLeague, pickLeagueOnLoad, type League } from '@exile-appraiser/core/realm/leagues'
import { AppConfig } from '@/web/Config'
import { Host } from './IPC'

export { PERMANENT_SC } from '@exile-appraiser/core/realm/leagues'

/** 聯盟清單多久算舊(查價時超過就重抓) */
export const LEAGUES_MAX_AGE_MS = 60 * 60 * 1000
/** 載入失敗後多久才再試 */
export const LEAGUES_RETRY_MS = 60 * 1000

export const useLeagues = createGlobalState(() => {
  const isLoading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const tradeLeagues = shallowRef<League[]>([])

  const selectedId = computed<string | undefined>({
    get () {
      return (tradeLeagues.value.length) ? AppConfig().leagueId : undefined
    },
    set (id) {
      AppConfig().leagueId = id
    }
  })

  const selected = computed(() => {
    const { leagueId, realm } = AppConfig()
    if (!tradeLeagues.value || !leagueId) return undefined
    const listed = tradeLeagues.value.find(league => league.id === leagueId)
    return {
      id: leagueId,
      realm,
      isPopular: !isPrivateLeague(leagueId) && Boolean(listed?.isPopular)
    }
  })

  /** 這個時間之前不重抓(成功後一小時;失敗後一分鐘,免得每次查價都打一次;切區 / 切遊戲歸零) */
  let nextReloadAt = 0

  /**
   * 清單太舊就重抓:程式常駐好幾天時,新賽季開了也只有啟動那次的清單。
   * 由「有人在查價」的入口呼叫(Prices.ts `queuePricesFetch`),不另開計時器。
   */
  function loadIfStale (now = Date.now()) {
    if (isLoading.value || now < nextReloadAt) return
    void load()
  }

  async function load () {
    isLoading.value = true
    error.value = null
    nextReloadAt = Date.now() + LEAGUES_RETRY_MS
    const { realm, game } = AppConfig()
    try {
      const list = await fetchLeagues(Host.httpFetch, realm, game)
      // 載入期間使用者可能已切區 / 切遊戲;結果只在兩者都沒變時採用
      if (AppConfig().realm !== realm || AppConfig().game !== game) return
      tradeLeagues.value = list
      nextReloadAt = Date.now() + LEAGUES_MAX_AGE_MS
      // 新賽季聯盟第一次出現就切過去(否則賽季間退回 Standard 後會一直停在 Standard)
      const cfg = AppConfig()
      const picked = pickLeagueOnLoad(list, cfg.leagueId, cfg.leagueSeenBy[game]?.[realm], game)
      if (picked.seen !== cfg.leagueSeenBy[game]?.[realm]) {
        cfg.leagueSeenBy = { ...cfg.leagueSeenBy, [game]: { ...cfg.leagueSeenBy[game], [realm]: picked.seen } }
      }
      cfg.leagueId = picked.id
    } catch (e) {
      // 已經有清單時的背景重抓失敗不擋畫面(沿用手上的清單,一分鐘後下次查價再試)
      if (tradeLeagues.value.length) console.warn(`[leagues] 重抓失敗,沿用現有清單:${(e as Error).message}`)
      else error.value = (e as Error).message
    } finally {
      isLoading.value = false
    }
  }

  // 切區 / 切遊戲 → 清單與選擇都要換
  watch(() => [AppConfig().realm, AppConfig().game], () => {
    tradeLeagues.value = []
    nextReloadAt = 0
    void load()
  })

  return {
    isLoading,
    error,
    selectedId,
    selected,
    list: readonly(tradeLeagues),
    load,
    loadIfStale
  }
})
