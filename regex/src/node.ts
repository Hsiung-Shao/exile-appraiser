// Node 專用:從磁碟讀 `data/regex/regex_poe{1,2}.json`。renderer 不要 import 這支(用 `parseRegexCatalogue` 自己餵字串)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRegexCatalogue, type RegexCatalogue, type RegexGame, type RegexPage } from './data'

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
