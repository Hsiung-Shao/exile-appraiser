// 分享碼與範本:多頁勾選 + 數值 + 自訂文字 + 排除詞 ⇄ 字串。
//   ShareState = { v:1, game, mode, pages:{ pageId: [鍵] }, numeric:{ pageId:{ entryId:{min,max,choice} } }, custom:[], excludes:[] }
//   鍵:語料頁 = 英文第一行(與書籤相同,語言中性、跨賽季不變);演算法頁 = 項目 id。
//   分享碼 = JSON → gzip(CompressionStream,瀏覽器 / Electron / Node 18+ 都有)→ base64url(無填充)。
//   解碼:版本不符丟例外;未知欄位忽略並在 warnings 回報;型別不符的欄位丟掉並回報(不讓半壞的碼整個失敗)。
// 範本(data/regex/templates.json)用同一個形狀 + 雙語名稱與說明。
import type { Mode } from './gen'
import type { RegexGame, RegexPage } from './data'
import { applyPageKeys, sanitizeValue } from './pages'
import type { AlgoValue } from './pages/types'

export interface ShareState {
  v: 1
  game: RegexGame
  mode: Mode
  pages: Record<string, string[]>
  numeric: Record<string, Record<string, AlgoValue>>
  custom: string[]
  excludes: string[]
}

export const SHARE_VERSION = 1

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const KNOWN = new Set(['v', 'game', 'mode', 'pages', 'numeric', 'custom', 'excludes'])

function strList (v: unknown, where: string, warnings: string[]): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) { warnings.push(`${where} 不是陣列,已忽略`); return [] }
  const out = v.filter((x): x is string => typeof x === 'string')
  if (out.length !== v.length) warnings.push(`${where} 有 ${v.length - out.length} 個非字串值,已忽略`)
  return out
}

/**
 * 物件 → ShareState(驗證 + 清理)。`v` 必須是 1;game 必須是 poe1 / poe2;其餘欄位壞掉就丟掉並記 warning。
 * `requireVersion=false` 給範本檔用(範本沒有 v)。
 */
export function normalizeShareState (raw: unknown, requireVersion = true): { state: ShareState, warnings: string[] } {
  if (!isObj(raw)) throw new Error('分享碼內容不是物件')
  const warnings: string[] = []
  if (requireVersion && raw.v !== SHARE_VERSION) throw new Error(`分享碼版本不符(${String(raw.v)},本版只認 ${SHARE_VERSION})`)
  const game = raw.game
  if (game !== 'poe1' && game !== 'poe2') throw new Error(`分享碼的遊戲不明(${String(game)})`)
  let mode: Mode = 'any'
  if (raw.mode === 'any' || raw.mode === 'all' || raw.mode === 'none') mode = raw.mode
  else if (raw.mode !== undefined) warnings.push(`mode「${String(raw.mode)}」不認得,改用 any`)
  const pages: Record<string, string[]> = {}
  if (raw.pages !== undefined) {
    if (!isObj(raw.pages)) warnings.push('pages 不是物件,已忽略')
    else for (const [id, keys] of Object.entries(raw.pages)) pages[id] = strList(keys, `pages.${id}`, warnings)
  }
  const numeric: Record<string, Record<string, AlgoValue>> = {}
  if (raw.numeric !== undefined) {
    if (!isObj(raw.numeric)) warnings.push('numeric 不是物件,已忽略')
    else {
      for (const [pid, ents] of Object.entries(raw.numeric)) {
        if (!isObj(ents)) { warnings.push(`numeric.${pid} 不是物件,已忽略`); continue }
        const m: Record<string, AlgoValue> = {}
        for (const [eid, val] of Object.entries(ents)) {
          const v = sanitizeValue(val)
          if (v) m[eid] = v
          else warnings.push(`numeric.${pid}.${eid} 不是物件,已忽略`)
        }
        numeric[pid] = m
      }
    }
  }
  for (const k of Object.keys(raw)) if (!KNOWN.has(k) && !(k === 'id' || k === 'name' || k === 'desc')) warnings.push(`未知欄位「${k}」已忽略`)
  return {
    state: {
      v: 1,
      game,
      mode,
      pages,
      numeric,
      custom: strList(raw.custom, 'custom', warnings),
      excludes: strList(raw.excludes, 'excludes', warnings)
    },
    warnings
  }
}

// ---- gzip + base64url(不依賴 DOM 型別:透過 globalThis 取 CompressionStream / TextEncoder) ----

interface ByteStream {
  writable: { getWriter: () => { write: (b: Uint8Array) => Promise<void>, close: () => Promise<void> } }
  readable: { getReader: () => { read: () => Promise<{ done: boolean, value?: Uint8Array }> } }
}
type StreamCtor = new (format: string) => ByteStream
interface Codec { encode: (s: string) => Uint8Array }
interface Decoder { decode: (b: Uint8Array) => string }

function streamCtor (name: 'CompressionStream' | 'DecompressionStream'): StreamCtor {
  const C = (globalThis as unknown as Record<string, StreamCtor | undefined>)[name]
  if (!C) throw new Error(`這個環境沒有 ${name}`)
  return C
}

async function pipe (bytes: Uint8Array, ts: ByteStream): Promise<Uint8Array> {
  const w = ts.writable.getWriter()
  // 不 await 寫入(背壓下會等讀端),錯誤由讀端丟出;這裡吞掉避免 unhandled rejection
  w.write(bytes).catch(() => {})
  w.close().catch(() => {})
  const r = ts.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await r.read()
    if (done) break
    if (value) { chunks.push(value); total += value.length }
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function base64url (bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63]
    if (i + 2 < bytes.length) s += B64[n & 63]
  }
  return s
}

export function fromBase64url (s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const out: number[] = []
  let buf = 0
  let bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) throw new Error(`分享碼含有不合法字元「${ch}」`)
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 255)
    }
  }
  return Uint8Array.from(out)
}

function textEncoder (): Codec {
  const C = (globalThis as unknown as { TextEncoder: new () => Codec }).TextEncoder
  return new C()
}
function textDecoder (): Decoder {
  const C = (globalThis as unknown as { TextDecoder: new (l?: string, o?: { fatal: boolean }) => Decoder }).TextDecoder
  return new C('utf-8', { fatal: true })
}

export async function encodeShare (state: ShareState): Promise<string> {
  const doc: ShareState = {
    v: 1,
    game: state.game,
    mode: state.mode,
    pages: state.pages,
    numeric: state.numeric,
    custom: state.custom,
    excludes: state.excludes
  }
  const gz = await pipe(textEncoder().encode(JSON.stringify(doc)), new (streamCtor('CompressionStream'))('gzip'))
  return base64url(gz)
}

export async function decodeShare (code: string): Promise<{ state: ShareState, warnings: string[] }> {
  const text = code.trim()
  if (!text) throw new Error('分享碼是空的')
  let json: string
  try {
    json = textDecoder().decode(await pipe(fromBase64url(text), new (streamCtor('DecompressionStream'))('gzip')))
  } catch (e) {
    throw new Error(`分享碼無法解壓縮(${e instanceof Error ? e.message : String(e)})`)
  }
  let raw: unknown
  try { raw = JSON.parse(json) } catch { throw new Error('分享碼內容不是 JSON') }
  return normalizeShareState(raw, true)
}

// ---- 套用(分享碼 / 範本共用) ----

export interface ResolvedState {
  /** pageId → 勾選索引 */
  picks: Record<string, number[]>
  /** pageId → entryId → 值(只留存在的頁與項目) */
  values: Record<string, Record<string, AlgoValue>>
  /** 鍵還原不到的數量(跨賽季改了、或另一版資料) */
  missed: number
  /** 這個版本沒有的頁 id */
  unknownPages: string[]
}

/** ShareState → 目前清單上的勾選;只看同遊戲的頁 */
export function resolveState (s: ShareState, pages: readonly RegexPage[]): ResolvedState {
  const out: ResolvedState = { picks: {}, values: {}, missed: 0, unknownPages: [] }
  for (const [id, keys] of Object.entries(s.pages)) {
    const page = pages.find(p => p.id === id && p.game === s.game)
    if (!page) { out.unknownPages.push(id); out.missed += keys.length; continue }
    const r = applyPageKeys(page, keys)
    out.picks[id] = r.picked
    out.missed += r.missed
  }
  for (const [id, ents] of Object.entries(s.numeric)) {
    const page = pages.find(p => p.id === id && p.game === s.game)
    if (!page) { if (!out.unknownPages.includes(id)) out.unknownPages.push(id); continue }
    const m: Record<string, AlgoValue> = {}
    for (const [eid, v] of Object.entries(ents)) if (page.entries.some(e => e.id === eid)) m[eid] = { ...v }
    out.values[id] = m
  }
  return out
}

// ---- 範本 ----

export interface RegexTemplate {
  id: string
  game: RegexGame
  name: { zh: string, en: string }
  desc: { zh: string, en: string }
  state: ShareState
}

/** data/regex/templates.json → 範本清單;單筆壞掉只略過那筆(錯誤回報在 errors) */
export function parseTemplates (input: string | unknown): { templates: RegexTemplate[], errors: string[] } {
  const doc: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!isObj(doc) || !Array.isArray(doc.templates)) throw new Error('templates.json 缺少 templates 陣列')
  const templates: RegexTemplate[] = []
  const errors: string[] = []
  for (const t of doc.templates) {
    try {
      if (!isObj(t) || typeof t.id !== 'string' || !t.id) throw new Error('缺 id')
      const name = isObj(t.name) ? t.name : {}
      const desc = isObj(t.desc) ? t.desc : {}
      const { state, warnings } = normalizeShareState(t, false)
      if (warnings.length) throw new Error(warnings.join(';'))
      templates.push({
        id: t.id,
        game: state.game,
        name: { zh: String(name.zh ?? t.id), en: String(name.en ?? name.zh ?? t.id) },
        desc: { zh: String(desc.zh ?? ''), en: String(desc.en ?? desc.zh ?? '') },
        state
      })
    } catch (e) {
      errors.push(`範本 ${isObj(t) ? String(t.id) : '?'}:${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { templates, errors }
}
