/**
 * PoE2 無頭驗證用 CLI(抄 poe1/src/cli.ts;root 用 `npm run check -- <檔> --game poe2 …` 轉到這裡):
 *
 *   npm run check -- <剪貼簿文字檔> --game poe2 [--realm intl|tw|both] [--lang cmn-Hant|en] [--league <id>]
 *                                   [--range 10] [--online] [--json]
 *
 * 預設 dry-run:印出解析摘要、認不出的詞綴、每個 preset 的查詢 payload、API 端點與網頁網址。
 * `--online` 用 Node 的 fetch 真的送出(⚠ 沒有 Electron session 的 Cloudflare cookie,
 * 可能被 403/挑戰頁擋下;正式驗證在 GUI 做)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import { withRetryAfter } from '@exile-appraiser/core/http'
import { REALM_IDS, isSupportedCombination, type Language, type Realm } from '@exile-appraiser/core/realm'
import { fetchLeagues, pickLeague } from '@exile-appraiser/core/realm/leagues'
import { nodeDataSource } from '@/assets/data/node-source'
import {
  poe2Adapter, createPresets, createTradeRequest, apiToSatisfySearch,
  webSearchUrl, searchUrl, exchangeUrl, searchPrices, bulkPrices, webExchangeUrl
} from './index'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/poe2')
const USER_AGENT = 'exile-appraiser/0.1.0 (cli; +https://github.com/Hsiung-Shao)'

function arg (name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const has = (name: string) => process.argv.includes(name)

async function main () {
  // `npm run check --workspace poe2` 會把 cwd 切到 poe2/;使用者是在 repo 根下指令,所以先照 INIT_CWD 解析
  const baseDir = process.env.INIT_CWD ?? process.cwd()
  const file = process.argv.slice(2)
    .filter(a => !a.startsWith('--'))
    .map(a => path.resolve(baseDir, a))
    .find(a => fs.existsSync(a))
  if (!file) {
    console.error('用法:npm run check -- <剪貼簿文字檔> --game poe2 [--realm intl|tw|both] [--lang cmn-Hant|en] [--league <id>] [--range 10] [--online] [--json]')
    process.exit(2)
  }
  const lang = (arg('--lang', 'cmn-Hant') as Language)
  const realmArg = arg('--realm', 'intl')!
  const realms: Realm[] = realmArg === 'both' ? [...REALM_IDS] : [realmArg as Realm]
  const range = Number(arg('--range', '10'))
  const online = has('--online')
  const asJson = has('--json')

  await poe2Adapter.loadData(nodeDataSource(DATA_DIR), lang)

  const text = fs.readFileSync(file, 'utf8')
  const parsed = poe2Adapter.parseClipboard(text)
  if (!parsed.ok) {
    console.error(`解析失敗:${parsed.error}`)
    process.exit(1)
  }
  const item = parsed.item

  const nodeFetch: HttpFetch = async (url, init) => {
    console.error(`[http] ${init?.method ?? 'GET'} ${url}`)
    const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init?.headers }, signal: AbortSignal.timeout(20_000) })
    console.error(`[http] → ${res.status} ${res.headers.get('x-rate-limit-ip-state') ?? ''}`)
    return res as unknown as HttpResponse
  }
  const http = withRetryAfter(nodeFetch, { onWait: s => console.error(`[限流] ${s} 秒後重試`) })

  const out: Record<string, unknown> = {
    file,
    language: lang,
    item: {
      name: item.info.name,
      refName: item.info.refName,
      namespace: item.info.namespace,
      category: item.category,
      rarity: item.rarity,
      itemLevel: item.itemLevel,
      isUnidentified: item.isUnidentified,
      isCorrupted: item.isCorrupted
    },
    unknownModifiers: parsed.unknownModifiers,
    realms: {} as Record<string, unknown>
  }

  for (const realm of realms) {
    if (!isSupportedCombination(realm, lang)) {
      (out.realms as Record<string, unknown>)[realm] = { skipped: `不支援的組合:${realm} + ${lang}` }
      continue
    }
    let league = arg('--league')
    if (!league && online) {
      const list = await fetchLeagues(http, realm, 'poe2')
      league = pickLeague(list, undefined, 'poe2')
      console.error(`[${realm}] 聯盟清單:${list.map(l => l.id).join(', ')} → 使用 ${league}`)
    }
    league ??= 'Standard'

    const { presets, active } = createPresets(item, {
      league, realm, clientLanguage: lang, searchStatRange: range,
      currency: null, collapseListings: 'api', activateStockFilter: false, merchantOnly: false
    })
    const ctx = { http, realm, latencySeconds: 0, accountName: '' }
    const realmOut: Record<string, unknown> = { league, active, presets: [] as unknown[] }
    for (const preset of presets) {
      const api = apiToSatisfySearch(item, preset)
      const request = createTradeRequest(preset, item)
      const entry: Record<string, unknown> = {
        id: preset.id,
        api,
        endpoint: api === 'trade' ? searchUrl(ctx, league) : exchangeUrl(ctx, league),
        webUrl: api === 'trade' ? webSearchUrl(realm, league, request) : webExchangeUrl(realm, league),
        // PoE2 的 StatFilter 沒有 PoE1 的群組(FilterGroup)形狀
        stats: preset.stats.map(s => ({ text: s.text, tradeId: s.tradeId, roll: s.roll ? { min: s.roll.min, max: s.roll.max } : undefined, disabled: s.disabled })),
        request
      }
      if (online && preset.id === active) {
        try {
          if (api === 'trade') {
            const { search, results } = await searchPrices(ctx, preset, item)
            entry.online = { total: search.total, searchId: search.id, webUrl: webSearchUrl(realm, league, request, search.id), results }
          } else {
            const { results, have } = await bulkPrices(ctx, item, preset.filters)
            entry.online = { have, results }
          }
        } catch (e) {
          entry.online = { error: (e as Error).message }
        }
      }
      (realmOut.presets as unknown[]).push(entry)
    }
    (out.realms as Record<string, unknown>)[realm] = realmOut
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
    return
  }
  const it = out.item as Record<string, unknown>
  console.log(`物品:${it.name}  [${it.refName}]  ${it.namespace}/${it.category}  rarity=${it.rarity}  ilvl=${it.itemLevel ?? '-'}`)
  const unknown = out.unknownModifiers as string[]
  if (unknown.length) console.log(`⚠ 認不出的詞綴(${unknown.length}):\n  - ` + unknown.join('\n  - '))
  for (const [realm, r] of Object.entries(out.realms as Record<string, any>)) {
    console.log(`\n== realm ${realm} ==`)
    if (r.skipped) { console.log('  ' + r.skipped); continue }
    console.log(`  league=${r.league}  active preset=${r.active}`)
    for (const p of r.presets) {
      console.log(`  -- preset ${p.id} (${p.api})`)
      console.log(`     endpoint: ${p.endpoint}`)
      console.log(`     name/type: ${JSON.stringify({ name: p.request.query?.name, type: p.request.query?.type })}`)
      for (const s of p.stats) {
        console.log(s.group
          ? `     [${s.group}] ${s.meta} → ${s.tradeIds.join(', ')}`
          : `     ${s.disabled ? '  ' : '✓ '}${s.text}  ${s.tradeId?.[0] ?? ''}${s.roll ? `  [${s.roll.min ?? ''}..${s.roll.max ?? ''}]` : ''}`)
      }
      console.log(`     web: ${p.webUrl.slice(0, 160)}${p.webUrl.length > 160 ? '…' : ''}`)
      if (p.online) {
        if (p.online.error) console.log(`     online: ✗ ${p.online.error}`)
        else if (p.online.results && 'total' in p.online) {
          console.log(`     online: total=${p.online.total}  id=${p.online.searchId}`)
          for (const x of p.online.results.slice(0, 10)) console.log(`       ${x.priceAmount} ${x.priceCurrency}  ${x.ign}  (${x.relativeDate})`)
        } else console.log(`     online: ${JSON.stringify(p.online).slice(0, 300)}`)
      }
    }
  }
}

// RateLimiter 的 setTimeout 會讓事件迴圈活著(限流視窗最長 5 分鐘),印完就明確結束
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
