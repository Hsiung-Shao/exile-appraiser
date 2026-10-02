/**
 * exile-appraiser(WP-S):`electron main/dist/main.js --ocr-selftest <png> [--ocr-selftest-region=x,y,w,h] [--ocr-lang=en-US|zh-Hant-TW]`
 * (第 22 步:`--ocr-lang` 省略 = 依檔名,`-en-` / `-en.` → 英文客戶端 `en-US` + 英文模板索引;其他 → 繁中,輸出與改版前相同)
 * 不開任何視窗、不註冊熱鍵、不拿單一實例鎖:把 PNG 當成遊戲 client 區,走 runtime 同一條 `smartRecognize`
 * (`prepareRect` 裁切 + 放大 → `WinOcr` 內嵌的 win-ocr.ps1;模板索引同 runtime 的 `loadLocateIndex`),
 * 依序跑三次並印出每段耗時與走了哪條路:
 *   ① 快取是空的 → two-pass(第 1 段整張 ×1 定位、第 2 段面板區 ×3;PowerShell 冷啟動算在這次)
 *   ② 同一張圖再跑 → cached(直接用 ① 記下的面板區 ×3)
 *   ③ 強制 full(整張 ×3,舊做法)當對照
 *   ④ 清掉快取再跑一次 two-pass(行程已熱,看穩態耗時)
 * 每次都印出採用那一段的行(client 座標)。結束碼 0 = 成功。
 * 擷取(desktopCapturer)不在這裡測 —— 那一段要真的遊戲畫面,由使用者親測。
 * WP-R2 的 `--runeshape-selftest` 在 `runeshape-selftest.ts`(這裡轉出,main.ts 的匯入不變)。
 */
import { app, nativeImage } from 'electron'
import type { OcrRegion } from '@ipc/types'
import { rectRecognizer, regionRect } from './capture'
import { loadLocateIndex } from './locate-data'
import { selftestOcrLang, textLangFor } from './ocr-lang'
import { WIN_OCR_SCRIPT } from './script'
import { PanelRegionCache, cacheKey, smartRecognize, type SmartOcrResult } from './strategy'
import { WinOcr } from './WinOcr'

export { runRuneshapeSelftest } from './runeshape-selftest'

function parseRegion (argv: string[]): OcrRegion | null {
  const raw = argv.find(a => a.startsWith('--ocr-selftest-region='))?.slice('--ocr-selftest-region='.length)
  if (!raw) return null
  const [x, y, w, h] = raw.split(',').map(Number)
  return [x, y, w, h].every(Number.isFinite) ? { x, y, w, h } : null
}

export async function runOcrSelftest (file: string, argv: string[]): Promise<number> {
  await app.whenReady()
  const out = (s: string) => { process.stdout.write(s + '\n') }
  const img = nativeImage.createFromPath(file)
  if (img.isEmpty()) {
    out(`[ocr-selftest] 讀不到圖檔(nativeImage 只吃 PNG/JPEG):${file}`)
    return 2
  }
  const size = img.getSize()
  const region = parseRegion(argv)
  const search = regionRect({ w: size.width, h: size.height }, region)
  out(`[ocr-selftest] ${file} ${size.width}x${size.height} region=${region ? JSON.stringify(region) : '整張'} → 搜尋範圍 ${search.x},${search.y} ${search.width}x${search.height}`)
  const lang = selftestOcrLang(file, argv)
  const index = await loadLocateIndex(__dirname, out, textLangFor(lang))
  const ocr = new WinOcr(WIN_OCR_SCRIPT, { timeoutMs: 60_000, log: out, lang })
  const cache = new PanelRegionCache()
  const key = cacheKey({ w: size.width, h: size.height }, { x: 0, y: 0 }, search)
  const print = (label: string, wall: number, res: SmartOcrResult) => {
    out(`[ocr-selftest] ${label}:走 ${res.stage},總計 ${wall} ms(OCR 合計 ${res.ocrMs} ms)`)
    for (const s of res.stages) {
      const r = s.rect
      out(`  段 ${s.name.padEnd(6)} ×${s.scale} 範圍 (${r.x},${r.y} ${r.width}x${r.height}) ${s.ms} ms(OCR ${s.ocrMs} ms)${s.lines} 行${s.hits != null ? `、像詞綴 ${s.hits}` : ''}${s.rejected ? `、未採用:${s.rejected}` : ''}`)
    }
    for (const l of res.lines) out(`    (${l.x.toFixed(0)},${l.y.toFixed(0)} ${l.w.toFixed(0)}x${l.h.toFixed(0)})  ${l.text}`)
  }
  try {
    const t1 = Date.now()
    const ready = await ocr.start()
    out(`[ocr-selftest] 行程就緒 ${Date.now() - t1} ms lang=${ready.lang} 已安裝=${ready.langs.join(',')} maxDim=${ready.maxDim}`)
    const recognize = rectRecognizer(img, () => ocr)
    const runs: Array<{ label: string, forceFull?: boolean, clear?: boolean }> = [
      { label: '① 第一次(快取空)' },
      { label: '② 第二次(同一張)' },
      { label: '③ 對照:強制整張 ×3', forceFull: true },
      { label: '④ 清快取再跑(熱的 two-pass)', clear: true }
    ]
    for (const r of runs) {
      if (r.clear) cache.clear()
      const t = Date.now()
      const res = await smartRecognize({ recognize, index, cache, key, search, forceFull: r.forceFull })
      print(r.label, Date.now() - t, res)
    }
    return 0
  } catch (e) {
    out(`[ocr-selftest] 失敗:${e instanceof Error ? `${(e as { kind?: string }).kind ?? ''} ${e.message}` : String(e)}`)
    return 1
  } finally {
    ocr.close()
  }
}
