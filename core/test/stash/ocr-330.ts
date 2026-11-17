// 3.29 實機按鈕列 OCR 快照(core/test/stash/fixtures/ocr/)→ 3.30 按鈕位置。
// 3.30 碎片頁按鈕改成「一般 / 綢帶 / 異能」三顆、位置不同,沒有 3.30 的實機 OCR 快照 → 保留真實 OCR 行(雜訊、頁籤、拆字),
// 只把按鈕行水平搬到新槽(3.29 槽 116 + 168k、3.30 槽 202 + 166k)、不滅之火換成綢帶、聖甲蟲刪掉。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TextLine } from '../../src/stash/detect'

export const FIX_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ocr')

export interface FixtureEntry { file: string, clientH: number, cropX: number, cropY: number, subtab: string | null }
const INDEX = JSON.parse(fs.readFileSync(path.join(FIX_DIR, 'index.json'), 'utf8')) as { fixtures: FixtureEntry[] }

export function fixture (name: string): FixtureEntry {
  const f = INDEX.fixtures.find(x => x.file === name)
  if (!f) throw new Error(`找不到 fixture ${name}`)
  return f
}

/** 3.29 按鈕文字(去空白、大寫)→ [3.29 槽位, 3.30 槽位, 3.30 文字];null = 3.30 沒有這顆 */
const MOVE: Record<string, [number, number, string] | null> = {
  一般: [0, 0, '一般'], 聖甲蟲: null, 不滅之火: [2, 1, '綢帶'], 異能: [3, 2, '異能'],
  GENERAL: [0, 0, 'GENERAL'], SCARAB: null, ALLFLAME: [2, 1, 'THREADS'], ELDRITCH: [3, 2, 'ELDRITCH']
}

export function to330 (lines: TextLine[], h: number): TextLine[] {
  const out: TextLine[] = []
  for (const l of lines) {
    const m = MOVE[l.text.replace(/\s+/g, '').toUpperCase()]
    if (m === undefined) { out.push(l); continue }
    if (m === null) continue
    const [from, to, text] = m
    out.push({ ...l, text, x: l.x + ((202 + 166 * to) - (116 + 168 * from)) / 1440 * h })
  }
  return out
}

/** OCR 快照 → client 座標的行(按鈕已搬到 3.30 位置) */
export function clientLines (name: string): TextLine[] {
  const f = fixture(name)
  const snap = JSON.parse(fs.readFileSync(path.join(FIX_DIR, name.replace(/\.png$/, '.ocr.json')), 'utf8')) as { scale: number, lines: TextLine[] }
  const s = snap.scale
  return to330(snap.lines.map(l => ({ text: l.text, x: l.x / s + f.cropX, y: l.y / s + f.cropY, w: l.w / s, h: l.h / s })), f.clientH)
}
