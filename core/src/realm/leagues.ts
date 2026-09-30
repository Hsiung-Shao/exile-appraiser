/**
 * 聯盟清單:純函式版,移植自 Awakened PoE Trade / Exiled Exchange 2 `web/background/Leagues.ts`
 * 的過濾與預設規則。網路請求由呼叫端做(`fetchLeagues` 只收注入的 HttpFetch),
 * 狀態由呼叫端存(按 game + realm 分開)。
 *
 * 兩個遊戲的端點與回應結構不同:
 * - PoE1:`/api/leagues?type=main&realm=pc` → `ApiLeague[]`(有 rules,需過濾 HC / SSF / Ruthless)
 * - PoE2:`/api/trade2/data/leagues` → `{ result: [{ id, realm: 'poe2', text }] }`(交易站自己的清單,已是可交易聯盟;
 *   上游 E 註解:等 `/api/leagues?realm=poe2` 可用再換)。兩區結構相同,台服 id 是繁中
 *   (2026-09-28 實測:intl `Forbidden Rites / HC … / Runes of Aldur / … / Standard / Hardcore`,
 *   tw `禁忌儀式 / … / 阿德爾的符文 / … / 標準模式 / 專家模式`)。
 */
import type { HttpFetch } from '../http/HttpClient'
import { apiBase, tradeApiBase, type Game, type Realm } from './config'

// pc-ggg / pc-garena 兩區的永久聯盟名稱(台服 API 回的是繁中 id)
export const PERMANENT_SC = ['Standard', '標準模式']
export const PERMANENT_HC = ['Hardcore', '專家模式']

export interface ApiLeague {
  id: string
  event?: boolean
  rules: Array<{ id: string }>
}

/** PoE2 `/api/trade2/data/leagues` 的一列。 */
export interface ApiTrade2League {
  id: string
  realm?: string
  text: string
}

export interface League {
  id: string
  isPopular: boolean
  /** PoE2 交易站清單附的顯示名稱(與 id 相同的情況居多)。 */
  text?: string
}

/** PoE1:`/api/leagues?type=main&realm=pc`;PoE2:`/api/trade2/data/leagues`。兩區路徑相同。 */
export function leaguesUrl (realm: Realm, game: Game = 'poe1'): string {
  if (game === 'poe2') return `${tradeApiBase(realm, 'poe2')}/data/leagues`
  return `${apiBase(realm)}/api/leagues?type=main&realm=pc`
}

/** PoE1 上游規則:排除永久 HC、`NoParties`(SSF)、非 event 的 `HardMode`(Ruthless)。 */
export function filterTradeLeagues (leagues: ApiLeague[]): League[] {
  return leagues
    .filter(league =>
      !PERMANENT_HC.includes(league.id) &&
      !league.rules.some(rule => rule.id === 'NoParties' ||
        (rule.id === 'HardMode' && !league.event)))
    .map(league => ({ id: league.id, isPopular: true }))
}

/** PoE2 上游(E)規則:交易站清單原樣採用,全部視為熱門。 */
export function mapTrade2Leagues (body: { result: ApiTrade2League[] }): League[] {
  return body.result.map(league => ({ id: league.id, isPopular: true, text: league.text }))
}

export function isPrivateLeague (id: string): boolean {
  if (id.includes('Ruthless')) return true
  return /\(PL\d+\)$/.test(id)
}

/**
 * 是否為「賽季(挑戰)聯盟的軟核交易聯盟」:排除永久聯盟(Standard / Hardcore 與台服繁中名)、
 * `HC ` / `Hardcore` / `專家模式` 開頭的 HC 變體、SSF(含 `Solo Self-Found`)與 Ruthless 變體。
 */
export function isChallengeSoftcoreLeague (id: string): boolean {
  if (PERMANENT_SC.includes(id) || PERMANENT_HC.includes(id)) return false
  if (id.startsWith('HC ') || id.startsWith('Hardcore') || PERMANENT_HC.some(hc => id.startsWith(hc))) return false
  if (/\bSSF\b|Solo Self-Found|Ruthless/.test(id)) return false
  return true
}

/**
 * 決定目前要用哪個聯盟:既有選擇還在清單裡、或是私人聯盟(不在清單裡,照使用者填的用)就沿用;否則
 * 取清單中**第一個**賽季軟核聯盟(`isChallengeSoftcoreLeague`),都沒有才退 Standard(含台服 `標準模式`),
 * 再退 `list[0]`。兩個遊戲同一規則,**不依清單位置**:
 * - PoE2 交易站清單同時列出多個賽季聯盟(2026-09-30 實測 `Forbidden Rites, HC Forbidden Rites, Runes of Aldur,
 *   HC Runes of Aldur, Standard, Hardcore`,目前聯盟是第一個 Forbidden Rites);上游 E 的 `TMP_CHALLENGE = 2`
 *   位置假設會挑到舊的 Runes of Aldur。
 * - PoE1 `filterTradeLeagues` 過濾後是 `Standard, Allflame, Hardcore Allflame`(2026-09-30 實測),
 *   舊的 index 1 規則恰好命中,但依賴 Standard 排第一;改用同一規則後結果不變。
 */
export function pickLeague (list: League[], current: string | undefined, game: Game = 'poe1'): string | undefined {
  void game // 兩個遊戲規則相同;保留參數讓呼叫端不必改
  if (current && (list.some(l => l.id === current) || isPrivateLeague(current))) return current
  const challenge = list.find(l => isChallengeSoftcoreLeague(l.id))
  if (challenge) return challenge.id
  const standard = list.find(l => PERMANENT_SC.includes(l.id))
  if (standard) return standard.id
  return list[0]?.id
}

export async function fetchLeagues (http: HttpFetch, realm: Realm, game: Game = 'poe1'): Promise<League[]> {
  const response = await http(leaguesUrl(realm, game), { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`leagues ${game}/${realm}: HTTP ${response.status} ${JSON.stringify(Object.fromEntries(response.headers))}`)
  }
  if (game === 'poe2') return mapTrade2Leagues(await response.json() as { result: ApiTrade2League[] })
  return filterTradeLeagues(await response.json() as ApiLeague[])
}
