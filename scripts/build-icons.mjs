// 由 renderer/public/brand/*.svg 產生 app 圖示(視窗/安裝檔/favicon)與托盤圖示。
//   npm run build-icons
// 冪等:同一版 sharp(libvips + librsvg)下重跑輸出逐位元組相同(不寫時間戳、固定 PNG 參數、ICO 自己封裝)。
// ICO 不用 png-to-ico:它只會寫 BMP 層;這裡每層直接嵌 PNG(Vista 起支援,256 層只能用 PNG 才不膨脹)。
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = path.join(root, 'renderer/public')
const brand = path.join(pub, 'brand')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const SUPERSAMPLE_MAX = 32 // ≤ 這個尺寸先 4× 超取樣再縮
const OUTLINE_COLOR = '#1a202c'
const PNG_OPTS = { compressionLevel: 9, palette: false, adaptiveFiltering: false, effort: 10 }

sharp.cache(false)
sharp.concurrency(1)

const iconSvg = readFileSync(path.join(brand, 'icon.svg'), 'utf8')
const traySvg = readFileSync(path.join(brand, 'tray.svg'), 'utf8')

function viewBoxWidth (svg) {
  const m = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+[\d.]+\s*"/.exec(svg)
  if (!m) throw new Error('SVG 缺 viewBox')
  return Number(m[1])
}

/**
 * 在整張圖外圍加一圈深色描邊(以 alpha 膨脹實作,與圖形細節無關)。
 * pxAtSize:在 size 像素的輸出上要多粗;換算成 viewBox 單位。
 */
function withOutline (svg, pxAtSize, size) {
  const r = (viewBoxWidth(svg) / size) * pxAtSize
  const open = /<svg\b[^>]*>/.exec(svg)
  const close = svg.lastIndexOf('</svg>')
  const filter = `<defs><filter id="ea-outline" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="${r.toFixed(4)}" result="grown"/>` +
    `<feFlood flood-color="${OUTLINE_COLOR}"/><feComposite in2="grown" operator="in" result="ring"/>` +
    `<feMerge><feMergeNode in="ring"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
  const body = svg.slice(open.index + open[0].length, close)
  return svg.slice(0, open.index + open[0].length) + filter + `<g filter="url(#ea-outline)">` + body + '</g></svg>'
}

/** SVG → size×size 透明底 PNG;小尺寸先以 4× 渲染再 lanczos3 縮小。 */
async function rasterize (svg, size) {
  const render = size <= SUPERSAMPLE_MAX ? size * 4 : size
  const density = 72 * render / viewBoxWidth(svg)
  const big = await sharp(Buffer.from(svg), { density })
    .resize(render, render, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let img = sharp(big.data, { raw: big.info })
  if (render !== size) img = img.resize(size, size, { kernel: 'lanczos3' })
  return img.png(PNG_OPTS).toBuffer()
}

/** 以 PNG 壓縮層封裝 ICO。第一層(目錄順序)放 16,Windows 依實際需求挑層,與順序無關。 */
function packIco (layers) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(layers.length, 4)
  const dirs = []
  let offset = 6 + 16 * layers.length
  for (const { size, png } of layers) {
    const d = Buffer.alloc(16)
    d.writeUInt8(size >= 256 ? 0 : size, 0)
    d.writeUInt8(size >= 256 ? 0 : size, 1)
    d.writeUInt8(0, 2)
    d.writeUInt8(0, 3)
    d.writeUInt16LE(1, 4)
    d.writeUInt16LE(32, 6)
    d.writeUInt32LE(png.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += png.length
    dirs.push(d)
  }
  return Buffer.concat([header, ...dirs, ...layers.map(l => l.png)])
}

const outputs = []
function emit (rel, buf, dims, note = '') {
  writeFileSync(path.join(root, rel), buf)
  outputs.push({ rel, dims, bytes: buf.length, sha: createHash('sha256').update(buf).digest('hex').slice(0, 8), note })
}

// 1) 視窗圖示 / Electron / favicon 備用
emit('renderer/public/icon.png', await rasterize(iconSvg, 512), '512x512')

// 2) icon.ico:16 層加 0.5px 深色描邊,16/24/32 超取樣
const layers = []
for (const size of ICO_SIZES) {
  const svg = size === 16 ? withOutline(iconSvg, 0.5, 16) : iconSvg
  layers.push({ size, png: await rasterize(svg, size) })
}
emit('renderer/public/icon.ico', packIco(layers), ICO_SIZES.join('/'), 'PNG 層')

// 3) 托盤:單色天平,兩個尺寸都加描邊(同一個邏輯寬度:16px 上 0.5px、32px 上 1px),淺色工作列才看得見
emit('renderer/public/tray-16.png', await rasterize(withOutline(traySvg, 0.5, 16), 16), '16x16')
emit('renderer/public/tray-32.png', await rasterize(withOutline(traySvg, 1, 32), 32), '32x32')

console.log(`sharp ${sharp.versions.sharp} / vips ${sharp.versions.vips} / rsvg ${sharp.versions.rsvg}`)
for (const o of outputs) {
  console.log(`${o.rel.padEnd(30)} ${o.dims.padEnd(22)} ${String(o.bytes).padStart(7)} B  sha256:${o.sha}${o.note ? '  ' + o.note : ''}`)
}
for (const l of layers) console.log(`  ico layer ${String(l.size).padStart(3)}px  ${String(l.png.length).padStart(6)} B`)
