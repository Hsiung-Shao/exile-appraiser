import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { DataSource } from '@exile-appraiser/core/games/adapter'
import type { Language, Realm } from '@exile-appraiser/core/realm'
import { configureDataSource, activateLangData, LOADED_DATA, PRIMARY_DATA } from '@/assets/data'
import { nodeDataSource } from '@/assets/data/node-source'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { hostOptions } from '@/parser/host-options'
import { loadedOcrTextLang } from '@/desecration/reveal-entry'
import { setupTests, DATA_DIR } from './vitest.setup'
import { poe2Adapter, createPresets, createTradeRequest, detectItemLanguage } from '../src/index'
import { FIXTURES_DIR } from './zhTW/helpers/fixture-harness'

/**
 * 第 27 步:查價時依物品文字自動判斷語言(PoE2)。
 *
 * 使用者回報:客戶端語言設繁中、遊戲改英文後,英文查價全部失敗(`item.wrong_language|English|正體中文`)。
 * 國際服改成依複製文字的語言換資料集解析;查詢只用語言無關鍵,所以結果必須與「客戶端語言設對」時**逐字相同**。
 *
 * - `Parser/fixtures/gloom-hide-rare-advanced.en.txt`:使用者實際複製的英文進階複製文字(Ctrl+Alt+C)。
 * - `zhTW/fixtures/{en,cmn-Hant}/` 第 23 步的成對 fixture:英文文字在繁中客戶端、繁中文字在英文客戶端各跑一次。
 * - 台服:只支援繁中客戶端,英文文字照舊報 `item.wrong_language`。
 *
 * 流程比照 renderer `App.vue` `load()`:`prepareItemText(text, realm)` → `parseClipboard` →
 * `createPresets(…, clientLanguage = 目前資料集的語系)`(renderer 的 `useIntlSite` 依 `dataLanguage`)。
 */
const LEAGUE = 'Runes of Aldur'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const GLOOM = fs.readFileSync(path.join(HERE, 'Parser/fixtures/gloom-hide-rare-advanced.en.txt'), 'utf8')
const EN_DIR = path.join(FIXTURES_DIR, 'en')
const ZH_DIR = path.join(FIXTURES_DIR, 'cmn-Hant')
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, `${name}.txt`), 'utf8')
const EN_NAMES = fs.readdirSync(EN_DIR).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')).sort()
const ZH_NAMES = fs.readdirSync(ZH_DIR).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')).sort()

/** 讀檔計數的 DataSource(驗證另一語系只讀一次、之後走快取) */
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
  const info = await poe2Adapter.prepareItemText(text, realm)
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`${label} 解析失敗:${r.error}`)
  const lang = poe2Adapter.dataLanguage()!
  expect(lang).toBe(info.lang)
  const { presets, active } = createPresets(r.value, opts(lang))
  const preset = presets.find(p => p.id === active) ?? presets[0]
  return { lang, detected: info.detected, item: r.value, request: createTradeRequest(preset, r.value) }
}

const counted = countingSource(nodeDataSource(DATA_DIR))
const base = { en: new Map<string, Checked>(), zh: new Map<string, Checked>() }
const cross = { enUnderZh: new Map<string, Checked>(), zhUnderEn: new Map<string, Checked>() }
let gloomEn: Checked
let gloomUnderZh: Checked
let readsAfterFirstSwitch = -1
let ocrLangWhileEnActive: string | undefined

beforeAll(async () => {
  setupTests({ language: 'en' })
  // ① 客戶端英文:英文文字(基準)→ 繁中文字(自動換成繁中資料集)
  await poe2Adapter.loadData(counted.ds, 'en')
  gloomEn = await check(GLOOM, 'gloom/en-client')
  for (const n of EN_NAMES) base.en.set(n, await check(read(EN_DIR, n), `en/${n}@en`))
  const before = counted.reads.length
  for (const n of ZH_NAMES) cross.zhUnderEn.set(n, await check(read(ZH_DIR, n), `cmn-Hant/${n}@en`))
  readsAfterFirstSwitch = counted.reads.length - before
  counted.reads.length = 0

  // ② 改成客戶端繁中(同一個 DataSource → 兩套都在快取):繁中文字(基準)→ 英文文字(自動換成英文資料集)
  await poe2Adapter.loadData(counted.ds, 'cmn-Hant')
  for (const n of ZH_NAMES) base.zh.set(n, await check(read(ZH_DIR, n), `cmn-Hant/${n}@zh`))
  gloomUnderZh = await check(GLOOM, 'gloom/zh-client')
  ocrLangWhileEnActive = loadedOcrTextLang()
  for (const n of EN_NAMES) cross.enUnderZh.set(n, await check(read(EN_DIR, n), `en/${n}@zh`))
}, 300_000)

describe('語言判斷(PoE2 client_strings 標頭)', () => {
  it('使用者回報的 Gloom Hide 是英文;繁中 fixture 全是繁中、英文 fixture 全是英文', () => {
    expect(detectItemLanguage(GLOOM)).toBe('en')
    for (const n of EN_NAMES) expect(detectItemLanguage(read(EN_DIR, n)), n).toBe('en')
    for (const n of ZH_NAMES) expect(detectItemLanguage(read(ZH_DIR, n)), n).toBe('cmn-Hant')
  })

  it('沒有名牌標頭的文字判斷不出來', () => {
    expect(detectItemLanguage('')).toBeUndefined()
    expect(detectItemLanguage('hello\nworld\n')).toBeUndefined()
    expect(detectItemLanguage('Класс предмета: Кольца\nРедкость: Редкий\n')).toBeUndefined()
  })
})

describe('國際服:客戶端繁中收到英文文字(使用者回報)', () => {
  it('Gloom Hide 解析成功,改用英文資料集', () => {
    expect(gloomUnderZh.detected).toBe('en')
    expect(gloomUnderZh.lang).toBe('en')
    expect(gloomUnderZh.item.info.refName).toBe('Trailblazer Armour')
    expect(gloomUnderZh.item.unknownModifiers.map(m => m.text)).toEqual([])
  })

  it('trade query 與客戶端英文時逐字相同', () => {
    expect(gloomUnderZh.request).toEqual(gloomEn.request)
  })

  it('query 合理:基底 Trailblazer Armour、詞綴是 Spirit / 護甲閃避 / 冰火抗性的 stat id', () => {
    const q = (gloomUnderZh.request as any).query
    const json = JSON.stringify(q)
    expect(json).not.toMatch(/[㐀-鿿]/)
    expect(q.filters?.type_filters?.filters?.category?.option ?? q.type).toBeTruthy()
    const ids = (q.stats as any[]).flatMap(g => g.filters.map((f: any) => f.id))
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(id).toMatch(/^[a-z_]+\.[a-z_0-9.]+$/)
  })

  it('第 23 步的英文 fixture 全部:查詢與客戶端英文時逐字相同', () => {
    expect(EN_NAMES.length).toBeGreaterThanOrEqual(10)
    for (const n of EN_NAMES) {
      const got = cross.enUnderZh.get(n)!
      expect(got.lang, n).toBe('en')
      expect(got.request, n).toEqual(base.en.get(n)!.request)
      expect(got.item.newMods.map(m => [m.info.type, m.info.tier]), n)
        .toEqual(base.en.get(n)!.item.newMods.map(m => [m.info.type, m.info.tier]))
    }
  })

  it('解析完 host 選項的 language 跟著換成 en(magic-name、錯語系提示讀它);換回繁中文字再換回', async () => {
    expect(hostOptions().language).toBe('en')
    await check(read(ZH_DIR, ZH_NAMES[0]), 'zh-again')
    expect(hostOptions().language).toBe('cmn-Hant')
  })

  it('OCR / 符文塑形的「客戶端語言」不跟著查價換(PRIMARY_DATA)', () => {
    expect(ocrLangWhileEnActive).toBe('zh')
    expect(PRIMARY_DATA?.lang).toBe('cmn-Hant')
  })
})

describe('國際服:客戶端英文收到繁中文字(反向)', () => {
  it('第 23 步的繁中 fixture 全部能解析,查詢與客戶端繁中時逐字相同', () => {
    expect(ZH_NAMES.length).toBeGreaterThanOrEqual(10)
    for (const n of ZH_NAMES) {
      const got = cross.zhUnderEn.get(n)!
      expect(got.lang, n).toBe('cmn-Hant')
      expect(got.request, n).toEqual(base.zh.get(n)!.request)
    }
  })

  it('成對的物品:繁中文字在英文客戶端的查詢 = 英文文字在英文客戶端的查詢', () => {
    const pairs = EN_NAMES.filter(n => ZH_NAMES.includes(n))
    expect(pairs.length).toBeGreaterThanOrEqual(5)
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
  it('客戶端繁中 + 英文文字 → 不換語系,照舊報 item.wrong_language', async () => {
    const info = await poe2Adapter.prepareItemText(GLOOM, 'tw')
    expect(info).toEqual({ detected: 'en', lang: 'cmn-Hant', clientLanguage: 'cmn-Hant' })
    expect(poe2Adapter.dataLanguage()).toBe('cmn-Hant')
    const r = parseClipboard(GLOOM)
    expect(r.isErr() && r.error).toBe('item.wrong_language|English|正體中文')
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
    expect(await activateLangData('cmn-Hant')).toBe(true) // 換 DataSource → 舊快取作廢、重讀
    await expect(activateLangData('en')).rejects.toThrow('模擬讀檔失敗')
    expect(LOADED_DATA?.lang).toBe('cmn-Hant')
    const r = parseClipboard(read(ZH_DIR, ZH_NAMES[0]))
    expect(r.isOk()).toBe(true)
  })
})
