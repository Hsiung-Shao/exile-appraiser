/**
 * 倉庫價值(2026-10-15):`--stash-selftest <png> [--out <png>] [--stash-subtab=general|scarabs] [--stash-y-offset=N]`
 * 無頭跑「讀格子堆疊數量」:截圖當成整個遊戲 client(高 = 圖高、擷取偏移 0)→ 固定版面每格 → 與執行期同一條路(`rawPixels` 取格子區像素 →
 * core `readCellQuantity`),印每格數量、原因與耗時;同資料夾有 `truth.json`(core/test/stash/fixtures/qty 格式)就一併算準確度。
 * `--out` = 標註圖(每格數量疊在格上:綠 = 讀到、黃 = 讀不到、灰 = 空格;有真值時錯的標紅),用離屏視窗畫完 `capturePage()` 存 PNG。
 * 不拿單一實例鎖、不送任何輸入、不擷取螢幕。子頁省略 = 依檔名(含 scarab → 聖甲蟲,否則一般)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import { cellRects, type StashSubtab } from '../../../core/src/stash/layout'
import { QTY_PARAMS, readCellQuantity, type QtyResult } from '../../../core/src/stash/quantity'
import { loadStashDigitTemplates, loadStashLayouts } from '../stash-layout-data'
import { rawPixels } from './capture'

const argValue = (argv: string[], prefix: string) => argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
const argAfter = (argv: string[], flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }

export async function runStashSelftest (png: string, argv: string[]): Promise<number> {
  if (!png || !fs.existsSync(png)) { console.error('[stash-selftest] 用法:--stash-selftest <png> [--out <png>] [--stash-subtab=general|scarabs] [--stash-y-offset=N]'); return 2 }
  const layouts = loadStashLayouts()
  const templates = loadStashDigitTemplates()
  if (!layouts || !templates) { console.error('[stash-selftest] 讀不到版面或數字模板'); return 1 }
  const subtab: StashSubtab = (argValue(argv, '--stash-subtab=') as StashSubtab | undefined) ?? (/scarab/i.test(path.basename(png)) ? 'scarabs' : 'general')
  const yOffset = Number(argValue(argv, '--stash-y-offset=') ?? 0) || 0
  const img = nativeImage.createFromPath(path.resolve(png))
  const size = img.getSize()
  if (!size.width || !size.height) { console.error(`[stash-selftest] 讀不到圖片 ${png}`); return 1 }
  const clientH = size.height
  const rects = cellRects(layouts, subtab, clientH, yOffset)
  // 與 StashScan 相同:一次取整個格子區的像素,格子換成區域內座標
  const bx0 = Math.max(0, Math.min(...rects.map(r => r.x)) - 8)
  const by0 = Math.max(0, Math.min(...rects.map(r => r.y)) - 2)
  // 右界含漏讀檢查的延伸裁切(與 StashScan 相同),最右欄的三位數才不會因延伸區出界而不確定
  const bx1 = Math.max(...rects.map(r => r.x + r.w)) + Math.ceil(QTY_PARAMS.extW * clientH / templates.baseClientH) + 2
  const by1 = Math.max(...rects.map(r => r.y + r.h)) + 2
  const t0 = performance.now()
  const px = rawPixels(img, { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 })
  const tPix = performance.now() - t0
  const results: QtyResult[] = []
  const t1 = performance.now()
  for (const r of rects) results.push(readCellQuantity(px, { x: r.x - px.x, y: r.y - px.y, w: r.w, h: r.h }, templates, { clientH }))
  const tRead = performance.now() - t1
  // 計時(暖機後再量 3 次取最快)
  let best = Infinity
  for (let k = 0; k < 3; k++) {
    const s = performance.now()
    for (const r of rects) readCellQuantity(px, { x: r.x - px.x, y: r.y - px.y, w: r.w, h: r.h }, templates, { clientH })
    best = Math.min(best, performance.now() - s)
  }

  let truth: Array<number | null> | null = null
  const truthFile = path.join(path.dirname(path.resolve(png)), 'truth.json')
  if (fs.existsSync(truthFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(truthFile, 'utf8')) as Record<string, unknown>
      // 第二批起(truth.more)依檔名找;沒有就用該子頁的第一批真值
      const more = Array.isArray(j.more) ? (j.more as Array<{ tab?: string, file?: string, values?: unknown }>).find(m => m.file === path.basename(png) && m.tab === subtab) : undefined
      const arr = more?.values ?? j[subtab]
      if (Array.isArray(arr) && arr.length === rects.length && j.clientH === clientH) truth = arr as number[]
    } catch { /* 沒有可用的真值就只印讀數 */ }
  }
  let ok = 0
  let wrong = 0
  let unknown = 0
  results.forEach((r, i) => {
    const t = truth?.[i]
    const mark = truth ? (r.qty === t ? 'OK' : r.qty == null ? '??' : 'XX') : ''
    if (truth) { if (r.qty === t) ok++; else if (r.qty == null) unknown++; else wrong++ }
    console.log(`[stash-selftest] #${i} ${rects[i].refName}:${r.qty ?? '-'}(${r.reason}${r.raw ? ` raw ${r.raw}` : ''},conf ${r.confidence} / ${r.margin})${truth ? ` 真值 ${String(t)} ${mark}` : ''}`)
  })
  console.log(`[stash-selftest] ${path.basename(png)} ${subtab} client 高 ${clientH}:${rects.length} 格,取像素 ${tPix.toFixed(1)} ms,第一次讀 ${tRead.toFixed(1)} ms,暖機後 ${best.toFixed(1)} ms`)
  if (truth) console.log(`[stash-selftest] 準確度:正確 ${ok} / ${rects.length},錯 ${wrong},不確定 ${unknown}`)

  const out = argAfter(argv, '--out') ?? argValue(argv, '--out=')
  if (out) await writeAnnotated(img, rects, results, truth, out)
  return wrong > 0 && truth ? 1 : 0
}

async function writeAnnotated (img: Electron.NativeImage, rects: Array<{ x: number, y: number, w: number, h: number }>, results: QtyResult[], truth: Array<number | null> | null, out: string): Promise<void> {
  await app.whenReady()
  const { width, height } = img.getSize()
  const labels = rects.map((r, i) => {
    const q = results[i]
    const t = truth?.[i]
    const color = truth && q.qty != null && q.qty !== t ? '#ff4d4d' : q.qty == null ? (q.reason === 'empty' ? '#9aa0a6' : '#ffd23f') : '#4cff7a'
    const text = q.qty == null ? (q.reason === 'empty' ? '空' : '?') : String(q.qty)
    return `<div style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;box-sizing:border-box;border:2px solid ${color}"></div>` +
      `<div style="position:absolute;left:${r.x}px;top:${r.y + r.h - 14}px;width:${r.w}px;height:14px;background:rgba(0,0,0,.75);color:${color};font:bold 12px/14px sans-serif;text-align:center">${text}</div>`
  }).join('')
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:${width}px;height:${height}px;position:relative;overflow:hidden">` +
    `<img src="${img.toDataURL()}" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px">${labels}</body>`
  const w = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { offscreen: true, javascript: false } })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise<void>((resolve) => { setTimeout(resolve, 300) })
    const shot = await w.webContents.capturePage({ x: 0, y: 0, width, height })
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    fs.writeFileSync(out, shot.toPNG())
    const s = shot.getSize()
    console.log(`[stash-selftest] 標註圖 ${s.width}×${s.height} → ${path.resolve(out)}`)
  } finally {
    w.destroy()
  }
}
