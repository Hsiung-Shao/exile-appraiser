/**
 * 倉庫碎片頁按鈕列偵測:OCR 找子頁按鈕、資料夾偏移、目前子頁(灰階 p99)。
 * 基準:core/test/stash/fixtures/ocr/(使用者錄影裁圖,client 高 1432)+ 真實 Windows OCR 快照。
 * 不讀 core/src/stash/detect.ts 實作。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  SUBTAB_LABELS, activeSubtab, buttonRects, compareSlots, findSubtabButtons,
  defaultStripRegion, folderOffset, percentile, stripRect, stripZone, type ButtonMatch, type TextLine
} from '../src/stash/detect'
import { cellRects, parseStashLayouts, type StashSubtab } from '../src/stash/layout'

const FIX_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'stash/fixtures/ocr')

interface FixtureEntry { file: string, clientH: number, cropX: number, cropY: number, subtab: StashSubtab | null }
interface OcrSnap { scale: number, lines: Array<{ text: string, x: number, y: number, w: number, h: number }> }

const INDEX = JSON.parse(fs.readFileSync(path.join(FIX_DIR, 'index.json'), 'utf8')) as { fixtures: FixtureEntry[] }
const H = 1432

function fixture (name: string): FixtureEntry {
  const f = INDEX.fixtures.find(x => x.file === name)
  if (!f) throw new Error(`找不到 fixture ${name}`)
  return f
}

/** OCR 快照 → client 座標的行 */
function clientLines (name: string): TextLine[] {
  const f = fixture(name)
  const snap = JSON.parse(fs.readFileSync(path.join(FIX_DIR, name.replace(/\.png$/, '.ocr.json')), 'utf8')) as OcrSnap
  const s = snap.scale
  return snap.lines.map(l => ({ text: l.text, x: l.x / s + f.cropX, y: l.y / s + f.cropY, w: l.w / s, h: l.h / s }))
}

const STRIPS = ['strip-scarabs-1432.png', 'strip-general-1432.png', 'strip-allflame-1432.png'] as const
/** 偵測用的三個標籤(聖甲蟲 2026-11-07 起不比對) */
const ZH_LABELS = ['一般', '不滅之火', '異能']
const EN_LABELS = ['General', 'Allflame', 'Eldritch']
/** 3.29 實機畫面上的四顆按鈕文字(含聖甲蟲;換成英文 / 錯字用) */
const ZH_ALL = ['一般', '聖甲蟲', '不滅之火', '異能']
const EN_ALL = ['General', 'Scarab', 'Allflame', 'Eldritch']
const isButtonLine = (l: TextLine): boolean => ZH_LABELS.includes(l.text.replace(/\s+/g, ''))
const dx = (slots: number): number => slots * 168 / 1440 * H

describe('S6b 實機 2560×1440 截圖(使用者回報徽章沒出現)', () => {
  it('掃描條上緣不切到倉庫頁籤列(頁籤字下緣 170 / 1440)', () => {
    // 上緣切到頁籤字的一半 → Windows OCR 排版錯亂、四顆按鈕只讀到 0–1 顆(實機截圖重現)
    for (const h of [1080, 1432, 1440, 2160]) expect(stripRect(h).y, `h=${h}`).toBeGreaterThanOrEqual(Math.floor(170 / 1440 * h))
  })
  it('實機截圖(不在資料夾)找到按鈕、偏移 0', () => {
    const m = findSubtabButtons(clientLines('strip-general-1440.png'), 1440, 'zh')
    // 一般(目前子頁)漏讀,不滅之火 / 異能 在 2、3 號槽
    expect(m).toEqual({ found: true, matched: 2, yOffset: 0, slots: [2, 3] })
  })
  it('實機截圖下移 47(資料夾內)找到按鈕、偏移 = folderOffset', () => {
    const m = findSubtabButtons(clientLines('strip-general-1440-folder.png'), 1440, 'zh')
    expect(m.found).toBe(true)
    expect(m.yOffset).toBe(folderOffset(1440))
  })
})

describe('S6c 實機英文介面(按鈕是小型大寫字)', () => {
  it('OCR 讀成全大寫(GENERAL / ALLFLAME…)仍算命中', () => {
    // 區分大小寫比對 'General' → 全對不上、英文介面永遠不出現徽章(使用者實機回報)
    const m = findSubtabButtons(clientLines('strip-general-1440-en.png'), 1440, 'en')
    expect(m).toEqual({ found: true, matched: 3, yOffset: 0, slots: [0, 2, 3] })
  })
  it('英文截圖的目前子頁(一般)由像素判定', async () => {
    expect(activeSubtab(await buttonP99('strip-general-1440-en.png', 'en'))).toBe('general')
  })
})

describe('S18d 預設區域(client 比例)', () => {
  it('defaultStripRegion = stripRect 換成 client 比例', () => {
    // 比例算錯 → 框選層顯示的「目前區域」和實際 OCR 的位置不一致
    for (const [w, h] of [[2560, 1440], [1920, 1080], [2012, 1432]]) {
      const r = defaultStripRegion(w, h)
      const s = stripRect(h)
      expect(r.x * w).toBeCloseTo(s.x, 6)
      expect(r.y * h).toBeCloseTo(s.y, 6)
      expect(r.w * w).toBeCloseTo(s.w, 6)
      expect(r.h * h).toBeCloseTo(s.h, 6)
    }
  })
})

describe('S7b 幾何輔助函式', () => {
  it('stripRect(1440) 為按鈕列掃描條', () => {
    // 比例或 w = h·37/60 公式錯 → 失敗
    expect(stripRect(1440)).toEqual({ x: 0, y: 170, w: 888, h: 98 })
  })
  it('stripRect(1432) 各欄取 floor', () => {
    // 忘了 floor 或 h 不是「底 − y」→ 失敗
    const y = Math.floor(170 / 1440 * 1432)
    expect(stripRect(1432)).toEqual({ x: 0, y, w: Math.floor(1432 * 37 / 60), h: Math.floor(268 / 1440 * 1432) - y })
  })
  it('一般頁格子徽章(格下緣往上 28 px)不進掃描條', () => {
    // 掃描條太高 → 第一列徽章換格 / 價格載入都觸發重 OCR
    const layouts = parseStashLayouts(JSON.parse(fs.readFileSync(path.resolve(FIX_DIR, '../../../../../data/poe1/stash/layouts.json'), 'utf8')))
    const strip = stripRect(1440)
    const cells = cellRects(layouts, 'general', 1440)
    expect(Math.min(...cells.map(c => c.y + c.h)) - 28).toBeGreaterThanOrEqual(strip.y + strip.h)
  })
  it('stripZone(1440) = 按鈕可能出現的範圍(y 120–268,不加資料夾偏移)', () => {
    // 上限算錯 → 自訂區域被夾掉按鈕或夾不住整張畫面
    expect(stripZone(2560, 1440)).toEqual({ x: 0, y: 120, w: 888, h: 268 - 120 })
    const h = 1432
    const y = Math.floor(120 / 1440 * h)
    expect(stripZone(2546, h)).toEqual({ x: 0, y, w: Math.floor(h * 37 / 60), h: Math.floor(268 / 1440 * h) - y })
  })
  it('stripZone 涵蓋預設掃描條與資料夾內的按鈕', () => {
    const z = stripZone(2560, 1440)
    const s = stripRect(1440)
    expect(s.y).toBeGreaterThanOrEqual(z.y)
    expect(s.y + s.h).toBeLessThanOrEqual(z.y + z.h)
    for (const h of [1080, 1432, 1440, 2160]) {
      const zz = stripZone(2560, h)
      // 下緣太矮 → 資料夾內的按鈕文字被切掉
      expect(Math.floor(201 / 1440 * h) + folderOffset(h) + 12, `h=${h}`).toBeLessThanOrEqual(zz.y + zz.h)
    }
  })
  it('stripZone 下緣 ≤ 一般頁第一列格子下緣 − 28(徽章不進自訂區域)', () => {
    // 下緣加了資料夾偏移 → 夾完仍截到第一列徽章,換格 / 價格載入就重 OCR
    const layouts = parseStashLayouts(JSON.parse(fs.readFileSync(path.resolve(FIX_DIR, '../../../../../data/poe1/stash/layouts.json'), 'utf8')))
    for (const h of [1080, 1432, 1440, 2160]) {
      const z = stripZone(2560, h)
      const cells = cellRects(layouts, 'general', h)
      expect(z.y + z.h, `h=${h}`).toBeLessThanOrEqual(Math.min(...cells.map(c => c.y + c.h)) - Math.floor(28 / 1440 * h))
    }
  })
  it('stripZone 寬度不超過 client 寬', () => {
    expect(stripZone(500, 1440).w).toBe(500)
  })
  it('資料夾內按鈕文字仍在掃描條內', () => {
    // 掃描條太矮 → 資料夾內的按鈕被切掉
    const strip = stripRect(1440)
    const textBottom = 201 + folderOffset(1440) + 12
    expect(textBottom).toBeLessThanOrEqual(strip.y + strip.h)
    expect(buttonRects(1440, 0)[0].y).toBeGreaterThanOrEqual(strip.y)
  })
  it('buttonRects(1440,0) 第 2 顆為 284,186,152,36', () => {
    // 按鈕間距 168 或起點 116 錯 → 失敗
    expect(buttonRects(1440, 0)[1]).toEqual({ x: 284, y: 186, w: 152, h: 36 })
  })
  it('buttonRects 四顆依序排列且 yOffset 只加在 y', () => {
    // 漏加 yOffset、或 yOffset 誤加到 x / h → 失敗
    const a = buttonRects(1440, 0)
    const b = buttonRects(1440, 47)
    expect(a).toHaveLength(4)
    expect(a.map(r => r.x)).toEqual([116, 284, 452, 620])
    for (let k = 0; k < 4; k++) expect(b[k]).toEqual({ ...a[k], y: a[k].y + 47 })
    expect(buttonRects(1440)).toEqual(a)
  })
  it('folderOffset(1440) = 47、1432 取 floor', () => {
    // 比例錯或用 round → 失敗
    expect(folderOffset(1440)).toBe(47)
    expect(folderOffset(1432)).toBe(Math.floor(47 / 1440 * 1432))
  })
  it('percentile 取排序後 floor(q·(n−1)) 位置、空陣列回 0', () => {
    // 未排序、用 round / ceil、空陣列丟例外 → 失敗
    const g = new Uint8Array([50, 10, 40, 20, 30])
    expect(percentile(g, 0)).toBe(10)
    expect(percentile(g, 1)).toBe(50)
    expect(percentile(g, 0.5)).toBe(30)
    expect(percentile(g, 0.99)).toBe(40) // floor(0.99·4) = 3
    expect(percentile(new Uint8Array(0), 0.99)).toBe(0)
  })
  it('偵測標籤不含聖甲蟲、順序左到右', () => {
    // 順序錯 → 遞增檢查判錯;還比對聖甲蟲 → 3.30 沒有這顆時白白少一顆
    expect([...SUBTAB_LABELS.zh]).toEqual(ZH_LABELS)
    expect([...SUBTAB_LABELS.en]).toEqual(EN_LABELS)
  })
})

describe('S5 資料夾偏移由按鈕 y 推得', () => {
  for (const name of STRIPS) {
    it(`${name} 原樣找到按鈕且 yOffset 0`, () => {
      // 中位數 / 201 基準錯、吸附容差太小 → 失敗
      const r = findSubtabButtons(clientLines(name), H, 'zh')
      expect(r.found).toBe(true)
      expect(r.yOffset).toBe(0)
    })
    it(`${name} 下移 folderOffset 時 yOffset = folderOffset`, () => {
      // 沒吸附到資料夾偏移、或回傳原始差值 → 失敗
      const off = folderOffset(H)
      const lines = clientLines(name).map(l => ({ ...l, y: l.y + off }))
      const r = findSubtabButtons(lines, H, 'zh')
      expect(r.found).toBe(true)
      expect(r.yOffset).toBe(off)
    })
    it(`${name} 下移 25 px(不在吸附點附近)找不到`, () => {
      // 不檢查吸附誤差、任何偏移都接受 → 失敗
      const lines = clientLines(name).map(l => ({ ...l, y: l.y + 25 }))
      expect(findSubtabButtons(lines, H, 'zh').found).toBe(false)
    })
  }
})

describe('S6 至少兩顆按鈕、落在按鈕槽且順序左到右才算碎片頁', () => {
  for (const name of STRIPS) {
    it(`${name} 命中至少兩顆`, () => {
      // 空白沒去掉('一 般')或水平容差太嚴 → 失敗
      const r = findSubtabButtons(clientLines(name), H, 'zh')
      expect(r.matched).toBeGreaterThanOrEqual(2)
      expect(r.found).toBe(true)
    })
  }
  it('3.29 聖甲蟲 / 不滅之火子頁三顆偵測標籤全命中,槽位 0 / 2 / 3', () => {
    // 同一顆多行處理錯、或槽位中心算錯 → 失敗
    for (const name of ['strip-scarabs-1432.png', 'strip-allflame-1432.png']) {
      const r = findSubtabButtons(clientLines(name), H, 'zh')
      expect(r, name).toEqual({ found: true, matched: 3, yOffset: 0, slots: [0, 2, 3] })
    }
  })
  it('3.30 拿掉聖甲蟲、其他按鈕左移一槽也認得', () => {
    // 還用固定槽位對標籤 → 左移後一顆都對不上
    const lines = clientLines('strip-scarabs-1432.png')
      .filter(l => l.text.replace(/\s+/g, '') !== '聖甲蟲')
      .map(l => ['不滅之火', '異能'].includes(l.text.replace(/\s+/g, '')) ? { ...l, x: l.x - dx(1) } : l)
    expect(findSubtabButtons(lines, H, 'zh')).toEqual({ found: true, matched: 3, yOffset: 0, slots: [0, 1, 2] })
  })
  it('只保留任兩顆偵測標籤也找得到', () => {
    // 門檻寫成 ≥ 3 → 一般(目前子頁)漏讀再漏一顆就失效
    for (const name of STRIPS) {
      const all = clientLines(name)
      const btn = all.filter(isButtonLine)
      for (let i = 0; i < btn.length; i++) {
        for (let j = i + 1; j < btn.length; j++) {
          const lines = all.filter(l => !isButtonLine(l) || l === btn[i] || l === btn[j])
          expect(findSubtabButtons(lines, H, 'zh').found, `${name} ${btn[i].text}+${btn[j].text}`).toBe(true)
        }
      }
    }
  })
  it('只剩一顆偵測標籤找不到', () => {
    // 門檻寫成 ≥ 1 → 畫面上偶然出現「一般」就誤判
    for (const name of STRIPS) {
      const all = clientLines(name)
      for (const b of all.filter(isButtonLine)) {
        const r = findSubtabButtons(all.filter(l => !isButtonLine(l) || l === b), H, 'zh')
        expect(r.found, `${name} ${b.text}`).toBe(false)
        expect(r.yOffset).toBe(0)
        expect(r.slots).toEqual([])
      }
    }
  })
  it('順序顛倒(異能在不滅之火左邊)找不到', () => {
    // 不檢查左到右遞增 → 誤判
    const lines = clientLines('strip-allflame-1432.png').map(l => {
      const t = l.text.replace(/\s+/g, '')
      if (t === '不滅之火') return { ...l, x: l.x + dx(1) }
      if (t === '異能') return { ...l, x: l.x - dx(1) }
      return t === '一般' ? { ...l, text: '' } : l
    })
    expect(findSubtabButtons(lines, H, 'zh').found).toBe(false)
  })
  it('「一般」不在最左那槽找不到,但 matched 照實回報(診斷 log 才印得出 OCR 文字)', () => {
    // 一般可落任何槽 → 子頁亮度比錯槽;matched 回 0 → stash-scan 的「沒找到子頁按鈕」log 被吞掉
    const lines = clientLines('strip-allflame-1432.png').map(l => l.text.replace(/\s+/g, '') === '一般' ? { ...l, x: l.x + dx(1) } : l)
    expect(findSubtabButtons(lines, H, 'zh')).toEqual({ found: false, matched: 3, yOffset: 0, slots: [] })
  })
  for (const name of ['strip-tooltip-1432.png', 'neg-grid-1432.png']) {
    it(`${name} 找不到按鈕`, () => {
      // 部分比對(包含即算)或門檻太低 → 誤判
      const r = findSubtabButtons(clientLines(name), H, 'zh')
      expect(r.found).toBe(false)
      expect(r.yOffset).toBe(0)
    })
  }
  it('按鈕行整體右移 80/1440·h 找不到', () => {
    // 不檢查水平位置、或容差太寬 → 失敗
    const d = 80 / 1440 * H
    for (const name of STRIPS) {
      const lines = clientLines(name).map(l => isButtonLine(l) ? { ...l, x: l.x + d } : l)
      expect(findSubtabButtons(lines, H, 'zh').found, name).toBe(false)
    }
  })
  it('英文標籤用 en 找到', () => {
    // 英文標籤表錯、或 lang 沒用到 → 失敗
    for (const name of STRIPS) {
      const lines = clientLines(name).map(l => {
        const k = ZH_ALL.indexOf(l.text.replace(/\s+/g, ''))
        return k >= 0 ? { ...l, text: EN_ALL[k] } : l
      })
      const r = findSubtabButtons(lines, H, 'en')
      expect(r.found, name).toBe(true)
      expect(r.yOffset).toBe(0)
      // 同一份英文行用 zh 找不到
      expect(findSubtabButtons(lines, H, 'zh').found, name).toBe(false)
    }
  })
  it('英文標籤去空白後比對(OCR 拆字的 "Al lflame")', () => {
    // 規格:行文字去掉所有空白後 === label;沒去空白 → 失敗
    const lines = clientLines('strip-allflame-1432.png').map(l => {
      const k = ZH_ALL.indexOf(l.text.replace(/\s+/g, ''))
      return k >= 0 ? { ...l, text: ['Gen eral', 'Sca rab', 'Al lflame', 'Eld ritch'][k] } : l
    })
    expect(findSubtabButtons(lines, H, 'en').found).toBe(true)
  })
  it('英文標籤有錯字不算', () => {
    // 模糊比對或包含即算 → 失敗
    const lines = clientLines('strip-allflame-1432.png').map(l => {
      const k = ZH_ALL.indexOf(l.text.replace(/\s+/g, ''))
      return k >= 0 ? { ...l, text: ['Genera1', 'Scarab', 'Alflame', 'Eldritch!'][k] } : l
    })
    expect(findSubtabButtons(lines, H, 'en').found).toBe(false)
  })
  it('繁中行用 en 找不到', () => {
    // 不分語言全部標籤都比 → 失敗
    for (const name of STRIPS) expect(findSubtabButtons(clientLines(name), H, 'en').found, name).toBe(false)
  })
})

/** 依 `compareSlots` 取按鈕槽的 p99(與 main stash-scan 同一條路) */
async function buttonP99 (name: string, lang: 'zh' | 'en' = 'zh'): Promise<number[]> {
  const f = fixture(name)
  const match: ButtonMatch = findSubtabButtons(clientLines(name), f.clientH, lang)
  expect(match.found, name).toBe(true)
  const { data, info } = await sharp(path.join(FIX_DIR, name)).greyscale().raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const rects = buttonRects(f.clientH, 0)
  return compareSlots(match).map(k => {
    const r = rects[k]
    const x0 = r.x - f.cropX
    const y0 = r.y - f.cropY
    const px = new Uint8Array(r.w * r.h)
    let n = 0
    for (let y = y0; y < y0 + r.h; y++) {
      for (let x = x0; x < x0 + r.w; x++) px[n++] = data[(y * info.width + x) * ch]
    }
    return percentile(px, 0.99)
  })
}

describe('S7 子頁判定:只有一般畫,3.29 聖甲蟲 / 不滅之火不畫', () => {
  for (const name of STRIPS) {
    it(`${name} 由像素判定 = index.json 的子頁`, async () => {
      // 按鈕框錯位、p99 算錯、或比到錯的槽 → 失敗
      expect(activeSubtab(await buttonP99(name))).toBe(fixture(name).subtab)
    })
  }
  it('compareSlots:一般那槽在前,其他只取有認到文字的槽', () => {
    // 把 3.30 空著的槽也拿來比 → 空槽太亮時一般頁不畫
    expect(compareSlots({ found: true, matched: 3, yOffset: 0, slots: [0, 1, 2] })).toEqual([0, 1, 2])
    expect(compareSlots({ found: true, matched: 2, yOffset: 0, slots: [2, 3] })).toEqual([0, 2, 3])
  })
  it('其他有文字的槽比一般亮 → null', () => {
    // 不比其他槽、一般一律畫 → 聖甲蟲 / 不滅之火子頁也畫
    expect(activeSubtab([140, 160, 143])).toBeNull()
    expect(activeSubtab([140, 141, 160])).toBeNull()
  })
  it('一般最亮但差距不足 8 → null', () => {
    // 不檢查差距 → 失敗
    expect(activeSubtab([150, 150, 149])).toBeNull()
    expect(activeSubtab([157, 150, 149])).toBeNull()
  })
  it('一般比其他每一顆亮恰好 8 → general', () => {
    // 門檻寫成 > 8 → 失敗
    expect(activeSubtab([158, 150, 149])).toBe('general')
  })
  it('沒有可比的槽(長度 < 2)→ null', () => {
    // 只有一般那槽也判 general → 無從比較就畫
    expect(activeSubtab([170])).toBeNull()
    expect(activeSubtab([])).toBeNull()
  })
})
