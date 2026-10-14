/**
 * 倉庫價值除錯(2026-10-15 使用者要求):「存下倉庫擷取畫面」—— 把 StashScan 讀數量用的那一塊原解析度像素(`cap.pixels`,含右側延伸)
 * 存成 PNG(無損)+ 同名 JSON(版面格子 / 遮罩 / 每格讀數與原因),給使用者用實機畫面重訓數字模板(`scripts/build-stash-digit-templates.mjs`)。
 * 存在 `userData/logs/`(與記錄同一個資料夾,「開啟記錄資料夾」就看得到);只存本機、不上傳。
 * 清理:`isStashCaptureFile` 交給 `LogFileWriter.purgeOld({ isOwnFile })`,啟動時刪 7 天前的(記錄檔的預設規則不認這個檔名)。
 * 不 import electron:PNG 編碼由 main 注入(`nativeImage.createFromBitmap(...).toPNG()`),測試注入假的。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export interface DumpRect { x: number, y: number, w: number, h: number }

export interface StashDumpCell {
  /** 版面順序(0 起) */
  i: number
  refName: string
  /** 格子矩形(像素區座標 = 影像座標 − `origin`) */
  rect: DumpRect
  /** 數字裁切區(像素區座標;core `qtyCropRect`) */
  crop: DumpRect
  /** 目前讀數(null = 「?」/ 沒讀過;0 = 空格) */
  value: number | null
  /** 還在等重讀(被徽章遮住等) */
  pending: boolean
  /** 讀不到的原因(StashScan `QtyCell.why`) */
  why?: { reason: string, raw?: string, confidence: number, margin: number }
}

export interface StashDumpData {
  /** 擷取時間(clock) */
  ts: number
  subtab: 'general' | 'scarabs'
  yOffset: number
  client: { w: number, h: number }
  /** 擷取影像左上在 client 內的位置 */
  offset: { x: number, y: number }
  /** 像素區(PNG)左上在擷取影像內的位置 */
  origin: { x: number, y: number }
  /** 數字模板的基準 client 高 */
  baseClientH: number
  /** 原解析度像素(BGRA 列優先;`channels` 4) */
  image: { data: Uint8Array, width: number, height: number, channels: number }
  /** 這張擷取的遮罩(我們自己的徽章;像素區座標) */
  masks: DumpRect[]
  cells: StashDumpCell[]
}

export interface StashDumpIo {
  mkdir: (dir: string) => Promise<void>
  writeFile: (file: string, data: Uint8Array | string) => Promise<void>
}

const NODE_IO: StashDumpIo = {
  mkdir: async (dir) => { await fs.mkdir(dir, { recursive: true }) },
  writeFile: async (file, data) => { await fs.writeFile(file, data) }
}

const STASH_CAPTURE_RE = /^stash-capture-\d{8}-\d{6}-[a-z]+\.(png|json)$/

/** 是不是本功能存的檔(清理用) */
export function isStashCaptureFile (name: string): boolean {
  return STASH_CAPTURE_RE.test(name)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 本機時間 `stash-capture-YYYYMMDD-HHmmss-<子頁>`(不含副檔名) */
export function stashCaptureBaseName (ms: number, subtab: string): string {
  const d = new Date(ms)
  return `stash-capture-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${subtab}`
}

/** JSON 內容(不含像素) */
export function stashDumpMeta (d: StashDumpData, version: string): Record<string, unknown> {
  return {
    kind: 'stash-capture',
    schema: 1,
    version,
    ts: d.ts,
    subtab: d.subtab,
    yOffset: d.yOffset,
    client: d.client,
    offset: d.offset,
    origin: d.origin,
    image: { width: d.image.width, height: d.image.height, format: 'png (由 BGRA 原始像素無損編碼)' },
    baseClientH: d.baseClientH,
    masks: d.masks,
    cells: d.cells
  }
}

/** 寫 PNG + 同名 JSON 到 `dir`,回傳 PNG 完整路徑 */
export async function saveStashDump (d: StashDumpData, o: {
  dir: string
  version: string
  encodePng: (img: StashDumpData['image']) => Uint8Array
  io?: StashDumpIo
}): Promise<string> {
  const io = o.io ?? NODE_IO
  const base = stashCaptureBaseName(d.ts, d.subtab)
  const png = path.join(o.dir, `${base}.png`)
  await io.mkdir(o.dir)
  await io.writeFile(png, o.encodePng(d.image))
  await io.writeFile(path.join(o.dir, `${base}.json`), JSON.stringify(stashDumpMeta(d, o.version), null, 2) + '\n')
  return png
}
