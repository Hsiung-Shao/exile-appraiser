// exile-appraiser(WP-S):對 fixture 截圖跑 Windows OCR,產生 `*.ocr.json` 快照。
//   node scripts/ocr-fixture.mjs [--set desecration|runeshape|all] [--lang en-US|zh-Hant-TW] [--with-locate [--locate-only]] [檔名過濾字串]
//   - `--lang`(第 22 步):OCR 語言包;省略 = 依檔名(含 `-en-` / `-en.` → `en-US`,其他 → `zh-Hant-TW`)。英文客戶端截圖檔名一律帶 `-en`
//   - desecration(預設):poe2/test/desecration/fixtures/ocr/*.{webp,png}(WP-S 揭露面板;`tooltip-*` 是負樣本 = 不是揭露面板的畫面)
//   - `--with-locate`:desecration 也另存 `locate`(整張 ×1 = 自動定位那一段的輸入;正樣本 well-of-souls-* 與負樣本 tooltip-* 都有,重產時要加)
//   - `--locate-only`(搭配 `--with-locate`):只補 / 重產 `locate`,既有快照的其他欄位(×3 的 `lines` 等)原樣保留、不重跑 ×3
//     (2026-10-02 code review 第 A 批替三張正樣本補 ×1 快照時用:×3 行是既有斷言的輸入,別讓重跑 OCR 動到它)
//   - runeshape:poe2/test/runeshape/fixtures/ocr/*.{webp,png}(WP-R2 符文塑形面板)
// 需要 Windows + OCR 語言包 zh-Hant-TW(英文截圖另需 en-US)。腳本與 runtime 同一支:main/src/ocr/win-ocr.ps1(WinOcr.ts 以 esbuild text loader 內嵌)。
// 前處理照 runtime 的 `prepare()`(main/src/ocr/capture.ts):整張圖當 client 區,放大倍率 s = min(3, floor(9000 / max(w, h))),
// 這裡用 sharp(lanczos3)縮放再轉 JPEG q95 —— runtime 是 Electron nativeImage.resize({ quality: 'best' }) + toJPEG(95),兩者像素不會逐位元相同,
// 快照只當比對引擎(poe2/src/desecration/ocr-match.ts、poe2/src/runeshape/match.ts)的輸入,vitest 不依賴 WinRT。
// 快照座標:`lines[].x/y/w/h` = 放大後像素;另存 `srcW/srcH/scale`,測試換算成 client 座標。
// runeshape 另存 `locate`(整張 ×1,= 掃描迴圈自動定位那一段的輸入;座標 = 原圖像素)。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
// Node 24 原生型別剝除:直接用 runtime 同一個用戶端(WinOcr.ts 只用可抹除語法)
import { WinOcr } from '../main/src/ocr/WinOcr.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SETS = {
  desecration: 'poe2/test/desecration/fixtures/ocr',
  runeshape: 'poe2/test/runeshape/fixtures/ocr'
}
const argv = process.argv.slice(2)
let setArg = 'desecration'
let filter = ''
let withLocate = false
let locateOnly = false
let langArg = ''
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--set') setArg = argv[++i] ?? ''
  else if (a.startsWith('--set=')) setArg = a.slice('--set='.length)
  else if (a === '--lang') langArg = argv[++i] ?? ''
  else if (a.startsWith('--lang=')) langArg = a.slice('--lang='.length)
  else if (a === '--with-locate') withLocate = true
  else if (a === '--locate-only') locateOnly = true
  else if (!a.startsWith('--')) filter = a
}
const setNames = setArg === 'all' ? Object.keys(SETS) : [setArg]
if (setNames.some(s => !(s in SETS))) {
  console.error(`未知的 --set:${setArg}(可用:${Object.keys(SETS).join(' / ')} / all)`)
  process.exit(1)
}

/** 這張圖用哪個 OCR 語言包:`--lang` 優先,否則依檔名(`-en-` / `-en.` = 英文客戶端截圖) */
function langFor (file) {
  return langArg || (/-en[-.]/i.test(file) ? 'en-US' : 'zh-Hant-TW')
}
/** OCR 語言包 → row-format / ocr-text 的文字語言 */
const textLangOf = (tag) => /^en(?:-|$)/i.test(tag) ? 'en' : 'zh'

function scaleFor (w, h) {
  return Math.max(1, Math.min(3, Math.floor(9000 / Math.max(w, h))))
}

const jobs = setNames.flatMap(set => {
  const dir = path.join(root, SETS[set])
  return readdirSync(dir).filter(f => /\.(webp|png)$/i.test(f) && f.includes(filter)).sort().map(file => ({ set, dir, file }))
})
if (!jobs.length) {
  console.error(`沒有 fixture 圖檔:${setNames.map(s => SETS[s]).join(', ')}(過濾「${filter}」)`)
  process.exit(1)
}

/** poe2/src/runeshape/row-format.ts(相依的 ocr-text.ts 用無副檔名匯入,Node 型別剝除吃不下)→ esbuild 打包成記憶體內 ESM 再載入 */
let rowFormat = null
async function loadRowFormat () {
  if (!rowFormat) {
    const { build } = await import('esbuild')
    const res = await build({
      entryPoints: [path.join(root, 'poe2/src/runeshape/row-format.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      write: false,
      logLevel: 'silent'
    })
    rowFormat = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'))
  }
  return rowFormat
}

const printLines = (lines) => {
  for (const l of lines) {
    console.log(`  y=${String(Math.round(l.y)).padStart(5)} x=${String(Math.round(l.x)).padStart(5)} w=${String(Math.round(l.w)).padStart(4)} h=${String(Math.round(l.h)).padStart(3)}  ${l.text}`)
  }
}

const script = readFileSync(path.join(root, 'main/src/ocr/win-ocr.ps1'), 'utf8')
/** 每個語言包一個 OCR 行程(第一次用到才啟動) */
const ocrs = new Map()
async function ocrFor (lang) {
  let o = ocrs.get(lang)
  if (!o) {
    const ocr = new WinOcr(script, { timeoutMs: 60_000, lang })
    o = { ocr, ready: await ocr.start() }
    ocrs.set(lang, o)
  }
  return o
}
try {
  for (const { set, dir, file } of jobs) {
    const src = path.join(dir, file)
    const lang = langFor(file)
    const { ocr, ready } = await ocrFor(lang)
    const meta = await sharp(src).metadata()
    const scale = scaleFor(meta.width, meta.height)
    // runtime 送 JPEG q95(capture.ts OCR_JPEG_QUALITY);這裡同格式同品質
    const image = await sharp(src)
      .resize(meta.width * scale, meta.height * scale, { kernel: 'lanczos3' })
      .jpeg({ quality: 95 })
      .toBuffer()
    const outFile = path.join(dir, file.replace(/\.(webp|png)$/i, '.ocr.json'))
    if (locateOnly && withLocate && set === 'desecration') {
      const kept = JSON.parse(readFileSync(outFile, 'utf8'))
      const one = await sharp(src).jpeg({ quality: 95 }).toBuffer()
      const r1 = await ocr.recognize(one)
      kept.locate = { scale: 1, w: r1.w, h: r1.h, lines: r1.lines }
      console.log(`[ocr] ${set}/${file} 只補定位段 ×1 → ${r1.lines.length} 行(OCR ${r1.ms} ms;其他欄位原樣保留)`)
      printLines(r1.lines)
      writeFileSync(outFile, JSON.stringify(kept, null, 2) + '\n')
      console.log(`  → ${path.relative(root, outFile)}`)
      continue
    }
    const t0 = Date.now()
    const res = await ocr.recognize(image)
    const wall = Date.now() - t0
    const out = {
      schema: 1,
      source: file,
      srcW: meta.width,
      srcH: meta.height,
      scale,
      w: res.w,
      h: res.h,
      lang: ready.lang,
      lines: res.lines
    }
    console.log(`[ocr] ${set}/${file} ${meta.width}x${meta.height} ×${scale} → ${res.lines.length} 行(OCR ${res.ms} ms,含傳輸 ${wall} ms)`)
    printLines(res.lines)
    if (set === 'runeshape' || withLocate) {
      // 自動定位那一段:整張 ×1(與 panel-scan.ts 的 locate 同倍率)
      const one = await sharp(src).jpeg({ quality: 95 }).toBuffer()
      const r1 = await ocr.recognize(one)
      out.locate = { scale: 1, w: r1.w, h: r1.h, lines: r1.lines }
      console.log(`[ocr] ${set}/${file} 定位段 ×1 → ${r1.lines.length} 行(OCR ${r1.ms} ms)`)
      printLines(r1.lines)
    }
    if (set === 'runeshape') {
      // 定位到的面板區再 ×3(= 掃描迴圈自動定位後每次掃的那塊);定位規則用 runtime 同一份 row-format.ts
      const { locateRunePanel } = await loadRowFormat()
      const loc = locateRunePanel(out.locate.lines, { x: 0, y: 0, w: meta.width, h: meta.height }, textLangOf(ready.lang))
      if (loc) {
        const c = loc.crop
        const ds = scaleFor(c.w, c.h)
        const crop = await sharp(src).extract({ left: c.x, top: c.y, width: c.w, height: c.h })
          .resize(c.w * ds, c.h * ds, { kernel: 'lanczos3' }).jpeg({ quality: 95 }).toBuffer()
        const r3 = await ocr.recognize(crop)
        out.detail = { crop: c, scale: ds, w: r3.w, h: r3.h, lines: r3.lines }
        console.log(`[ocr] ${set}/${file} 定位框 (${c.x},${c.y} ${c.w}x${c.h}) ×${ds} → ${r3.lines.length} 行(OCR ${r3.ms} ms)`)
        printLines(r3.lines)
      } else {
        console.log(`[ocr] ${set}/${file} 定位段沒找到面板`)
      }
    }
    writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n')
    console.log(`  → ${path.relative(root, outFile)}`)
  }
} finally {
  for (const { ocr } of ocrs.values()) ocr.close()
}
