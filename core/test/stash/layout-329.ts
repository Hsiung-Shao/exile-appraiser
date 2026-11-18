// 3.29 一般頁版面(凍結,`layout-3.29.json` = 3.30 改版前的 data/poe1/stash/layouts.json):
// 3.29 拍的截圖 / 錄影 / 原生擷取 fixture 只能用當時的格子位置驗。綢帶頁是 3.30 才有 → 借目前資料補上,只為通過 parseStashLayouts。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStashLayouts, type StashLayoutFile } from '../../src/stash/layout'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (p: string): any => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))

export function layout329 (): StashLayoutFile {
  const old = read('core/test/stash/fixtures/layout-3.29.json')
  const cur = read('data/poe1/stash/layouts.json')
  return parseStashLayouts({
    ...old,
    buttons: { ...old.buttons, threads: cur.buttons.threads },
    subtabs: { ...old.subtabs, threads: cur.subtabs.threads }
  })
}
