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
  BUTTON_SUBTABS, SUBTAB_LABELS, activeSubtab, buttonRects, findSubtabButtons,
  defaultStripRegion, folderOffset, percentile, stripRect, type TextLine
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
const ZH_LABELS = ['一般', '聖甲蟲', '不滅之火', '異能']
const EN_LABELS = ['General', 'Scarab', 'Allflame', 'Eldritch']
const isButtonLine = (l: TextLine): boolean => ZH_LABELS.includes(l.text.replace(/\s+/g, ''))

describe('S6b 實機 2560×1440 截圖(使用者回報徽章沒出現)', () => {
  it('掃描條上緣不切到倉庫頁籤列(頁籤字下緣 170 / 1440)', () => {
    // 上緣切到頁籤字的一半 → Windows OCR 排版錯亂、四顆按鈕只讀到 0–1 顆(實機截圖重現)
    for (const h of [1080, 1432, 1440, 2160]) expect(stripRect(h).y, `h=${h}`).toBeGreaterThanOrEqual(Math.floor(170 / 1440 * h))
  })
  it('實機截圖(不在資料夾)找到按鈕、偏移 0', () => {
    const m = findSubtabButtons(clientLines('strip-general-1440.png'), 1440, 'zh')
    expect(m).toEqual({ found: true, matched: 3, yOffset: 0 })
  })
  it('實機截圖下移 47(資料夾內)找到按鈕、偏移 = folderOffset', () => {
    const m = findSubtabButtons(clientLines('strip-general-1440-folder.png'), 1440, 'zh')
    expect(m.found).toBe(true)
    expect(m.yOffset).toBe(folderOffset(1440))
  })
})

describe('S6c 實機英文介面(按鈕是小型大寫字)', () => {
  it('OCR 讀成全大寫(GENERAL / SCARAB…)仍算命中', () => {
    // 區分大小寫比對 'General' → 四顆全對不上、英文介面永遠不出現徽章(使用者實機回報)
    const m = findSubtabButtons(clientLines('strip-general-1440-en.png'), 1440, 'en')
    expect(m).toEqual({ found: true, matched: 4, yOffset: 0 })
  })
  it('英文截圖的目前子頁(一般)由像素判定', async () => {
    expect(activeSubtab(await buttonP99('strip-general-1440-en.png'))).toBe('general')
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
  it('聖甲蟲格子徽章(格下緣往上 28 px)不進掃描條', () => {
    // 掃描條太高 → 第一列徽章換格 / 價格載入都觸發重 OCR
    const layouts = parseStashLayouts(JSON.parse(fs.readFileSync(path.resolve(FIX_DIR, '../../../../../data/poe1/stash/layouts.json'), 'utf8')))
    const strip = stripRect(1440)
    const cells = cellRects(layouts, 'scarabs', 1440)
    expect(cells[0].y + cells[0].h - 28).toBeGreaterThanOrEqual(strip.y + strip.h)
    expect(Math.min(...cells.map(c => c.y + c.h)) - 28).toBeGreaterThanOrEqual(strip.y + strip.h)
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
  it('標籤與按鈕對應表', () => {
    // 順序錯 → 判定成別的子頁
    expect([...SUBTAB_LABELS.zh]).toEqual(ZH_LABELS)
    expect([...SUBTAB_LABELS.en]).toEqual(EN_LABELS)
    // 不滅之火 2026-10-14 使用者決定不做 → 第 3 顆與異能一樣不畫
    expect([...BUTTON_SUBTABS]).toEqual(['general', 'scarabs', null, null])
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

describe('S6 三顆以上按鈕才算碎片頁', () => {
  for (const name of STRIPS) {
    it(`${name} 命中至少三顆`, () => {
      // 空白沒去掉('一 般')或水平容差太嚴 → 失敗
      const r = findSubtabButtons(clientLines(name), H, 'zh')
      expect(r.matched).toBeGreaterThanOrEqual(3)
      expect(r.found).toBe(true)
    })
  }
  it('scarabs / allflame 四顆全命中', () => {
    // 同一顆多行處理錯、或某顆中心算錯 → 失敗
    expect(findSubtabButtons(clientLines('strip-scarabs-1432.png'), H, 'zh').matched).toBe(4)
    expect(findSubtabButtons(clientLines('strip-allflame-1432.png'), H, 'zh').matched).toBe(4)
  })
  for (const name of ['strip-tooltip-1432.png', 'neg-grid-1432.png']) {
    it(`${name} 找不到按鈕`, () => {
      // 部分比對(包含即算)或門檻太低 → 誤判
      const r = findSubtabButtons(clientLines(name), H, 'zh')
      expect(r.found).toBe(false)
      expect(r.yOffset).toBe(0)
    })
  }
  it('只保留任兩顆按鈕的行找不到', () => {
    // 門檻寫成 ≥ 2 → 失敗
    for (const name of STRIPS) {
      const all = clientLines(name)
      const btn = all.filter(isButtonLine)
      for (let i = 0; i < btn.length; i++) {
        for (let j = i + 1; j < btn.length; j++) {
          const lines = all.filter(l => !isButtonLine(l) || l === btn[i] || l === btn[j])
          const r = findSubtabButtons(lines, H, 'zh')
          expect(r.found, `${name} ${btn[i].text}+${btn[j].text}`).toBe(false)
          expect(r.yOffset).toBe(0)
        }
      }
    }
  })
  it('按鈕行整體右移 80/1440·h 找不到', () => {
    // 不檢查水平位置、或容差太寬 → 失敗
    const dx = 80 / 1440 * H
    for (const name of STRIPS) {
      const lines = clientLines(name).map(l => isButtonLine(l) ? { ...l, x: l.x + dx } : l)
      expect(findSubtabButtons(lines, H, 'zh').found, name).toBe(false)
    }
  })
  it('英文標籤用 en 找到', () => {
    // 英文標籤表錯、或 lang 沒用到 → 失敗
    for (const name of STRIPS) {
      const lines = clientLines(name).map(l => {
        const k = ZH_LABELS.indexOf(l.text.replace(/\s+/g, ''))
        return k >= 0 ? { ...l, text: EN_LABELS[k] } : l
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
      const k = ZH_LABELS.indexOf(l.text.replace(/\s+/g, ''))
      return k >= 0 ? { ...l, text: ['Gen eral', 'Sca rab', 'Al lflame', 'Eld ritch'][k] } : l
    })
    expect(findSubtabButtons(lines, H, 'en').found).toBe(true)
  })
  it('英文標籤有錯字不算', () => {
    // 模糊比對或包含即算 → 失敗
    const lines = clientLines('strip-allflame-1432.png').map(l => {
      const k = ZH_LABELS.indexOf(l.text.replace(/\s+/g, ''))
      return k >= 0 ? { ...l, text: ['Genera1', 'Scarabs', 'Alflame', 'Eldritch!'][k] } : l
    })
    expect(findSubtabButtons(lines, H, 'en').found).toBe(false)
  })
  it('繁中行用 en 找不到', () => {
    // 不分語言全部標籤都比 → 失敗
    for (const name of STRIPS) expect(findSubtabButtons(clientLines(name), H, 'en').found, name).toBe(false)
  })
})

async function buttonP99 (name: string): Promise<number[]> {
  const f = fixture(name)
  const { data, info } = await sharp(path.join(FIX_DIR, name)).greyscale().raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  return buttonRects(f.clientH, 0).map(r => {
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

describe('S7 子頁判定:一般 / 聖甲蟲各自正確,不滅之火不畫', () => {
  for (const name of STRIPS) {
    it(`${name} 由像素判定 = index.json 的子頁`, async () => {
      // 按鈕框錯位、p99 算錯、或 BUTTON_SUBTABS 對應錯 → 失敗
      const p = await buttonP99(name)
      expect(activeSubtab(p)).toBe(fixture(name).subtab)
    })
  }
  it('第 3 顆(不滅之火)最亮 → null', () => {
    // 把不滅之火對到某子頁 → 已移除的子頁又被畫出來
    expect(activeSubtab([140, 141, 160, 143])).toBeNull()
  })
  it('第 4 顆(異能)最亮 → null', () => {
    // 把異能對到某子頁 → 失敗
    expect(activeSubtab([140, 141, 143, 160])).toBeNull()
  })
  it('最亮與第二亮差距不足 8 → null', () => {
    // 不檢查差距直接取最大 → 失敗
    expect(activeSubtab([150, 150, 149, 140])).toBeNull()
    expect(activeSubtab([157, 150, 149, 140])).toBeNull()
  })
  it('差距恰好 8 → 判定該頁', () => {
    // 門檻寫成 > 8 → 失敗
    expect(activeSubtab([150, 158, 149, 140])).toBe('scarabs')
  })
  it('長度不是 4 → null', () => {
    // 沒檢查長度、對短陣列照常判定 → 失敗
    expect(activeSubtab([150, 160])).toBeNull()
    expect(activeSubtab([170, 150, 150, 150, 150])).toBeNull()
  })
})
