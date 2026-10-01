// exile-appraiser(效能修正第 18 步):徽章自我擷取循環的合成驗證(需 Windows + zh-Hant-TW OCR 語言包;不開視窗、不送任何輸入)。
//   node scripts/ocr-mask-check.mjs [--fill ring-median,dark,feather] [--dpr 1,1.5] [--control] [--keep <輸出資料夾>]
// 對每張正樣本 fixture:
//   ① 原圖(沒有徽章)OCR → 褻瀆:`matchReveal` 分組;符文:含 CJK 的行 + `isPanelRow`。
//   ② 依 runtime 同一套排版(renderer `layoutBadges` / `stackBadges`;符文 = 列右緣 + 14、垂直置中)用 sharp 在圖上畫出徽章
//      (暗底 #131820 94%、金色左條 3 px、`--ink-0` 字、行高 1.45、padding 4 / 8;字級 13 CSS px × dpr)。
//   ③ 有徽章、不遮 → OCR(預期掉組 = 測試抓得到問題);④ 有徽章、經 `ScanMaskStore` + `fillMaskRects`(runtime 同一份 scan-mask.ts)遮掉 → OCR,
//      行文字與比對結果必須和 ① 完全相同。
// 掃描區:褻瀆 = 定位框(`locatePanel`,自動定位)與「定位框 ∪ 徽章外擴 40 px」(模擬手動框);符文 = `locateRunePanel` 定位框 ∪ 徽章。
// 判準:比對結果(褻瀆 = 分組與每組候選;符文 = 每列名稱比對)與原圖相同;行文字逐字是否相同另外列出(符文列尾偶有 `|` 之類雜字,原圖換個裁切也會出現)。
// 放大 / 編碼照 scripts/ocr-fixture.mjs(sharp lanczos3 ×s + JPEG q95;runtime 是 nativeImage 'best',像素不逐位元相同,只比較有無遮罩的差別)。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { WinOcr } from '../main/src/ocr/WinOcr.ts'
import { ScanMaskStore, fillMaskRects } from '../main/src/ocr/scan-mask.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.findIndex(a => a === name || a.startsWith(name + '='))
  if (i < 0) return def
  return argv[i].includes('=') ? argv[i].slice(name.length + 1) : argv[i + 1]
}
const FILLS = arg('--fill', 'feather').split(',')
const DPRS = arg('--dpr', '1,1.5').split(',').map(Number)
const KEEP = arg('--keep', '')
/** 對照組:原圖的掃描區平移 1 px 再 OCR 一次(量 WinRT 對微小像素變化本來就有多少雜字) */
const CONTROL = argv.includes('--control')
if (KEEP) mkdirSync(KEEP, { recursive: true })

// ---- runtime 模組(TS + 路徑別名)→ esbuild 打包成記憶體內 ESM ----
const { build } = await import('esbuild')
const entry = `
export { matchReveal } from './poe2/src/desecration/ocr-match'
export { buildLocateIndex, locatePanel } from './poe2/src/desecration/ocr-locate'
export { poolLabel, rangeLabel } from './poe2/src/desecration/display'
export { layoutBadges, stackBadges, badgeMetrics, tierText, BADGE_GAP_PX } from './renderer/src/web/overlay/ocr-reveal'
export { isPanelRow, locateRunePanel } from './poe2/src/runeshape/row-format'
export { buildRuneshapeIndex, matchRunesRowsWith } from './poe2/src/runeshape/match-core'
`
const bundled = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', tsconfig: path.join(root, 'poe2/tsconfig.json')
})
const M = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

const DES = path.join(root, 'data/poe2/desecration')
const data = {
  tiers: JSON.parse(readFileSync(path.join(DES, 'tiers.json'), 'utf8')),
  baseProfiles: JSON.parse(readFileSync(path.join(DES, 'base_profiles.json'), 'utf8'))
}
const locIdx = M.buildLocateIndex(data.tiers)
// 符文名稱索引(同 --runeshape-selftest:items.ndjson + 配方結果)
const runeIdx = M.buildRuneshapeIndex(
  readFileSync(path.join(root, 'data/poe2/cmn-Hant/items.ndjson'), 'utf8').split(String.fromCharCode(10)).filter(Boolean).map(l => JSON.parse(l)),
  JSON.parse(readFileSync(path.join(root, 'data/poe2/runeshape/recipes.json'), 'utf8')).recipes)
const i18n = JSON.parse(readFileSync(path.join(root, 'renderer/src/i18n/cmn-Hant.json'), 'utf8'))
const t = (k) => k.split('.').reduce((o, p) => (o ? o[p] : undefined), i18n) ?? k

const scaleFor = (w, h) => Math.max(1, Math.min(3, Math.floor(9000 / Math.max(w, h))))
const norm = (s) => s.replace(/\s+/g, '')

const ocr = new WinOcr(readFileSync(path.join(root, 'main/src/ocr/win-ocr.ps1'), 'utf8'), { timeoutMs: 60_000 })
await ocr.start()

/** RGBA raw 影像的某塊 ×s OCR → 行(座標換回原圖像素) */
async function recognize (img, rect, s) {
  const crop = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
    .resize(rect.w * s, rect.h * s, { kernel: 'lanczos3' }).jpeg({ quality: 95 }).toBuffer()
  const res = await ocr.recognize(crop, { words: false })
  return res.lines.map(l => ({ text: l.text, x: l.x / s + rect.x, y: l.y / s + rect.y, w: l.w / s, h: l.h / s }))
}

async function load (file) {
  const { data: buf, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(buf), w: info.width, h: info.height }
}

/** 一枚徽章的圖(RGBA)與大小;`rows` = 每列文字;`fsPx` = 字級(實體 px) */
async function badgeImage (rows, fsPx, opts = {}) {
  const lineH = Math.round(fsPx * (opts.lineH ?? 1.45))
  const padY = Math.round((opts.padY ?? 4) * (opts.dpr ?? 1))
  const padX = Math.round((opts.padX ?? 8) * (opts.dpr ?? 1))
  const border = Math.round(3 * (opts.dpr ?? 1))
  const texts = []
  let tw = 1
  for (const r of rows) {
    const esc = r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const out = await sharp({ text: { text: `<span foreground="${r.color ?? '#ece6d8'}">${esc}</span>`, font: `Microsoft JhengHei ${fsPx}`, dpi: 72, rgba: true } }).png().toBuffer({ resolveWithObject: true })
    texts.push(out)
    tw = Math.max(tw, out.info.width)
  }
  const w = border + padX * 2 + tw
  const h = padY * 2 + lineH * rows.length
  const rgba = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const gold = x < border
      rgba[o] = gold ? 0xd8 : 0x13; rgba[o + 1] = gold ? 0xaa : 0x18; rgba[o + 2] = gold ? 0x4b : 0x20; rgba[o + 3] = gold ? 255 : 240
    }
  }
  const comps = texts.map((tx, i) => ({ input: tx.data, left: border + padX, top: padY + i * lineH + Math.max(0, Math.round((lineH - tx.info.height) / 2)) }))
  const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).composite(comps).png().toBuffer()
  return { png, w, h }
}

/** 徽章畫上去(含 1px 黑環 = box-shadow 的 0 0 0 1px);回傳新影像 */
async function drawBadges (img, badges) {
  const comps = []
  for (const b of badges) {
    const ring = Buffer.alloc((b.w + 2) * (b.h + 2) * 4)
    for (let i = 0; i < ring.length; i += 4) { ring[i + 3] = 102 }
    comps.push({ input: ring, raw: { width: b.w + 2, height: b.h + 2, channels: 4 }, left: b.x - 1, top: b.y - 1 })
    comps.push({ input: b.png, left: b.x, top: b.y })
  }
  const { data: buf } = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).composite(comps).raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(buf), w: img.w, h: img.h }
}

function maskedCopy (img, badgesCss, viewport, fill) {
  const store = new ScanMaskStore()
  store.report({ source: 'reveal', viewport, rects: badgesCss }, 0)
  const rects = store.imageRects({ w: img.w, h: img.h }, { x: 0, y: 0 }, { w: img.w, h: img.h }, 0)
  const out = { data: new Uint8Array(img.data), w: img.w, h: img.h }
  fillMaskRects(out.data, img.w, img.h, rects, fill)
  return { img: out, rects }
}

const union = (a, b) => {
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const clip = (r, img) => {
  const x = Math.max(0, Math.round(r.x)); const y = Math.max(0, Math.round(r.y))
  return { x, y, w: Math.min(img.w, Math.round(r.x + r.w)) - x, h: Math.min(img.h, Math.round(r.y + r.h)) - y }
}

const revealSummary = (lines) => {
  const r = M.matchReveal(lines, data)
  if (!r.ok) return `no-panel(${lines.length} 行)`
  return `${r.groups.length} 組:` + r.groups.map(g => g.candidates.map(c => `${M.tierText(c)} ${c.pool} ${M.rangeLabel(c.ranges)}`).join('/') || '—').join(' | ')
}
/** 符文:runtime 送出的列(含 CJK)→ 名稱比對(match-core,同 renderer matchRunesRows)的結果 */
const runeSummary = (lines) => {
  const rows = lines.filter(l => /[\u3400-\u9fff]/.test(l.text))
  const m = M.matchRunesRowsWith(rows.map(l => ({ text: l.text, x: l.x, y: l.y, w: l.w, h: l.h })), runeIdx)
  return `${rows.filter(l => M.isPanelRow(l.text)).length} 列面板:` +
    m.map(r => r.undiscovered ? '(未發現)' : `${r.refName ?? '?' + r.norm}${r.quantity > 1 ? '×' + r.quantity : ''}${r.level ? ' L' + r.level : ''}${r.offPanel ? '(面板外)' : ''}`).join(' | ')
}
const textsOf = (lines) => lines.map(l => norm(l.text)).join('\n')

const results = []
let failures = 0

async function checkCase (name, img, scanRects, badgesCss, viewport, dpr, summary) {
  const rows = []
  for (const sr of scanRects) {
    const rect = clip(sr.rect, img)
    const s = scaleFor(rect.w, rect.h)
    const base = await recognize(img.clean, rect, s)
    const dirty = await recognize(img.badged, rect, s)
    const row = { name, dpr, scan: sr.kind, rect, scale: s, base: summary(base), badged: summary(dirty), badgedSame: textsOf(base) === textsOf(dirty), masked: {}, viewport, badgesCss, client: { w: img.w, h: img.h } }
    if (CONTROL) {
      const shifted = await recognize(img.clean, clip({ x: rect.x + 1, y: rect.y + 1, w: rect.w - 1, h: rect.h - 1 }, img), s)
      row.control = { same: summary(base) === summary(shifted), textSame: textsOf(base) === textsOf(shifted) }
    }
    for (const fill of FILLS) {
      const { img: m, rects } = maskedCopy(img.badged, badgesCss, viewport, fill)
      const ml = await recognize(m, rect, s)
      const same = summary(base) === summary(ml)
      const textSame = textsOf(base) === textsOf(ml)
      row.masked[fill] = { same, textSame, summary: summary(ml), rects: rects.length }
      if (!textSame) row.masked[fill].textDiff = { base: base.map(l => norm(l.text)), masked: ml.map(l => norm(l.text)) }
      if (!same) {
        failures++
        row.masked[fill].diff = { base: base.map(l => norm(l.text)), masked: ml.map(l => norm(l.text)) }
      }
      if (KEEP) {
        await sharp(m.data, { raw: { width: m.w, height: m.h, channels: 4 } }).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).png()
          .toFile(path.join(KEEP, `${name}-dpr${dpr}-${sr.kind}-${fill}.png`))
      }
    }
    if (KEEP) {
      await sharp(img.badged.data, { raw: { width: img.w, height: img.h, channels: 4 } }).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).png()
        .toFile(path.join(KEEP, `${name}-dpr${dpr}-${sr.kind}-badged.png`))
      await sharp(img.clean.data, { raw: { width: img.w, height: img.h, channels: 4 } }).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).png()
        .toFile(path.join(KEEP, `${name}-dpr${dpr}-${sr.kind}-clean.png`))
    }
    rows.push(row)
    const m = Object.entries(row.masked).map(([f, v]) => `${f}=比對${v.same ? '相同' : '不同'}/行文字${v.textSame ? '相同' : '不同'}`).join(' ')
    console.log(`[mask] ${name} dpr ${dpr} ${sr.kind} (${rect.x},${rect.y} ${rect.w}x${rect.h}) ×${s}\n  原圖   ${row.base}\n  有徽章 ${row.badged}${row.badgedSame ? '(行文字與原圖相同)' : ''}\n  遮罩後 ${Object.values(row.masked).map(v => v.summary).join(' ;; ')}  [${m}]`)
  }
  results.push(...rows)
  return rows
}

try {
  // ---- 褻瀆 ----
  for (const file of ['well-of-souls-fullscreen-02.webp', 'well-of-souls-fullscreen-03.webp', 'well-of-souls-body-armour-01.webp']) {
    const name = file.replace(/\.webp$/, '')
    const clean = await load(path.join(root, 'poe2/test/desecration/fixtures/ocr', file))
    const full = { x: 0, y: 0, w: clean.w, h: clean.h }
    const one = await recognize(clean, full, 1)
    const loc = M.locatePanel(one, locIdx, full)
    const auto = loc ? loc.crop : full
    const baseLines = await recognize(clean, clip(auto, clean), scaleFor(auto.w, auto.h))
    const r = M.matchReveal(baseLines, data)
    if (!r.ok) { console.log(`[mask] ${name}:原圖比對不成面板,略過`); failures++; continue }
    for (const dpr of DPRS) {
      const viewport = { w: clean.w / dpr, h: clean.h / dpr }
      const fs = 13
      const views = M.layoutBadges(r, { w: clean.w, h: clean.h }, viewport, {
        tier: M.tierText, pool: c => M.poolLabel(c, t), range: c => M.rangeLabel(c.ranges)
      }, { metrics: M.badgeMetrics(fs) })
      const imgs = []
      for (const v of views) {
        const rows = v.rows.map(x => ({ text: x.text + (v.more ? `  +${v.more}` : '') }))
        for (const u of v.unmatched) rows.push({ text: t('ppz.ocr.unmatched').replace('{text}', u), color: '#8e8778' })
        imgs.push(await badgeImage(rows, Math.round(fs * dpr), { dpr }))
      }
      // 畫出來後量實際高度再排(同 OcrBadges.vue restackMeasured)
      const stacked = M.stackBadges(views, imgs.map(b => b.h / dpr), viewport.h)
      const badgesCss = stacked.map((v, i) => ({ x: v.left, y: v.top, w: imgs[i].w / dpr, h: imgs[i].h / dpr }))
      const drawn = stacked.map((v, i) => ({ ...imgs[i], x: Math.round(v.left * dpr), y: Math.round(v.top * dpr) }))
      const badged = await drawBadges(clean, drawn)
      const badgeBox = drawn.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h })).reduce(union)
      const manual = union(auto, { x: badgeBox.x - 40, y: badgeBox.y - 40, w: badgeBox.w + 80, h: badgeBox.h + 80 })
      await checkCase(`reveal-${name}`, { clean, badged, w: clean.w, h: clean.h }, [{ kind: 'auto', rect: auto }, { kind: 'manual', rect: manual }], badgesCss, viewport, dpr, revealSummary)
    }
  }
  // ---- 符文塑形 ----
  for (const file of ['runeshape-skills-01.webp', 'runeshape-rewards-02.webp']) {
    const name = file.replace(/\.webp$/, '')
    const clean = await load(path.join(root, 'poe2/test/runeshape/fixtures/ocr', file))
    const full = { x: 0, y: 0, w: clean.w, h: clean.h }
    const one = await recognize(clean, full, 1)
    const loc = M.locateRunePanel(one, full)
    if (!loc) { console.log(`[mask] ${name}:定位不到符文面板,略過`); failures++; continue }
    const auto = loc.crop
    const baseLines = await recognize(clean, clip(auto, clean), scaleFor(auto.w, auto.h))
    const panelRows = baseLines.filter(l => M.isPanelRow(l.text))
    for (const dpr of DPRS) {
      const viewport = { w: clean.w / dpr, h: clean.h / dpr }
      const fs = 12
      const drawn = []
      const badgesCss = []
      for (const [i, l] of panelRows.entries()) {
        const text = i % 3 === 0 ? `${(i + 1) * 1.5} 崇高 (0.5 each)` : i % 3 === 1 ? '市 80 崇高 · L20' : '無價格'
        const b = await badgeImage([{ text }], Math.round(fs * dpr), { dpr, lineH: 1.4, padY: 1, padX: 7 })
        const left = (l.x + l.w) / dpr + M.BADGE_GAP_PX
        const top = (l.y + l.h / 2) / dpr - b.h / dpr / 2
        badgesCss.push({ x: left, y: top, w: b.w / dpr, h: b.h / dpr })
        drawn.push({ ...b, x: Math.round(left * dpr), y: Math.round(top * dpr) })
      }
      const badged = await drawBadges(clean, drawn)
      const badgeBox = drawn.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h })).reduce(union)
      const manual = union(auto, { x: badgeBox.x - 40, y: badgeBox.y - 40, w: badgeBox.w + 80, h: badgeBox.h + 80 })
      await checkCase(`rune-${name}`, { clean, badged, w: clean.w, h: clean.h }, [{ kind: 'auto', rect: auto }, { kind: 'manual', rect: manual }], badgesCss, viewport, dpr, runeSummary)
    }
  }
} finally {
  ocr.close()
}

const reproduced = results.filter(r => r.name.startsWith('reveal-') && r.base !== r.badged).length
const overlapped = results.filter(r => !r.badgedSame).length
console.log(`\n[mask] ${results.length} 個情境;有徽章時行文字改變 ${overlapped} 個(褻瀆比對結果改變 ${reproduced} 個);` +
  FILLS.map(f => `${f} 遮罩後比對結果與原圖相同 ${results.filter(r => r.masked[f]?.same).length}/${results.length}(行文字逐字相同 ${results.filter(r => r.masked[f]?.textSame).length}/${results.length})`).join('、'))
if (CONTROL) console.log(`[mask] 對照組(原圖平移 1 px):比對結果相同 ${results.filter(r => r.control.same).length}/${results.length}、行文字逐字相同 ${results.filter(r => r.control.textSame).length}/${results.length}`)
if (KEEP) writeFileSync(path.join(KEEP, 'results.json'), JSON.stringify(results, null, 2))
if (!reproduced) { console.log('[mask] 沒有任何情境重現掉組 —— 合成徽章沒有干擾 OCR,測試無效'); process.exitCode = 1 }
if (failures) { console.log(`[mask] ${failures} 個遮罩後結果與原圖不同`); process.exitCode = 1 }
