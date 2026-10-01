/**
 * exile-appraiser 效能修正第 17 步量測:`electron main/dist/main.js --capture-bench [選項]`
 * (框架沿用第 12 步原型分支 `proto/capture-stream` 的 `--capture-bench`:事件迴圈卡頓探針 + fixture 1:1 顯示比對)。
 * 不拿單一實例鎖(與執行中的 ExileAppraiser 並存)、不註冊熱鍵、不送任何鍵盤 / 滑鼠輸入、不搶焦點、不寫任何影格檔(影像只在記憶體)。
 *
 *   --bench-out=<json>          結果寫到這個檔(另外 stdout 印摘要;不含任何畫面文字)
 *   --bench-title=<視窗標題>    electron-overlay-window 以追蹤模式(不建 overlay 視窗)attach 這個標題;**原生只在該視窗是前景時 attach**
 *   --bench-attach-sec=<秒>     等 attach 的上限(預設 10)
 *   --bench-fixture=<a,b,...>   每張圖以 1:1 實體像素顯示在不搶焦點、不可點擊的置頂視窗(副螢幕左上;只有一個螢幕才用主螢幕),
 *                               以 getSources 與 overlay 路徑各擷取,跟原圖(同頁 canvas 解碼)逐像素比對,再走三條 OCR 路徑比對
 *   --bench-blt=<ps1>           overlay 路徑的像素來源改用這支 PowerShell(`scripts/capture-bench-bitblt.ps1`,與原生 `ow_screenshot` 相同的 GDI 呼叫序列),
 *                               給「attach 的視窗不在螢幕上」時比對像素;BGRA 經暫存檔傳回、讀完立即刪除
 *   --bench-overlay-probe       另開一個透明、不可點擊的置頂視窗畫紅塊蓋在 fixture 上,看兩種擷取是否包含 overlay 視窗的內容
 */
import { app, BrowserWindow, nativeImage, screen, type Display, type NativeImage } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OverlayController } from 'electron-overlay-window'
import { captureGameClientViaSources, createOverlayClientCapture, displayPhysRect, pickDisplay, rectRecognizer } from './capture'
import { loadLocateIndex } from './locate-data'
import { createGameClientCapture } from './overlay-shot'
import { WIN_OCR_SCRIPT } from './script'
import { PanelRegionCache, cacheKey, smartRecognize, type PhysRect } from './strategy'
import { WinOcr } from './WinOcr'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const r1 = (n: number) => Math.round(n * 10) / 10

/** 事件迴圈探針:每 4 ms 排一次 setTimeout,記錄實際間隔 − 4(= 那段時間 main 執行緒被佔住多久) */
class LagProbe {
  private samples: Array<{ t: number, lag: number }> = []
  private last = 0
  private timer: NodeJS.Timeout | null = null
  start () {
    this.last = performance.now()
    const tick = () => {
      const now = performance.now()
      this.samples.push({ t: now, lag: now - this.last - 4 })
      this.last = now
      this.timer = setTimeout(tick, 4)
    }
    this.timer = setTimeout(tick, 4)
  }
  stop () { if (this.timer) clearTimeout(this.timer) }
  maxLag (t0: number, t1: number): number {
    let m = 0
    for (const s of this.samples) if (s.t >= t0 && s.t <= t1 + 30 && s.lag > m) m = s.lag
    return m
  }
}

function summarize (v: number[]): { n: number, min: number, med: number, p90: number, max: number } {
  const s = [...v].sort((a, b) => a - b)
  const q = (p: number) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0
  return { n: s.length, min: r1(s[0] ?? 0), med: r1(q(0.5)), p90: r1(q(0.9)), max: r1(s.at(-1) ?? 0) }
}

/** 兩張 BGRA 同尺寸影像逐像素比較(只看 BGR) */
function pixelDiff (a: Buffer, b: Buffer): { sameSize: boolean, pixels: number, differing: number, gt8: number, maxAbs: number } {
  const n = Math.min(a.length, b.length) / 4
  let differing = 0; let gt8 = 0; let maxAbs = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    let m = 0
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[o + c] - b[o + c]); if (d > m) m = d }
    if (m > 0) differing++
    if (m > 8) gt8++
    if (m > maxAbs) maxAbs = m
  }
  return { sameSize: a.length === b.length, pixels: n, differing, gt8, maxAbs }
}

function alphaStats (bgra: Buffer): { a0: number, a255: number, other: number } {
  let a0 = 0; let a255 = 0; let other = 0
  for (let i = 3; i < bgra.length; i += 4 * 97) { if (bgra[i] === 0) a0++; else if (bgra[i] === 255) a255++; else other++ }
  return { a0, a255, other }
}

/** fixture 1:1 顯示(不搶焦點、不可點擊、置頂);同頁 canvas 解碼原圖像素(真值) */
async function showFixture (file: string, display: Display, at?: { x: number, y: number }): Promise<{ win: BrowserWindow, truth: NativeImage, phys: PhysRect }> {
  const sf = display.scaleFactor
  const dir = path.join(os.tmpdir(), 'exile-appraiser-capture-bench')
  fs.mkdirSync(dir, { recursive: true })
  const page = path.join(dir, `fixture-${process.pid}.html`)
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000}img{display:block;image-rendering:pixelated}</style>
<img id="i" src="${encodeURI('file:///' + file.replace(/\\/g, '/'))}"><script>
const { ipcRenderer } = require('electron')
const img = document.getElementById('i')
img.onload = async () => {
  const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight)
  const g = c.getContext('2d'); g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  for (let i = 0; i < d.length; i += 4) { const t = d[i]; d[i] = d[i + 2]; d[i + 2] = t }
  ipcRenderer.send('fx-truth', { w: c.width, h: c.height, data: new Uint8Array(d.buffer) })
}
</script>`)
  const win = new BrowserWindow({
    show: false, frame: false, focusable: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, useContentSize: true,
    x: display.bounds.x, y: display.bounds.y, width: 100, height: 100,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, zoomFactor: 1 / sf }
  })
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  const truthP = new Promise<{ w: number, h: number, data: Uint8Array }>(resolve => { win.webContents.ipc.once('fx-truth', (_e, v) => { resolve(v) }) })
  await win.loadFile(page)
  const t = await truthP
  try { fs.unlinkSync(page) } catch {} // 量測暫存頁刪不掉不影響結果,刻意忽略
  const truth = nativeImage.createFromBitmap(Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength), { width: t.w, height: t.h })
  // 視窗只開到螢幕邊(副螢幕直立 1440 寬,較寬的圖右邊裁掉,不跨到主螢幕);比對範圍 = 看得到的那塊
  const dp = displayPhysRect(display)
  const ax = at?.x ?? dp.x
  const ay = at?.y ?? dp.y
  const vw = Math.min(t.w, dp.x + dp.width - ax)
  const vh = Math.min(t.h, dp.y + dp.height - ay)
  win.setContentSize(Math.round(vw / sf), Math.round(vh / sf))
  const pos = at ? screen.screenToDipPoint({ x: at.x, y: at.y }) : { x: display.bounds.x, y: display.bounds.y }
  win.setPosition(Math.round(pos.x), Math.round(pos.y))
  win.showInactive()
  await sleep(1200)
  const phys = screen.dipToScreenRect(win, win.getContentBounds())
  return { win, truth, phys: { x: phys.x, y: phys.y, width: vw, height: vh } }
}

/** 透明、不可點擊的置頂視窗,在 rect 左上畫 200×120 的紅塊(看擷取是否包含 overlay 視窗) */
async function showOverlayProbe (rect: PhysRect, display: Display): Promise<BrowserWindow> {
  const sf = display.scaleFactor
  const win = new BrowserWindow({
    show: false, frame: false, focusable: false, resizable: false, skipTaskbar: true, transparent: true,
    x: Math.round(rect.x / sf), y: Math.round(rect.y / sf), width: Math.round(400 / sf), height: Math.round(240 / sf),
    webPreferences: { backgroundThrottling: false }
  })
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><style>html,body{margin:0;background:transparent}div{width:' + (200 / sf) + 'px;height:' + (120 / sf) + 'px;background:#ff0000}</style><div></div>'))
  win.showInactive()
  await sleep(800)
  return win
}

/** 影像左上 200×120 內「純紅」像素比例 */
function redRatio (img: NativeImage, dx = 0, dy = 0): number {
  const { width: w } = img.getSize()
  const bmp = img.toBitmap()
  let red = 0; let n = 0
  for (let y = dy + 10; y < dy + 110; y += 5) {
    for (let x = dx + 10; x < dx + 190; x += 5) {
      const o = (y * w + x) * 4
      n++
      if (bmp[o + 2] > 240 && bmp[o + 1] < 16 && bmp[o] < 16) red++
    }
  }
  return n ? red / n : 0
}

function runBlt (ps1: string, rect: PhysRect, out: string, n = 1): Promise<{ ms: number[], alphaSample0: number, alphaSample255: number }> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-X', String(rect.x), '-Y', String(rect.y), '-W', String(rect.width), '-H', String(rect.height), '-Out', out, '-N', String(n)],
      { windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
        if (err) { reject(err); return }
        try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)!)) } catch (e) { reject(e) }
      })
  })
}

export async function runCaptureBench (argv: string[]): Promise<number> {
  await app.whenReady()
  // fixture / 探測視窗關掉時不要因「所有視窗都關了」而結束(預設行為)
  app.on('window-all-closed', () => {})
  const opt = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3)
  const outFile = opt('bench-out')
  const title = opt('bench-title')
  const attachSec = Number(opt('bench-attach-sec') ?? 10)
  const fixtures = (opt('bench-fixture') ?? '').split(',').filter(Boolean)
  const bltPs1 = opt('bench-blt')
  const overlayProbe = argv.includes('--bench-overlay-probe')
  const log = (s: string) => { process.stdout.write(s + '\n') }
  const result: Record<string, unknown> = { at: new Date().toISOString(), electron: process.versions.electron, platform: process.platform }
  const save = () => { if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 1)) }

  result.displays = screen.getAllDisplays().map(d => ({ id: d.id, scaleFactor: d.scaleFactor, phys: displayPhysRect(d), primary: d.id === screen.getPrimaryDisplay().id }))
  for (const d of result.displays as Array<{ id: number, phys: PhysRect, scaleFactor: number, primary: boolean }>) log(`[bench] display ${d.id} phys ${JSON.stringify(d.phys)} sf ${d.scaleFactor}${d.primary ? ' (primary)' : ''}`)
  const primary = screen.getPrimaryDisplay()
  const probe = new LagProbe()
  probe.start()
  const ocr = new WinOcr(WIN_OCR_SCRIPT, { timeoutMs: 60_000, log })
  // 原生只在該標題的視窗是前景的那一刻 attach:一開始就 attach(前景可能隨時換掉)
  const attached = title
    ? new Promise<boolean>(resolve => {
      const t = setTimeout(() => { resolve(false) }, attachSec * 1000)
      OverlayController.events.once('attach', () => { clearTimeout(t); resolve(true) })
      OverlayController.attachByTitle(undefined, title)
    })
    : Promise.resolve(false)
  try {
    // ---- 1. 現行 getSources(主螢幕整塊當成 client):10 次 ----
    const pb = displayPhysRect(primary)
    {
      const wall: number[] = []; const lag: number[] = []
      for (let i = 0; i < 10; i++) {
        const a = performance.now()
        await captureGameClientViaSources(pb)
        const b = performance.now()
        wall.push(b - a); await sleep(40); lag.push(probe.maxLag(a, b)); await sleep(200)
      }
      result.getSources = { rect: pb, wall: summarize(wall), mainBlock: summarize(lag) }
      log(`[bench] getSources ${pb.width}x${pb.height} wall ${JSON.stringify(summarize(wall))} main 最長卡頓 ${JSON.stringify(summarize(lag))}`)
    }

    // ---- 2. 原生 screenshot():追蹤模式 attach ----
    if (title) {
      const ok = await attached
      const tb = { ...OverlayController.targetBounds }
      result.attach = { ok, bounds: tb }
      log(`[bench] attach ${ok ? '成功' : '逾時'} bounds ${JSON.stringify(tb)}`)
      if (ok) {
        const sync: number[] = []; const lag: number[] = []; const pipe: number[] = []; let len = 0; let alpha = { a0: 0, a255: 0, other: 0 }
        for (let i = 0; i < 10; i++) {
          const a = performance.now()
          const buf = OverlayController.screenshot()
          const b = performance.now()
          sync.push(b - a); len = buf.length; alpha = alphaStats(buf)
          await sleep(40); lag.push(probe.maxLag(a, b)); await sleep(160)
        }
        // 走實際要接上的路徑(含裁切 / 全黑判斷 / 退回)
        const cap = createOverlayClientCapture({ screenshot: () => OverlayController.screenshot(), shotBounds: () => OverlayController.targetBounds, log })
        let pathErr = ''
        for (let i = 0; i < 5; i++) {
          const a = performance.now()
          try { await cap.capture(tb) } catch (e) { pathErr = String(e) }
          pipe.push(performance.now() - a)
          await sleep(200)
        }
        const onScreen = pickDisplay(tb) != null
        result.screenshot = { bufLen: len, expectLen: tb.width * tb.height * 4, alpha, onScreen, sync: summarize(sync), mainBlock: summarize(lag), path: { wall: summarize(pipe), stats: cap.stats, error: pathErr || undefined } }
        log(`[bench] screenshot() ${tb.width}x${tb.height} 同步 ${JSON.stringify(summarize(sync))} main 最長卡頓 ${JSON.stringify(summarize(lag))} len=${len} alpha=${JSON.stringify(alpha)} 在螢幕上=${onScreen}`)
        log(`[bench] createOverlayClientCapture 路徑 ${JSON.stringify(summarize(pipe))} stats=${JSON.stringify(cap.stats)}${pathErr ? ` error=${pathErr}` : ''}`)
        // 在螢幕上才有意義:同一時刻兩種擷取的像素比較(只留數字)
        if (onScreen) {
          const cmp: unknown[] = []
          for (let k = 0; k < 3; k++) {
            const o1 = await cap.capture(tb); const g = await captureGameClientViaSources(tb); const o2 = await cap.capture(tb)
            cmp.push({ still: pixelDiff(o1.image.toBitmap(), o2.image.toBitmap()).differing, vsGetSources: pixelDiff(o1.image.toBitmap(), g.image.toBitmap()), offsetSame: JSON.stringify(o1.offset) === JSON.stringify(g.offset) })
            await sleep(300)
          }
          result.desktopConsistency = cmp
          log(`[bench] 桌面一致性 ${JSON.stringify(cmp)}`)
        }
      }
      save()
    }

    // ---- 3. GDI 序列(與 ow_screenshot 相同)在另一個行程的耗時:主螢幕整塊 ----
    if (bltPs1) {
      const r = await runBlt(bltPs1, pb, 'none', 10)
      result.bltHarness = { rect: pb, ms: summarize(r.ms), alphaSample0: r.alphaSample0, alphaSample255: r.alphaSample255 }
      log(`[bench] GDI 序列(另一行程)${pb.width}x${pb.height} ${JSON.stringify(summarize(r.ms))} alpha0=${r.alphaSample0} alpha255=${r.alphaSample255}`)
    }

    // ---- 4. fixture:像素 + OCR 一致性(先擷取、關掉顯示視窗,再跑 OCR —— 置頂視窗只在畫面上停留約 2 秒) ----
    if (fixtures.length) {
      await ocr.start()
      const index = await loadLocateIndex(__dirname, log)
      const fxRes: unknown[] = []
      result.fixtures = fxRes
      const att = result.attach as { ok: boolean } | undefined
      const fxDisplay = screen.getAllDisplays().find(d => d.id !== primary.id) ?? primary
      log(`[bench] fixture 顯示在螢幕 ${fxDisplay.id}${fxDisplay.id === primary.id ? '(只有一個螢幕)' : '(副螢幕)'}`)
      for (const fixture of fixtures) {
        // overlay 像素來源:attach 的視窗在螢幕上 → 原生 screenshot(),fixture 放在它的 client 左上;否則 GDI 序列 harness,fixture 放副螢幕左上
        const tb = { ...OverlayController.targetBounds }
        // 使用者要求(2026-10-02):量測視窗一律開在副螢幕;原生來源只在 attach 的視窗就在副螢幕時用
        const tbPicked = att?.ok ? pickDisplay(tb) : null
        const tbDisplay = tbPicked && tbPicked.display.id === fxDisplay.id ? tbPicked : null
        const source = tbDisplay ? 'native' : bltPs1 ? 'gdi-harness' : 'none'
        if (source === 'none') { log('[bench] 沒有 overlay 像素來源,跳過 fixture'); break }
        const pr = displayPhysRect(fxDisplay)
        const at = tbDisplay
          ? { display: tbDisplay.display, x: Math.max(tb.x, tbDisplay.rect.x), y: Math.max(tb.y, tbDisplay.rect.y) }
          : { display: fxDisplay, x: pr.x, y: pr.y }
        const fx = await showFixture(fixture, at.display, at)
        let R: PhysRect
        let ovImg: NativeImage
        let gs: NativeImage
        let ovStats: unknown
        let probeRes: unknown
        const selfDiff: { gs?: number, overlay?: number } = {}
        try {
          const fb = fx.phys
          if (tbDisplay) {
            // 比對範圍 = fixture ∩ attach client ∩ 螢幕
            const x0 = Math.max(fb.x, tb.x, tbDisplay.rect.x); const y0 = Math.max(fb.y, tb.y, tbDisplay.rect.y)
            const x1 = Math.min(fb.x + fb.width, tb.x + tb.width, tbDisplay.rect.x + tbDisplay.rect.width)
            const y1 = Math.min(fb.y + fb.height, tb.y + tb.height, tbDisplay.rect.y + tbDisplay.rect.height)
            R = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
            const cap = createOverlayClientCapture({ screenshot: () => OverlayController.screenshot(), shotBounds: () => OverlayController.targetBounds, log })
            const c = await cap.capture(tb)
            ovImg = c.image.crop({ x: R.x - tb.x - c.offset.x, y: R.y - tb.y - c.offset.y, width: R.width, height: R.height })
            ovStats = cap.stats
          } else {
            R = fb
            const tmp = path.join(os.tmpdir(), 'exile-appraiser-capture-bench', `blt-${process.pid}.bgra`)
            await runBlt(bltPs1!, fb, tmp)
            const buf = fs.readFileSync(tmp)
            fs.unlinkSync(tmp)
            const cap = createGameClientCapture<NativeImage>({
              screenshot: () => buf,
              shotBounds: () => fb,
              display: b => pickDisplay(b)?.rect ?? null,
              fromBitmap: (b, width, height) => nativeImage.createFromBitmap(b, { width, height }),
              fallback: captureGameClientViaSources,
              log
            })
            ovImg = (await cap.capture(fb)).image
            ovStats = cap.stats
          }
          gs = (await captureGameClientViaSources(R)).image
          selfDiff.gs = pixelDiff(gs.toBitmap(), (await captureGameClientViaSources(R)).image.toBitmap()).differing
          if (tbDisplay) {
            const cap = createOverlayClientCapture({ screenshot: () => OverlayController.screenshot(), shotBounds: () => OverlayController.targetBounds })
            const c = await cap.capture(tb)
            selfDiff.overlay = pixelDiff(ovImg.toBitmap(), c.image.crop({ x: R.x - tb.x - c.offset.x, y: R.y - tb.y - c.offset.y, width: R.width, height: R.height }).toBitmap()).differing
          }
          if (overlayProbe) {
            const pw = await showOverlayProbe(R, at.display)
            try {
              let ov2: NativeImage
              if (tbDisplay) {
                const cap = createOverlayClientCapture({ screenshot: () => OverlayController.screenshot(), shotBounds: () => OverlayController.targetBounds })
                const c = await cap.capture(tb)
                ov2 = c.image.crop({ x: R.x - tb.x - c.offset.x, y: R.y - tb.y - c.offset.y, width: R.width, height: R.height })
              } else {
                const tmp = path.join(os.tmpdir(), 'exile-appraiser-capture-bench', `blt-${process.pid}.bgra`)
                await runBlt(bltPs1!, R, tmp)
                const buf = fs.readFileSync(tmp)
                fs.unlinkSync(tmp)
                ov2 = nativeImage.createFromBitmap(buf, { width: R.width, height: R.height })
              }
              const gs2 = (await captureGameClientViaSources(R)).image
              probeRes = { overlayRedPct: r1(redRatio(ov2) * 100), getSourcesRedPct: r1(redRatio(gs2) * 100) }
              log(`[bench] 透明置頂視窗(紅塊)是否被擷取 ${JSON.stringify(probeRes)}`)
            } finally { pw.destroy() }
          }
        } finally {
          fx.win.destroy()
        }
        const truth = fx.truth.crop({ x: R.x - fx.phys.x, y: R.y - fx.phys.y, width: R.width, height: R.height })
        const truthBmp = truth.toBitmap()
        const dOv = pixelDiff(ovImg.toBitmap(), truthBmp)
        const dGs = pixelDiff(gs.toBitmap(), truthBmp)
        const dOvGs = pixelDiff(ovImg.toBitmap(), gs.toBitmap())
        const jpegSame = ovImg.toJPEG(95).equals(gs.toJPEG(95))
        // 與原圖不同的像素落在哪(畫面上別的置頂視窗 / 動畫會蓋到 fixture):bbox 與「只有一邊錯」的數量
        const where = (() => {
          const o = ovImg.toBitmap(); const g = gs.toBitmap(); const W = R.width
          let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1; let ovOnly = 0; let gsOnly = 0; let both = 0
          for (let i = 0; i < truthBmp.length / 4; i++) {
            const k = i * 4
            const eo = o[k] !== truthBmp[k] || o[k + 1] !== truthBmp[k + 1] || o[k + 2] !== truthBmp[k + 2]
            const eg = g[k] !== truthBmp[k] || g[k + 1] !== truthBmp[k + 1] || g[k + 2] !== truthBmp[k + 2]
            if (!eo && !eg) continue
            if (eo && eg) both++; else if (eo) ovOnly++; else gsOnly++
            const px = i % W; const py = (i - px) / W
            if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py
          }
          return { bbox: x1 >= 0 ? [x0, y0, x1, y1] : null, both, ovOnly, gsOnly }
        })()
        const runSmart = async (img: NativeImage, forceFull: boolean) => {
          const size = img.getSize()
          const search = { x: 0, y: 0, width: size.width, height: size.height }
          const res = await smartRecognize({ recognize: rectRecognizer(img, () => ocr), index, cache: new PanelRegionCache(), key: cacheKey({ w: size.width, h: size.height }, { x: 0, y: 0 }, search), search, forceFull })
          return { stage: res.stage, lines: res.lines.map(l => `(${l.x.toFixed(1)},${l.y.toFixed(1)} ${l.w.toFixed(1)}x${l.h.toFixed(1)}) ${l.text}`) }
        }
        const full1 = async (img: NativeImage) => {
          const size = img.getSize()
          const r = await rectRecognizer(img, () => ocr)({ x: 0, y: 0, width: size.width, height: size.height }, 1)
          return { stage: 'full×1', lines: r.lines.map(l => `(${l.x.toFixed(1)},${l.y.toFixed(1)} ${l.w.toFixed(1)}x${l.h.toFixed(1)}) ${l.text}`) }
        }
        const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i])
        const ocrCmp: Record<string, unknown> = {}
        for (const [name, fn] of [['smart', (i: NativeImage) => runSmart(i, false)], ['full×3', (i: NativeImage) => runSmart(i, true)], ['full×1', full1]] as const) {
          const pt = await fn(truth); const po = await fn(ovImg); const pg = await fn(gs)
          ocrCmp[name] = { stage: [pt.stage, po.stage, pg.stage], lines: [pt.lines.length, po.lines.length, pg.lines.length], overlayEqGetSources: same(po.lines, pg.lines), overlayEqTruth: same(po.lines, pt.lines), getSourcesEqTruth: same(pg.lines, pt.lines) }
          log(`[bench] ${path.basename(fixture)} OCR ${name}:原圖 ${pt.stage}/${pt.lines.length} 行、overlay ${po.stage}/${po.lines.length} 行、getSources ${pg.stage}/${pg.lines.length} 行;overlay=getSources ${same(po.lines, pg.lines)} overlay=原圖 ${same(po.lines, pt.lines)} getSources=原圖 ${same(pg.lines, pt.lines)}`)
        }
        const entry = { file: path.basename(fixture), fixturePhys: fx.phys, compared: R, source, ovStats, overlayVsTruth: dOv, getSourcesVsTruth: dGs, overlayVsGetSources: dOvGs, notTruth: where, selfDiff, jpeg95Same: jpegSame, ocr: ocrCmp, overlayProbe: probeRes }
        fxRes.push(entry)
        log(`[bench] ${path.basename(fixture)} 來源 ${source} 比對範圍 ${JSON.stringify(R)} 像素 overlay vs 原圖 ${JSON.stringify(dOv)} / getSources vs 原圖 ${JSON.stringify(dGs)} / overlay vs getSources ${JSON.stringify(dOvGs)} JPEG 相同 ${jpegSame}`)
        save()
      }
    }
    return 0
  } catch (e) {
    log(`[bench] 失敗 ${e instanceof Error ? e.stack : String(e)}`)
    result.error = String(e)
    return 1
  } finally {
    probe.stop()
    ocr.close()
    save()
  }
}
