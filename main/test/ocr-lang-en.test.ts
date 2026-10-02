// exile-appraiser(2026-10-02 第 22 步):英文客戶端 OCR 的 main 端 —— 語言包選擇、褻瀆 / 符文偵測器的英文版、換語言時掃描重置。
// 英文截圖的 OCR 快照(poe2/test/*/fixtures/ocr/*-en-*.ocr.json)當成「遊戲畫面」;假時鐘 / 假擷取,不啟動 Electron、不跑 OCR、不送任何按鍵。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RevealScanEvent, RuneshapeScanEvent } from '@ipc/types'
import { buildLocateIndex, type LocateIndex, type LocateTiersLike } from '../../poe2/src/desecration/ocr-locate'
import type { OcrTextLang } from '../../poe2/src/desecration/ocr-text'
import { loadLocateIndex } from '../src/ocr/locate-data'
import { DEFAULT_OCR_LANG, effectiveOcrLang, ocrLangFor, selftestOcrLang, textLangFor } from '../src/ocr/ocr-lang'
import { SharedLocateOcr, isRowText, type Fingerprint, type ScanCapture, type ScanClock } from '../src/ocr/panel-scan'
import { RevealScan, createRevealDetector } from '../src/ocr/reveal-scan'
import { RUNESHAPE_DETECTOR, RuneshapeScan, createRuneshapeDetector } from '../src/ocr/runeshape-scan'

const ROOT = path.resolve(__dirname, '../..')
const TIERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe2/desecration/tiers.json'), 'utf8')) as LocateTiersLike
const ZH: LocateIndex = buildLocateIndex(TIERS)
const EN: LocateIndex = buildLocateIndex(TIERS, 'en')

type Line = { text: string, x: number, y: number, w: number, h: number }
type Screen = { w: number, h: number, lines: Line[], lines1: Line[] }
function snapshot (dir: string, name: string): Screen {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe2/test', dir, 'fixtures/ocr', `${name}.ocr.json`), 'utf8')) as {
    srcW: number, srcH: number, scale: number, lines: Line[], locate: { scale: number, lines: Line[] }
  }
  const conv = (ls: Line[], k: number) => ls.map(l => ({ text: l.text, x: l.x / k, y: l.y / k, w: l.w / k, h: l.h / k }))
  return { w: s.srcW, h: s.srcH, lines: conv(s.lines, s.scale), lines1: conv(s.locate.lines, s.locate.scale) }
}
const WELL_EN = snapshot('desecration', 'well-of-souls-weapon-en-04')
const WELL_ZH = snapshot('desecration', 'well-of-souls-fullscreen-02')
const RUNES_EN = snapshot('runeshape', 'runeshape-runes-en-03')
const CURRENCY_EN = snapshot('runeshape', 'runeshape-currency-en-05')
const inside = (l: Line, r: { x: number, y: number, width: number, height: number }) =>
  l.x >= r.x && l.y >= r.y && l.x + l.w <= r.x + r.width && l.y + l.h <= r.y + r.height

function fakeClock () {
  let t = 0
  let id = 0
  const timers = new Map<number, { at: number, fn: () => void }>()
  const clock: ScanClock = {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id },
    clearTimeout: (h) => { timers.delete(h as number) }
  }
  async function advance (ms: number) {
    const end = t + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      t = next[1].at
      next[1].fn()
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }
    t = end
  }
  return { clock, advance }
}

/** 假擷取:畫面 = 某張快照;×1 回 locate 快照、其他倍率回 ×3 快照(落在範圍內的行) */
function capture (state: { screen: Screen, version: number }) {
  return async (): Promise<ScanCapture> => ({
    size: { w: state.screen.w, h: state.screen.h },
    offset: { x: 0, y: 0 },
    client: { w: state.screen.w, h: state.screen.h },
    fingerprint: (): Fingerprint => ({ w: 64, h: 40, data: new Uint8Array(64 * 40).fill(state.version * 40) }),
    recognize: async (rect, scale) => {
      const src = scale === 1 ? state.screen.lines1 : state.screen.lines
      return { lines: src.filter(l => inside(l, rect)).map(l => ({ ...l })), ms: 30 }
    }
  })
}

describe('語言包選擇(ocr-lang.ts)', () => {
  it('客戶端語言 en → en-US;cmn-Hant / 沒有設定 → zh-Hant-TW(改版前固定的那個)', () => {
    expect(ocrLangFor({ language: 'en' })).toBe('en-US')
    expect(ocrLangFor({ language: 'cmn-Hant' })).toBe('zh-Hant-TW')
    expect(ocrLangFor(null)).toBe(DEFAULT_OCR_LANG)
    expect(DEFAULT_OCR_LANG).toBe('zh-Hant-TW')
    expect(textLangFor('en-US')).toBe('en')
    expect(textLangFor('zh-Hant-TW')).toBe('zh')
  })
  it('第 25 步:ocrLang 手動指定優先於客戶端語言;follow / 缺欄位 / 壞值 = 跟隨客戶端語言', () => {
    // 介面語言與此無關(不在輸入裡):介面繁中、客戶端繁中、辨識 English → en-US
    expect(ocrLangFor({ language: 'cmn-Hant', ocrLang: 'en' })).toBe('en-US')
    expect(ocrLangFor({ language: 'en', ocrLang: 'cmn-Hant' })).toBe('zh-Hant-TW')
    expect(ocrLangFor({ language: 'en', ocrLang: 'en' })).toBe('en-US')
    expect(ocrLangFor({ language: 'cmn-Hant', ocrLang: 'cmn-Hant' })).toBe('zh-Hant-TW')
    expect(ocrLangFor({ language: 'en', ocrLang: 'follow' })).toBe('en-US')
    expect(ocrLangFor({ language: 'cmn-Hant', ocrLang: 'follow' })).toBe('zh-Hant-TW')
    expect(ocrLangFor({ language: 'en' })).toBe('en-US') // 舊 renderer 沒有這欄
    expect(ocrLangFor({ language: 'en', ocrLang: 'klingon' as never })).toBe('en-US')
    expect(effectiveOcrLang({ language: 'cmn-Hant', ocrLang: 'en' })).toBe('en')
    expect(effectiveOcrLang({ language: 'en', ocrLang: 'follow' })).toBe('en')
    expect(effectiveOcrLang(null)).toBe('cmn-Hant')
    expect(textLangFor(ocrLangFor({ language: 'cmn-Hant', ocrLang: 'en' }))).toBe('en')
  })
  it('selftest:`--ocr-lang=` 優先,否則依檔名(`-en-` / `-en.`)', () => {
    expect(selftestOcrLang('C:/x/well-of-souls-weapon-en-04.png', [])).toBe('en-US')
    expect(selftestOcrLang('C:\\x\\runeshape-gems-en-06.png', [])).toBe('en-US')
    expect(selftestOcrLang('C:/x/runeshape-skills-01.png', [])).toBe('zh-Hant-TW')
    expect(selftestOcrLang('C:/x/screen.png', ['--ocr-lang=en-US'])).toBe('en-US')
    expect(selftestOcrLang('C:/x/a-en-1.png', ['--ocr-lang=zh-Hant-TW'])).toBe('zh-Hant-TW')
  })
  it('isRowText:英文 = 兩個連續拉丁字母;繁中不變', () => {
    expect(isRowText('lx Divine Orb', 'en')).toBe(true)
    expect(isRowText('25%', 'en')).toBe(false)
    expect(isRowText('lx Divine Orb')).toBe(false)
    expect(isRowText('1x 神聖石')).toBe(true)
  })
  it('loadLocateIndex:兩種語言各一份索引(英文 669、繁中 706),檔案只讀一次', async () => {
    const logs: string[] = []
    const [zh, en] = await Promise.all([loadLocateIndex(ROOT, (m) => { logs.push(m) }), loadLocateIndex(ROOT, (m) => { logs.push(m) }, 'en')])
    expect(zh!.list.length).toBe(706)
    expect(en!.list.length).toBe(669)
    expect(en!.lang).toBe('en')
    expect(await loadLocateIndex(ROOT, () => {}, 'en')).toBe(en)
    expect(logs.filter(l => l.includes('面板定位模板'))).toHaveLength(2)
  })
})

describe('褻瀆偵測器:英文', () => {
  it('textLang = en → 讀英文索引;英文截圖:定位 + 判定(3 組、4 行像詞綴)', async () => {
    const asked: OcrTextLang[] = []
    const det = createRevealDetector(async (lang) => { asked.push(lang); return lang === 'en' ? EN : ZH }, () => 'en')
    expect(await det.ready!()).toBe(true)
    expect(asked).toEqual(['en'])
    const loc = det.locate(WELL_EN.lines1, { x: 0, y: 0, w: WELL_EN.w, h: WELL_EN.h })!
    expect(loc.count).toBe(4)
    const c = det.classify(WELL_EN.lines)
    expect(c.found).toBe(true)
    expect(c.hits).toBe(4)
    expect(c.rows).toHaveLength(WELL_EN.lines.length)
  })
  it('語言不符就找不到:繁中偵測器看英文畫面、英文偵測器看繁中畫面', async () => {
    const zh = createRevealDetector(async () => ZH)
    await zh.ready!()
    expect(zh.classify(WELL_EN.lines).found).toBe(false)
    const en = createRevealDetector(async (l) => (l === 'en' ? EN : ZH), () => 'en')
    await en.ready!()
    expect(en.classify(WELL_ZH.lines).found).toBe(false)
  })
  it('換語言:下一次 ready() 才讀新語言的索引,讀好之前 locate / classify 當成沒有面板', async () => {
    let lang: OcrTextLang = 'zh'
    const asked: OcrTextLang[] = []
    const det = createRevealDetector(async (l) => { asked.push(l); return l === 'en' ? EN : ZH }, () => lang)
    await det.ready!()
    lang = 'en'
    expect(det.classify(WELL_EN.lines).found).toBe(false)
    await det.ready!()
    expect(det.classify(WELL_EN.lines).found).toBe(true)
    await det.ready!()
    expect(asked).toEqual(['zh', 'en'])
  })
  it('RevealScan(假時鐘):英文畫面沒框區域 → 整張 ×1 定位 → 定位框 ×3 → 送出列', async () => {
    const clk = fakeClock()
    const state = { screen: WELL_EN, version: 0 }
    const events: RevealScanEvent[] = []
    const scan = new RevealScan({
      clock: clk.clock,
      config: () => ({ enabled: true, game: 'poe2', region: null, intervalMs: 1000 }),
      env: () => ({ overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: WELL_EN.w, height: WELL_EN.h } }),
      ocrBusy: () => false,
      locateIndex: async (l) => (l === 'en' ? EN : ZH),
      textLang: () => 'en',
      capture: capture(state),
      send: (e) => { events.push(e) },
      log: () => {}
    })
    scan.start(0)
    await clk.advance(10)
    scan.stop()
    const rows = events.find(e => e.reason === 'rows')!
    expect(rows.rows.map(r => r.text)).toEqual([
      'ATTACKS WITH THIS WEAPON PENETRATE 25% FIRE', 'RESISTANCE', 'ADDS 28 TO 45 COLD DAMAGE', 'ADDS 23 TO 54 PHYSICAL DAMAGE'
    ])
  })
})

describe('符文塑形偵測器:英文', () => {
  it('createRuneshapeDetector(en):英文面板列、送出的列只要有英文字;繁中偵測器看英文畫面 = 沒有面板', () => {
    const det = createRuneshapeDetector(() => 'en')
    const c = det.classify(CURRENCY_EN.lines)
    expect(c.found).toBe(true)
    expect(c.hits).toBe(10)
    expect(c.rows).toHaveLength(12)
    expect(RUNESHAPE_DETECTOR.classify(CURRENCY_EN.lines).found).toBe(false)
    expect(det.verticalRetry!(CURRENCY_EN.lines)).toBe(false)
    const loc = det.locate(RUNES_EN.lines1, { x: 0, y: 0, w: RUNES_EN.w, h: RUNES_EN.h })!
    expect(loc.count).toBe(11)
  })
  it('繁中(預設 / textLang zh)= 改版前的偵測器行為', () => {
    const det = createRuneshapeDetector()
    const zhRows = [{ text: '1x 神聖石', x: 400, y: 10, w: 100, h: 20 }, { text: '2x 混沌石', x: 400, y: 60, w: 100, h: 20 }]
    expect(det.classify(zhRows)).toEqual(RUNESHAPE_DETECTOR.classify(zhRows))
    expect(det.activity).toBe(RUNESHAPE_DETECTOR.activity)
    expect(det.pauseOnPricePanel).toBe(true)
  })
  it('PanelScan.ocrLangChanged():丟掉自動定位快取 / 基準,下一個 tick 用新語言重新定位', async () => {
    const clk = fakeClock()
    let lang: OcrTextLang = 'en'
    const state = { screen: RUNES_EN, version: 0 }
    const events: RuneshapeScanEvent[] = []
    const logs: string[] = []
    const scan = new RuneshapeScan({
      clock: clk.clock,
      config: () => ({ enabled: true, game: 'poe2', region: null, intervalMs: 1000 }),
      env: () => ({ overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: RUNES_EN.w, height: RUNES_EN.h } }),
      ocrBusy: () => false,
      capture: capture(state),
      textLang: () => lang,
      send: (e) => { events.push(e) },
      log: (m) => { logs.push(m) }
    })
    const r1 = await scan.tick()
    expect(r1.kind).toBe('ocr')
    expect(scan.autoRegion).not.toBeNull()
    expect(events.filter(e => e.reason === 'rows').at(-1)!.rows).toHaveLength(11)
    // 客戶端語言改成繁中(畫面還是英文)→ 快取作廢;繁中偵測器在英文畫面上找不到面板
    lang = 'zh'
    scan.ocrLangChanged()
    expect(scan.autoRegion).toBeNull()
    expect(logs.some(l => l.includes('OCR 語言改變'))).toBe(true)
    await clk.advance(5000)
    const r2 = await scan.tick()
    expect(r2.kind).toBe('locate-miss')
    expect(scan.autoRegion).toBeNull()
  })
  it('SharedLocateOcr.clear():換語言後不再共用舊語言的整張 ×1 結果', async () => {
    const shared = new SharedLocateOcr()
    const state = { screen: RUNES_EN, version: 0 }
    const cap = await capture(state)()
    await shared.recognize(cap, 0)
    await shared.recognize(cap, 10)
    expect([shared.runs, shared.reuses]).toEqual([1, 1])
    shared.clear()
    await shared.recognize(cap, 20)
    expect(shared.runs).toBe(2)
  })
})
