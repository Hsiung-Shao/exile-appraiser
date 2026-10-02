import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { DataSource } from '@exile-appraiser/core/games/adapter'
import type { Language, Realm } from '@exile-appraiser/core/realm'
import { configureDataSource, activateLangData, ACTIVE_LANG, PRIMARY_LANG } from '@/assets/data'
import { nodeDataSource } from '@/assets/data/node-source'
import type { ParsedItem } from '@/parser/ParsedItem'
import { poe1Adapter, createPresets, createTradeRequest, detectItemLanguage } from '../src/index'
import { FIXTURES_DIR } from './helpers/fixture-harness'

/**
 * 第 27 步:查價時依物品文字自動判斷語言(PoE1)。
 *
 * 國際服:剪貼簿文字的語言 ≠ 客戶端語言時改用文字的語言解析;查詢只用語言無關鍵,
 * 所以結果必須與「客戶端語言設對」時**逐字相同**。用第 23 步 `fixtures/en/` 與 `fixtures/cmn-Hant/` 的全部樣本:
 * 英文文字在繁中客戶端、繁中文字在英文客戶端各跑一次。台服維持現行(英文文字照舊解析失敗)。
 *
 * 流程比照 renderer `App.vue` `load()`:`prepareItemText(text, realm)` → `parseClipboard` →
 * `createPresets(…, clientLanguage = 目前資料集的語系)`(renderer 的 `useIntlSite` 依 `dataLanguage`)。
 */
const LEAGUE = 'Standard'
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/poe1')
const EN_DIR = path.join(FIXTURES_DIR, 'en')
const ZH_DIR = path.join(FIXTURES_DIR, 'cmn-Hant')
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, `${name}.txt`), 'utf8')
const EN_NAMES = fs.readdirSync(EN_DIR).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')).sort()
const ZH_NAMES = fs.readdirSync(ZH_DIR).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')).sort()

function countingSource (inner: DataSource) {
  const reads: string[] = []
  const ds: DataSource = {
    text: async (p) => { reads.push(p); return await inner.text(p) },
    binary: async (p) => { reads.push(p); return await inner.binary(p) },
    module: async (p) => { reads.push(p); return await inner.module(p) }
  }
  return { ds, reads }
}

function opts (clientLanguage: Language) {
  return {
    league: LEAGUE, realm: 'intl' as const, clientLanguage, searchStatRange: 10,
    currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
  }
}

interface Checked { lang: Language, detected?: Language, item: ParsedItem, request: unknown }

/** = renderer App.vue load() + CheckedItem 的預設查詢 */
async function check (text: string, label: string, realm: Realm = 'intl'): Promise<Checked> {
  const info = await poe1Adapter.prepareItemText(text, realm)
  const r = poe1Adapter.parseClipboard(text)
  if (!r.ok) throw new Error(`${label} 解析失敗:${r.error}`)
  const lang = poe1Adapter.dataLanguage()!
  expect(lang).toBe(info.lang)
  const { presets, active } = createPresets(r.item, opts(lang))
  const preset = presets.find(p => p.id === active) ?? presets[0]
  return { lang, detected: info.detected, item: r.item, request: createTradeRequest(preset) }
}

const counted = countingSource(nodeDataSource(DATA_DIR))
const base = { en: new Map<string, Checked>(), zh: new Map<string, Checked>() }
const cross = { enUnderZh: new Map<string, Checked>(), zhUnderEn: new Map<string, Checked>() }
let readsAfterFirstSwitch = -1
let primaryWhileEnActive: string | undefined

beforeAll(async () => {
  // ① 客戶端英文:英文文字(基準)→ 繁中文字(自動換成繁中資料集)
  await poe1Adapter.loadData(counted.ds, 'en')
  for (const n of EN_NAMES) base.en.set(n, await check(read(EN_DIR, n), `en/${n}@en`))
  const before = counted.reads.length
  for (const n of ZH_NAMES) cross.zhUnderEn.set(n, await check(read(ZH_DIR, n), `cmn-Hant/${n}@en`))
  readsAfterFirstSwitch = counted.reads.length - before
  counted.reads.length = 0

  // ② 改成客戶端繁中(同一個 DataSource → 兩套都在快取):繁中文字(基準)→ 英文文字(自動換成英文資料集)
  await poe1Adapter.loadData(counted.ds, 'cmn-Hant')
  for (const n of ZH_NAMES) base.zh.set(n, await check(read(ZH_DIR, n), `cmn-Hant/${n}@zh`))
  for (const n of EN_NAMES) cross.enUnderZh.set(n, await check(read(EN_DIR, n), `en/${n}@zh`))
  primaryWhileEnActive = PRIMARY_LANG
}, 300_000)

describe('語言判斷(PoE1 client_strings 標頭)', () => {
  it('英文 fixture 全是英文、繁中 fixture 全是繁中', () => {
    for (const n of EN_NAMES) expect(detectItemLanguage(read(EN_DIR, n)), n).toBe('en')
    for (const n of ZH_NAMES) expect(detectItemLanguage(read(ZH_DIR, n)), n).toBe('cmn-Hant')
  })

  it('全形冒號(`物品種類:`)也認得;沒有標頭判斷不出來', () => {
    expect(detectItemLanguage('物品種類：戒指\n稀有度：稀有\n')).toBe('cmn-Hant')
    expect(detectItemLanguage('random text\n--------\n')).toBeUndefined()
  })
})

describe('國際服:客戶端繁中收到英文文字', () => {
  it('第 23 步的英文 fixture 全部解析成功,查詢與客戶端英文時逐字相同', () => {
    expect(EN_NAMES.length).toBeGreaterThanOrEqual(10)
    for (const n of EN_NAMES) {
      const got = cross.enUnderZh.get(n)!
      expect(got.detected, n).toBe('en')
      expect(got.lang, n).toBe('en')
      expect(got.request, n).toEqual(base.en.get(n)!.request)
      expect(got.item.unknownModifiers.map(m => m.text), n).toEqual(base.en.get(n)!.item.unknownModifiers.map(m => m.text))
    }
  })

  it('客戶端語言那一套不跟著查價換(PRIMARY_LANG)', () => {
    expect(primaryWhileEnActive).toBe('cmn-Hant')
    expect(ACTIVE_LANG).toBe('en')
  })
})

describe('國際服:客戶端英文收到繁中文字(反向)', () => {
  it('繁中 fixture 全部解析成功,查詢與客戶端繁中時逐字相同', () => {
    expect(ZH_NAMES.length).toBeGreaterThanOrEqual(10)
    for (const n of ZH_NAMES) {
      const got = cross.zhUnderEn.get(n)!
      expect(got.lang, n).toBe('cmn-Hant')
      expect(got.request, n).toEqual(base.zh.get(n)!.request)
    }
  })

  it('成對的物品:繁中文字在英文客戶端的查詢 = 英文文字在英文客戶端的查詢', () => {
    // 與 en-client.test.ts「中英成對」同一份清單(map-rare-01 繁中有一條歧義詞綴 → 繁中是 count 群組、英文是單一詞綴,見 en-client.test.ts)
    const pairs = ['boots-unique-vestigial-01', 'boots-unique-vestigial-02', 'gem-support-01', 'map-blighted-rare-01', 'mercenary-warrant-01', 'ultimatum-01', 'blood-filled-vessel-01']
    for (const n of pairs) expect(cross.zhUnderEn.get(n)!.request, n).toEqual(base.en.get(n)!.request)
  })
})

describe('資料集快取', () => {
  it('另一語系第一次讀檔,之後換來換去(含改客戶端語言)都不再讀檔', () => {
    expect(readsAfterFirstSwitch).toBeGreaterThan(0)
    expect(counted.reads).toEqual([])
  })
})

describe('台服維持現行(只支援繁中客戶端)', () => {
  it('客戶端繁中 + 英文文字 → 不換語系,照舊解析失敗', async () => {
    const text = read(EN_DIR, EN_NAMES[0])
    const info = await poe1Adapter.prepareItemText(text, 'tw')
    expect(info).toEqual({ detected: 'en', lang: 'cmn-Hant', clientLanguage: 'cmn-Hant' })
    expect(poe1Adapter.dataLanguage()).toBe('cmn-Hant')
    const r = poe1Adapter.parseClipboard(text)
    expect(r.ok).toBe(false)
  })
})

describe('換語系載入失敗', () => {
  it('拋錯且資料集維持原本那一套(不留半套),繁中照常解析', async () => {
    const inner = nodeDataSource(DATA_DIR)
    const failing: DataSource = {
      ...inner,
      text: async (p) => {
        if (p === 'en/stats.ndjson') throw new Error('模擬讀檔失敗')
        return await inner.text(p)
      }
    }
    configureDataSource(failing)
    await activateLangData('cmn-Hant') // 換 DataSource → 舊快取作廢、重讀
    await expect(activateLangData('en')).rejects.toThrow('模擬讀檔失敗')
    expect(ACTIVE_LANG).toBe('cmn-Hant')
    expect(poe1Adapter.parseClipboard(read(ZH_DIR, ZH_NAMES[0])).ok).toBe(true)
  })
})
