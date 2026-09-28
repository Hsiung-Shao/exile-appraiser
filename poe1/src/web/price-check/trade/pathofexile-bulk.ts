import { DateTime } from 'luxon'
import { TradeResponse, Account, adjustRateLimits, tradeTag, preventQueueCreation, tradeSession } from './common'
import type { TradeContext } from '@exile-appraiser/core/games/adapter'
import { apiBase } from '@exile-appraiser/core/realm'
import { RateLimiter } from './RateLimiter'
import { ItemFilters } from '../filters/interfaces'
import { ParsedItem } from '@/parser'
import { Cache } from './Cache'

interface TradeRequest {
  engine: 'new'
  query: {
    status: { option: 'online' | 'onlineleague' | 'any' }
    have: string[]
    want: string[]
    minimum?: number
    fulfillable?: null
  }
  sort: { have: 'asc' }
}

interface SearchResult {
  id: string
  result: Record<string, FetchResult>
  total: number
}

interface FetchResult {
  id: string
  listing: {
    indexed: string
    offers: Array<{
      exchange: {
        currency: string
        amount: number
      }
      item: {
        amount: number
        stock: number
      }
    }>
    account: Account
  }
}

export interface PricingResult {
  id: string
  relativeDate: string
  exchangeAmount: number
  itemAmount: number
  stock: number
  accountStatus: 'offline' | 'online' | 'afk'
  isMine: boolean
  accountName: string
  ign: string
}

export function exchangeUrl (ctx: Pick<TradeContext, 'realm'>, leagueId: string): string {
  return `${apiBase(ctx.realm)}/api/trade/exchange/${encodeURIComponent(leagueId)}`
}

async function requestTradeResultList (ctx: TradeContext, body: TradeRequest, leagueId: string): Promise<SearchResult> {
  const { limits: RATE_LIMIT_RULES, cache } = tradeSession(ctx.realm)
  let data = cache.get<SearchResult>([ctx.realm, 'exchange', body, leagueId])

  if (!data) {
    preventQueueCreation([
      { count: 1, limiters: RATE_LIMIT_RULES.EXCHANGE }
    ])

    await RateLimiter.waitMulti(RATE_LIMIT_RULES.EXCHANGE)

    const response = await ctx.http(exchangeUrl(ctx, leagueId), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    adjustRateLimits(RATE_LIMIT_RULES.EXCHANGE, response.headers, ctx.latencySeconds)

    const _data = await response.json() as TradeResponse<SearchResult>
    if (_data.error) {
      throw new Error(_data.error.message)
    } else {
      data = _data
    }

    cache.set<SearchResult>([ctx.realm, 'exchange', body, leagueId], data, Cache.deriveTtl(...RATE_LIMIT_RULES.EXCHANGE))
  }

  return data
}

function toPricingResult (
  result: FetchResult,
  opts: { accountName: string },
  offer: number
): PricingResult {
  return {
    id: result.id,
    relativeDate: DateTime.fromISO(result.listing.indexed).toRelative({ style: 'short' }) ?? '',
    exchangeAmount: result.listing.offers[offer].exchange.amount,
    itemAmount: result.listing.offers[offer].item.amount,
    stock: result.listing.offers[offer].item.stock,
    isMine: (result.listing.account.name === opts.accountName),
    ign: result.listing.account.lastCharacterName,
    accountName: result.listing.account.name,
    accountStatus: result.listing.account.online
      ? (result.listing.account.online.status === 'afk' ? 'afk' : 'online')
      : 'offline'
  }
}

export interface BulkSearch {
  queryId: string
  haveTag: string
  total: number
  listed: PricingResult[]
}

export function createTradeRequest (filters: ItemFilters, item: ParsedItem, have: string[]): TradeRequest {
  return {
    engine: 'new',
    query: {
      have: have,
      want: [tradeTag(item)!],
      status: {
        option: filters.trade.offline
          ? 'any'
          : (filters.trade.onlineInLeague ? 'onlineleague' : 'online')
      },
      minimum: (filters.stackSize && !filters.stackSize.disabled) ? filters.stackSize.value : undefined
      // fulfillable: null
    },
    sort: { have: 'asc' }
  }
}

const SHOW_RESULTS = 20
const API_FETCH_LIMIT = 100

export async function execBulkSearch (
  ctx: TradeContext,
  item: ParsedItem,
  filters: ItemFilters,
  have: string[]
): Promise<Array<BulkSearch | null>> {
  const opts = { accountName: ctx.accountName }
  const query = await requestTradeResultList(
    ctx,
    createTradeRequest(filters, item, have),
    filters.trade.league
  )

  const offer = 0
  const results = Object.values(query.result)
    .filter(result => result.listing.offers.length === 1)

  const resultByHave = have.map(tradeTag => {
    const resultsTag = results.filter(result => result.listing.offers[offer].exchange.currency === tradeTag)

    const loadedOnDemand = (
      tradeTag === 'chaos' &&
      resultsTag.length < SHOW_RESULTS &&
      query.total > API_FETCH_LIMIT
    )
    if (loadedOnDemand) return null

    const listed = resultsTag
      .sort((a, b) =>
        (a.listing.offers[offer].exchange.amount / a.listing.offers[offer].item.amount) -
        (b.listing.offers[offer].exchange.amount / b.listing.offers[offer].item.amount))
      .slice(0, SHOW_RESULTS)
      .map(result => toPricingResult(result, opts, offer))

    const chaosIsLoaded = (
      tradeTag === 'divine' &&
      resultsTag.length < results.length &&
      ((results.length - resultsTag.length) >= SHOW_RESULTS || query.total <= API_FETCH_LIMIT)
    )

    return {
      queryId: query.id,
      haveTag: tradeTag,
      // this is a best guess when making request with multiple `have` currencies
      total: (chaosIsLoaded)
        ? resultsTag.length
        : (query.total - (results.length - resultsTag.length)),
      listed: listed
    }
  })

  return resultByHave
}
