// Node 專用:從磁碟讀 `data/regex/regex_poe{1,2}.json`。renderer 不要 import 這支(用 `parseRegexCatalogue` 自己餵字串)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeLabels, parseLabels, parseRegexCatalogue, type RegexCatalogue, type RegexGame, type RegexLabels, type RegexPage } from './data'
import { algoPages, buildItemModData, parseItemModForms, parseStatsNdjson, type ItemModData, type StatLite } from './pages'
import { parseTemplates, type RegexTemplate } from './share'

/** repo 的 `data/regex/` */
export function defaultRegexDataDir (): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'regex')
}

export function loadRegexCatalogueFile (game: RegexGame, dir = defaultRegexDataDir()): RegexCatalogue {
  const file = path.join(dir, `regex_${game}.json`)
  return parseRegexCatalogue(fs.readFileSync(file, 'utf8'), game)
}

/**
 * regex_data.cpp:64 `RegexDataset::Load`:兩個遊戲的檔都載,`preferred` 排前面;
 * 一個檔壞掉不拖垮另一個(回傳 errors),兩個都沒有才丟例外。
 */
export function loadAllRegexPages (preferred: RegexGame = 'poe1', dir = defaultRegexDataDir()): { pages: RegexPage[], errors: string[] } {
  const games: RegexGame[] = preferred === 'poe2' ? ['poe2', 'poe1'] : ['poe1', 'poe2']
  const pages: RegexPage[] = []
  const errors: string[] = []
  for (const g of games) {
    try {
      pages.push(...loadRegexCatalogueFile(g, dir).pages)
    } catch (e) {
      errors.push(`regex_${g}.json:${(e as Error).message}`)
    }
  }
  if (pages.length === 0) throw new Error(`${dir} 底下沒有可用的 regex_*.json 清單檔\n${errors.join('\n')}`)
  return { pages, errors }
}

/** 演算法頁標籤:資料檔自帶 labels(schema 2)逐鍵優先,暫代檔 `labels.<game>.json` 補缺鍵(mergeLabels) */
export function loadLabelsFor (cat: RegexCatalogue, dir = defaultRegexDataDir()): RegexLabels | null {
  const file = path.join(dir, `labels.${cat.game}.json`)
  const fallback = fs.existsSync(file) ? parseLabels(fs.readFileSync(file, 'utf8')) : null
  return mergeLabels(cat.labels, fallback)
}

/** 語料頁 + 演算法頁(與 renderer store 相同的組法) */
export function loadAllPagesFor (game: RegexGame, dir = defaultRegexDataDir()): RegexPage[] {
  const cat = loadRegexCatalogueFile(game, dir)
  return [...cat.pages, ...algoPages(game, loadLabelsFor(cat, dir))]
}

/**
 * 第 37 步:物品詞綴數值頁的資料(`data/<game>/{cmn-Hant,en}/stats.ndjson`)。renderer 自己 fetch 同兩個檔再呼叫同一個
 * `buildItemModData`(store.ts `ensureItemMods`);這裡給 CLI / 測試。
 * 多種寫法仲裁檔 `data/regex/item-mod-forms.json` 有就帶入(沒有 / 壞掉 = 不仲裁,舊行為)。
 */
export function loadItemModData (game: RegexGame, dir = defaultRegexDataDir()): ItemModData {
  const base = path.resolve(dir, '..', game)
  const read = (lang: string): StatLite[] => parseStatsNdjson(fs.readFileSync(path.join(base, lang, 'stats.ndjson'), 'utf8'))
  const formsFile = path.join(dir, 'item-mod-forms.json')
  const forms = fs.existsSync(formsFile) ? parseItemModForms(fs.readFileSync(formsFile, 'utf8'), game) : null
  return buildItemModData(game, read('cmn-Hant'), read('en'), forms)
}

export function loadTemplatesFile (dir = defaultRegexDataDir()): RegexTemplate[] {
  return parseTemplates(fs.readFileSync(path.join(dir, 'templates.json'), 'utf8')).templates
}
