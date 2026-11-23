// 實跑驗證:PoE1 3.30 碎片倉庫頁(一般 / 綢帶)疊層的偵測與格子。不開遊戲、不送任何輸入。
// 輸入 = 使用者 3.30 截圖(倉庫面板裁圖,1440 高 client 的 1:1 像素)。流程:
//   1. 真 Windows OCR 讀裁圖上緣 → 「一般」按鈕文字中心 → 推出裁圖在 2560×1440 client 的位置,貼回黑畫布;
//   2. 依 runtime 同一條路:stripRect 裁掃描條 ×3 JPEG q95 → WinOcr → findSubtabButtons → 三顆按鈕 p99 → activeSubtab;
//   3. 該子頁的 cellRects 每格 readCellQuantity,對人工判讀;
//   4. 輸出標註圖(格框 + 讀數)與 run.log / exit_code.txt。
// 用法:node .claude/skills/verify/check-stash-330.mjs <證據目錄> --general <一般頁截圖> --threads <綢帶頁截圖>
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { WinOcr } from '../../../main/src/ocr/WinOcr.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const dir = args[0]
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? undefined : args[i + 1] }
const inputs = { general: opt('--general'), threads: opt('--threads') }
if (!dir || !inputs.general || !inputs.threads) {
  console.error('用法:node check-stash-330.mjs <證據目錄> --general <png/webp> --threads <png/webp>')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

const { build } = await import('esbuild')
const bundled = await build({
  stdin: {
    contents: [
      "export * from './core/src/stash/detect'",
      "export * from './core/src/stash/layout'",
      "export * from './core/src/stash/quantity'"
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts'
  },
  bundle: true, format: 'esm', platform: 'node', write: false
})
const core = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

const H = 1440
const W = 2560
const layouts = core.parseStashLayouts(JSON.parse(readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))
const templates = core.parseDigitTemplates(JSON.parse(readFileSync(path.join(ROOT, 'data/poe1/stash/digit-templates.json'), 'utf8')))
/** 人工判讀(使用者截圖):沒列的格 = 空格 */
const TRUTH = {
  general: { 'Ritual Splinter': 85, 'Timeless Maraketh Splinter': 3 },
  threads: {
    'Ultimatum Thread': 62, 'Ritual Thread': 28, 'Legion Thread': 20, 'Incursion Thread': 34, 'Expedition Thread': 36,
    'Breach Thread': 32, 'Blight Thread': 9, 'Betrayal Thread': 27, 'Bestiary Thread': 33, 'Abyss Thread': 44
  }
}

const log = []
let failed = 0
const check = (ok, msg) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }

const ocr = new WinOcr(readFileSync(path.join(ROOT, 'main/src/ocr/win-ocr.ps1'), 'utf8'), { timeoutMs: 60_000, lang: 'zh-Hant-TW' })
await ocr.start()
const ocrLines = async (png, scale) => {
  const meta = await sharp(png).metadata()
  const jpg = await sharp(png).resize(meta.width * scale, meta.height * scale, { kernel: 'lanczos3' }).jpeg({ quality: 95 }).toBuffer()
  const r = await ocr.recognize(jpg)
  return r.lines.map(l => ({ text: l.text, x: l.x / scale, y: l.y / scale, w: l.w / scale, h: l.h / scale }))
}

try {
  for (const tab of ['general', 'threads']) {
    const src = await sharp(inputs[tab]).removeAlpha().png().toBuffer()
    const meta = await sharp(src).metadata()
    // 1. 找任一顆按鈕文字 → 裁圖貼回 client 的位置(第 k 顆文字中心在 client 的 x = 202 + 166k + 76、y = 201,1440 基準)
    const top = await sharp(src).extract({ left: 0, top: 0, width: meta.width, height: 140 }).png().toBuffer()
    const topLines = await ocrLines(top, 3)
    log.push(`INFO ${tab}:裁圖上緣 OCR ${topLines.map(l => `「${l.text}」`).join(' ')}`)
    const LABELS = ['一般', '綢帶', '異能']
    const g = topLines.find(l => LABELS.includes(l.text.replace(/\s+/g, '')))
    check(!!g, `${tab}:裁圖上緣讀得到任一顆按鈕文字(定位用)`)
    if (!g) continue
    const k = LABELS.indexOf(g.text.replace(/\s+/g, ''))
    const px = Math.round(278 + 166 * k - (g.x + g.w / 2))
    const py = Math.round(201 - (g.y + g.h / 2))
    log.push(`INFO ${tab}:裁圖貼在 client (${px}, ${py}),裁圖 ${meta.width}×${meta.height}`)
    const client = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
      .composite([{ input: src, left: px, top: py }]).png().toBuffer()
    writeFileSync(path.join(dir, `client-${tab}.png`), client)

    // 2. 子頁偵測(runtime 同一條路)
    const strip = core.stripRect(H, core.stashLeft(W, H))
    const stripPng = await sharp(client).extract({ left: strip.x, top: strip.y, width: strip.w, height: strip.h }).png().toBuffer()
    const lines = (await ocrLines(stripPng, 3)).map(l => ({ ...l, x: l.x + strip.x, y: l.y + strip.y }))
    log.push(`INFO ${tab}:掃描條 OCR ${lines.map(l => `「${l.text}」@(${Math.round(l.x)},${Math.round(l.y)})`).join(' ')}`)
    const match = core.findSubtabButtons(lines, H, 'zh', core.stashLeft(W, H))
    check(match.found, `${tab}:findSubtabButtons found(槽位 ${JSON.stringify(match.slots)},命中 ${match.matched})`)
    const gray = await sharp(client).greyscale().raw().toBuffer()
    const p99 = core.buttonRects(H, match.yOffset, core.stashLeft(W, H)).map(r => {
      const px2 = new Uint8Array(r.w * r.h)
      let n = 0
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) px2[n++] = gray[y * W + x]
      return core.percentile(px2, 0.99)
    })
    const sub = core.activeSubtab(p99)
    check(sub === tab, `${tab}:三顆按鈕 p99 ${JSON.stringify(p99)} → activeSubtab = ${sub}`)

    // 3. 每格數量
    const raw = await sharp(client).raw().toBuffer({ resolveWithObject: true })
    const img = { data: raw.data, width: raw.info.width, height: raw.info.height, channels: raw.info.channels }
    const rects = core.cellRects(layouts, tab, H, match.yOffset, core.stashLeft(W, H))
    let right = 0
    let wrong = 0
    let unknown = 0
    const svg = []
    for (const r of rects) {
      const res = core.readCellQuantity(img, r, templates, { clientH: H, refName: r.refName })
      const want = TRUTH[tab][r.refName] ?? 0
      const got = res.reason === 'empty' ? 0 : res.qty
      if (got === want) right++
      else if (got == null) unknown++
      else wrong++
      if (got !== want) log.push(`INFO ${tab}:${r.refName} 讀到 ${got ?? '?'}(${res.reason}),應為 ${want}`)
      const color = got === want ? '#2ecc71' : got == null ? '#f1c40f' : '#e74c3c'
      svg.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${color}" stroke-width="2"/>`,
        `<text x="${r.x + 2}" y="${r.y + r.h + 14}" font-size="13" fill="${color}" font-family="sans-serif">${got ?? '?'}</text>`)
    }
    check(wrong === 0, `${tab}:${rects.length} 格數量 正確 ${right}、錯 ${wrong}、讀不到 ${unknown}(寧缺勿錯:錯必須 0)`)
    check(right >= rects.length - 2, `${tab}:讀不到 ≤ 2 格`)
    const drawn = await sharp(client)
      .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg.join('')}</svg>`), left: 0, top: 0 }])
      .png().toBuffer()
    const annotated = await sharp(drawn).extract({ left: 0, top: 0, width: 960, height: H }).png().toBuffer()
    writeFileSync(path.join(dir, `annotated-${tab}.png`), annotated)
  }
} finally {
  ocr.close()
}

appendFileSync(path.join(dir, 'run.log'), log.join('\n') + '\n')
writeFileSync(path.join(dir, 'exit_code.txt'), failed ? '1' : '0')
process.stdout.write(log.join('\n') + '\n')
process.exit(failed ? 1 : 0)
