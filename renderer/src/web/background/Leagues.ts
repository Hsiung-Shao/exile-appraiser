/**
 * 聯盟清單(取代上游 `web/background/Leagues.ts`):過濾/預設規則在 core,這裡只負責
 * 狀態與「按 game + realm 分開存選擇」(PoE1 `/api/leagues`、PoE2 `/api/trade2/data/leagues`,規則見 core)。介面與上游相同(`useLeagues()` → selectedId / selected / list / load)。
 */
import { computed, shallowRef, readonly, watch } from 'vue'
import { createGlobalState } from '@vueuse/core'
import { fetchLeagues, isPrivateLeague, pickLeague, type League } from '@exile-appraiser/core/realm/leagues'
import { AppConfig } from '@/web/Config'
import { Host } from './IPC'

export { PERMANENT_SC } from '@exile-appraiser/core/realm/leagues'

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

  async function load () {
    isLoading.value = true
    error.value = null
    const { realm, game } = AppConfig()
    try {
      const list = await fetchLeagues(Host.httpFetch, realm, game)
      // 載入期間使用者可能已切區 / 切遊戲;結果只在兩者都沒變時採用
      if (AppConfig().realm !== realm || AppConfig().game !== game) return
      tradeLeagues.value = list
      AppConfig().leagueId = pickLeague(list, AppConfig().leagueId, game)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      isLoading.value = false
    }
  }

  // 切區 / 切遊戲 → 清單與選擇都要換
  watch(() => [AppConfig().realm, AppConfig().game], () => {
    tradeLeagues.value = []
    void load()
  })

  return {
    isLoading,
    error,
    selectedId,
    selected,
    list: readonly(tradeLeagues),
    load
  }
})
