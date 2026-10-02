/**
 * exile-appraiser(WP-R2):`electron main/dist/main.js --runeshape-selftest <png> [--runeshape-selftest-region=x,y,w,h] [--ocr-lang=en-US|zh-Hant-TW]`
 * (第 22 步:`--ocr-lang` 省略 = 依檔名,`-en-` / `-en.` → 英文客戶端:`en-US` 語言包、`data/poe2/en/items.ndjson` + 配方英文泛稱、英文列格式;
 * 其他 → 繁中,輸出與改版前相同)
 * 不開任何視窗、不註冊熱鍵:把 PNG 當成遊戲 client 區,用 runtime 同一個 `RuneshapeScan`(直接呼叫 `tick()`)跑兩條路:
 *   A. 自動定位(沒框區域):① 第一次 → 整張 ×1 定位 + 定位框 ×3 ② 同一張 → 畫面沒變跳過 ③ 定位框中央塗白 → 快取區 ×3
 *   B. 手動區域(`--runeshape-selftest-region`,沒給 = 整張 0,0,1,1):① 第一次 ×3(直書時自動改走 ×1 找列 + 裁切重辨識)② 同一張
 *      ③ 區域左上角塗白(有變化;直書重試過的區域直接 OCR 記住的那塊)
 * 每次 OCR 印出各段耗時、區域、每列的 OCR 文字 → 名稱比對(poe2 `match-core.ts`,索引讀 `data/poe2/cmn-Hant/items.ndjson` + `data/poe2/runeshape/recipes.json`)
 * → poe.ninja 價格(**錄製檔** `core/test/recordings/ninja/poe2/*.json`,不上網)。
 * 擷取(desktopCapturer)不在這裡測 —— 那一段要真的遊戲畫面,由使用者親測。結束碼 0 = 成功。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'
import type { OcrRegion, RuneshapeScanEvent } from '@ipc/types'
import {
  buildRuneshapeIndex, matchRunesRowsWith, type NameEntry, type RecipeEntry, type RuneshapeIndex, type RuneshapeRecipesFile
} from '../../../poe2/src/runeshape/match-core'
import { parseExchangeOverview } from '../../../core/src/ninja/client'
import type { OcrTextLang } from '../../../poe2/src/desecration/ocr-text'
import { toScanCapture } from './capture'
import { selftestOcrLang, textLangFor } from './ocr-lang'
import { RuneshapeScan, type TickResult } from './runeshape-scan'
import { WIN_OCR_SCRIPT } from './script'
import type { PhysRect } from './strategy'
import { WinOcr } from './WinOcr'

type Out = (s: string) => void

/** repo 根(main/dist/main.js → ../..);打包後沒有 data/core 測試檔 → 只印 OCR */
function repoRoot (): string {
  return path.resolve(__dirname, '../..')
}

async function loadIndex (out: Out, lang: OcrTextLang): Promise<RuneshapeIndex | null> {
  const file = path.join(repoRoot(), lang === 'en' ? 'data/poe2/en/items.ndjson' : 'data/poe2/cmn-Hant/items.ndjson')
  try {
    const t = Date.now()
    const entries: NameEntry[] = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l) as NameEntry)
    // 配方結果(泛稱列);缺檔只少這一層
    const recipesFile = path.join(repoRoot(), 'data/poe2/runeshape/recipes.json')
    let recipes: RecipeEntry[] = []
    try {
      recipes = (JSON.parse(await fs.readFile(recipesFile, 'utf8')) as RuneshapeRecipesFile).recipes
    } catch (e) {
      out(`[runeshape-selftest] 讀不到 ${recipesFile}(${e instanceof Error ? e.message : String(e)});配方泛稱列會對不上`)
    }
    const idx = lang === 'en' ? buildRuneshapeIndex(entries, recipes, 'en') : buildRuneshapeIndex(entries, recipes)
    out(`[runeshape-selftest] 名稱索引 ${entries.length} 筆 + 配方 ${recipes.length} 筆(${file},${Date.now() - t} ms)`)
    return idx
  } catch (e) {
    out(`[runeshape-selftest] 讀不到 ${file}(${e instanceof Error ? e.message : String(e)});只印 OCR`)
    return null
  }
}

interface Prices { map: Map<string, number>, chaosPerDivine?: number, chaosPerExalted?: number }

async function loadPrices (out: Out): Promise<Prices | null> {
  const dir = path.join(repoRoot(), 'core/test/recordings/ninja/poe2')
  try {
    const files = (await fs.readdir(dir)).filter(f => /^exchange_.+\.json$/.test(f)).sort()
    const p: Prices = { map: new Map() }
    for (const f of files) {
      const type = f.slice('exchange_'.length, -'.json'.length)
      const parsed = parseExchangeOverview(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')), type)
      for (const l of parsed.lines) p.map.set(l.key, l.chaos)
      p.chaosPerDivine ??= parsed.chaosPerDivine
      p.chaosPerExalted ??= parsed.chaosPerExalted
    }
    out(`[runeshape-selftest] 價格:錄製檔 ${files.length} 個類別、${p.map.size} 筆(${dir})`)
    return p
  } catch (e) {
    out(`[runeshape-selftest] 讀不到錄製檔(${e instanceof Error ? e.message : String(e)});不印價格`)
    return null
  }
}

function priceText (chaos: number, qty: number, p: Prices): string {
  const fmt = (v: number) => (v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(0))
  const unit = (c: number) => p.chaosPerDivine && c / p.chaosPerDivine >= 1
    ? `${fmt(c / p.chaosPerDivine)} div`
    : p.chaosPerExalted ? `${fmt(c / p.chaosPerExalted)} ex` : `${fmt(c)} c`
  return qty > 1 ? `${unit(chaos * qty)}(每個 ${unit(chaos)})` : unit(chaos)
}

function printRows (ev: RuneshapeScanEvent, index: RuneshapeIndex | null, prices: Prices | null, out: Out) {
  // 繁中:刪掉 WinRT 插在字間的空白(改版前的輸出);英文:空白縮成一個
  const shown = (t: string) => index?.lang === 'en' ? t.replace(/\s+/g, ' ').trim() : t.replace(/\s+/g, '')
  if (!index) {
    for (const r of ev.rows) out(`    (${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)})  ${r.text}`)
    return
  }
  for (const m of matchRunesRowsWith(ev.rows, index)) {
    const pos = `(${m.x.toFixed(0)},${m.y.toFixed(0)})`.padEnd(11)
    const name = m.refName
      ? `${m.kind} ${m.refName}${m.match === 'fuzzy' ? `(≈${m.similarity})` : ''}`
      : m.ambiguous ? `${m.kind} 重名 ${m.ambiguous.join(' / ')}` : `${m.kind} 對不上`
    let price = ''
    if (m.offPanel) price = '面板外,不畫'
    else if (m.undiscovered) price = '未發現,不畫'
    else if (m.unpriced === 'gem') price = '無價格(poe.ninja 沒有技能寶石)'
    else if (m.unpriced === 'recipe') price = `無固定價格(配方泛稱 ${m.recipeId ?? ''})`
    else if (m.ninjaKey && prices) {
      const c = prices.map.get(m.ninjaKey)
      price = c && c > 0 ? priceText(c, m.quantity, prices) : `無價格(錄製檔沒有 ${m.ninjaKey})`
    }
    out(`    ${pos} ${shown(m.text).padEnd(16)} → ${name}${m.quantity > 1 ? ` ×${m.quantity}` : ''}${m.level != null ? ` Lv${m.level}` : ''}  ${price}`)
  }
}

function paint (img: NativeImage, rect: PhysRect): NativeImage {
  const size = img.getSize()
  const bmp = Buffer.from(img.toBitmap())
  const cx0 = rect.x + Math.floor(rect.width * 3 / 8)
  const cy0 = rect.y + Math.floor(rect.height * 3 / 8)
  for (let y = cy0; y < cy0 + Math.floor(rect.height / 4); y++) {
    for (let x = cx0; x < cx0 + Math.floor(rect.width / 4); x++) {
      const o = (y * size.width + x) * 4
      bmp[o] = 255; bmp[o + 1] = 255; bmp[o + 2] = 255
    }
  }
  return nativeImage.createFromBitmap(bmp, { width: size.width, height: size.height })
}

export async function runRuneshapeSelftest (file: string, argv: string[]): Promise<number> {
  await app.whenReady()
  const out: Out = (s) => { process.stdout.write(s + '\n') }
  const img = nativeImage.createFromPath(file)
  if (img.isEmpty()) {
    out(`[runeshape-selftest] 讀不到圖檔(nativeImage 只吃 PNG/JPEG):${file}`)
    return 2
  }
  const size = img.getSize()
  const raw = argv.find(a => a.startsWith('--runeshape-selftest-region='))?.slice('--runeshape-selftest-region='.length)
  const nums = raw ? raw.split(',').map(Number) : []
  const manualRegion: OcrRegion = nums.length === 4 && nums.every(Number.isFinite)
    ? { x: nums[0], y: nums[1], w: nums[2], h: nums[3] }
    : { x: 0, y: 0, w: 1, h: 1 }
  out(`[runeshape-selftest] ${file} ${size.width}x${size.height}`)
  const lang = selftestOcrLang(file, argv)
  const textLang = textLangFor(lang)
  const [index, prices] = await Promise.all([loadIndex(out, textLang), loadPrices(out)])

  const ocr = new WinOcr(WIN_OCR_SCRIPT, { timeoutMs: 60_000, log: out, lang })
  let current = img
  let region: OcrRegion | null = null
  const events: RuneshapeScanEvent[] = []
  const scanFor = () => new RuneshapeScan({
    // 真時鐘量耗時;不排計時器(直接呼叫 tick)。自動定位的 3 秒節流只在「沒快取」時生效,每條路的第一個 tick 一定定位
    clock: { now: () => Date.now(), setTimeout: () => 0, clearTimeout: () => {} },
    config: () => ({ enabled: true, game: 'poe2', region, intervalMs: 1000 }),
    env: () => ({ overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: size.width, height: size.height } }),
    ocrBusy: () => false,
    capture: async () => toScanCapture({ image: current, offset: { x: 0, y: 0 }, client: { w: size.width, h: size.height } }, () => ocr),
    send: (ev) => { events.push(ev) },
    log: out,
    textLang: () => textLang
  })
  const step = async (scan: RuneshapeScan, label: string) => {
    const n = events.length
    const t = Date.now()
    const r: TickResult = await scan.tick()
    const wall = Date.now() - t
    const tm = 'timings' in r ? r.timings : undefined
    const diff = tm?.diff ? `平均差 ${tm.diff.mean}、變動 ${(tm.diff.changedRatio * 100).toFixed(2)}%` : '無基準'
    const rect = 'rect' in r ? ` 區域 (${r.rect.x},${r.rect.y} ${r.rect.width}x${r.rect.height})` : ''
    out(`[runeshape-selftest] ${label}:${r.kind}${r.kind === 'ocr' ? `(${r.rows} 列、面板列 ${r.panelRows})` : ''}${rect};總計 ${wall} ms` +
      (tm
        ? `;擷取(假)${tm.captureMs} ms${tm.locateMs != null ? `、全畫面 ×1 定位 ${tm.locateMs} ms` : ''}、縮圖 + 差分 ${tm.diffMs} ms(${diff})` +
          `${tm.ocrWallMs != null ? `、OCR ${tm.ocrWallMs} ms(行程內 ${tm.ocrMs}${tm.retry ? ',直書重試' : ''})` : ''}`
        : '') +
      `;事件 ${events.slice(n).map(e => `${e.reason}(${e.rows.length} 列)`).join(', ') || '—'}`)
    for (const ev of events.slice(n)) if (ev.rows.length) printRows(ev, index, prices, out)
    return r
  }
  try {
    const t1 = Date.now()
    const ready = await ocr.start()
    out(`[runeshape-selftest] OCR 行程就緒 ${Date.now() - t1} ms lang=${ready.lang}`)

    out('[runeshape-selftest] ===== A. 自動定位(沒框區域)=====')
    region = null
    current = img
    const auto = scanFor()
    await step(auto, 'A① 第一次(整張 ×1 定位 → 定位框 ×3)')
    const located = auto.autoRegion
    const st = auto.snapshot()
    out(`[runeshape-selftest] 定位框(影像像素)${located ? `(${located.x},${located.y} ${located.width}x${located.height})` : '沒找到'};client 比例 ${JSON.stringify(st.autoRegion ?? null)}`)
    await step(auto, 'A② 同一張圖')
    if (located) {
      current = paint(img, located)
      await step(auto, 'A③ 定位框中央塗白')
      current = img
    }

    out(`[runeshape-selftest] ===== B. 手動區域 ${JSON.stringify(manualRegion)} =====`)
    region = manualRegion
    const manual = scanFor()
    await step(manual, 'B① 第一次')
    await step(manual, 'B② 同一張圖')
    // 區域左上角塗一小塊(面板列不受影響)→ 有變化;直書重試過的區域會直接 OCR 記住的那塊
    current = paint(img, { x: 0, y: 0, width: Math.floor(size.width / 3), height: Math.floor(size.height / 3) })
    await step(manual, 'B③ 區域有變化(左上角塗白)')
    current = img
    out(`[runeshape-selftest] 手動區域狀態:panel=${manual.snapshot().panel}`)
    const s = [auto.snapshot(), manual.snapshot()]
    out(`[runeshape-selftest] 統計 A: ticks=${s[0].ticks} ocr=${s[0].ocrRuns} 定位=${s[0].locates} 沒變跳過=${s[0].skippedUnchanged};` +
      `B: ticks=${s[1].ticks} ocr=${s[1].ocrRuns} 定位=${s[1].locates} 沒變跳過=${s[1].skippedUnchanged}`)
    return 0
  } catch (e) {
    out(`[runeshape-selftest] 失敗:${e instanceof Error ? e.message : String(e)}`)
    return 1
  } finally {
    ocr.close()
  }
}
