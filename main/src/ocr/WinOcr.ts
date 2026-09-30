/**
 * exile-appraiser(WP-S):常駐 PowerShell 5.1 + WinRT OCR 行程的用戶端(不依賴 Electron)。
 *
 * - 腳本 = `win-ocr.ps1`(main 由 esbuild text loader 內嵌,見 `script.ts`;`scripts/ocr-fixture.mjs` 讀同一個檔),
 *   以 `-EncodedCommand` 傳入(stdin 留給資料;`-Command -` 會把 stdin 當腳本)。
 * - 協定:stdin 一行 `{"id","image":base64(JPEG/PNG)}` / `{"id","path"}` → stdout 一行 `{"id","ms","w","h","lines":[…]}` 或 `{"id","error"}`;
 *   啟動先回 `{"ready":true,…}` 或 `{"error":"lang-missing",…}`。細節見 win-ocr.ps1 檔頭。
 * - 請求一次一個(行程本來就循序處理);逾時(預設 8 秒)→ 殺掉行程,下一次呼叫自動重啟;行程崩潰同樣。
 * - 缺語言包(`lang-missing`)記住結果 30 秒,避免每按一次熱鍵就 spawn 一次 PowerShell。
 *
 * ⚠ 本檔只能用「可抹除」的 TS 語法(不用 enum、參數屬性):`scripts/ocr-fixture.mjs` 以 Node 24 原生型別剝除直接 import 它。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface OcrWord {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrLine extends OcrWord {
  words: OcrWord[]
}

export interface OcrResult {
  /** OCR 本身的毫秒數(行程內量測;不含傳輸) */
  ms: number
  /** 送進去那張圖的像素大小(座標系) */
  w: number
  h: number
  lines: OcrLine[]
}

export interface OcrReady {
  ready: true
  lang: string
  langs: string[]
  maxDim: number
}

export type OcrErrorKind = 'lang-missing' | 'unsupported-platform' | 'spawn-failed' | 'timeout' | 'crashed' | 'ocr-failed'

export class OcrError extends Error {
  readonly kind: OcrErrorKind
  readonly langs?: string[]
  constructor (kind: OcrErrorKind, message: string, langs?: string[]) {
    super(message)
    this.kind = kind
    this.langs = langs
  }
}

export interface WinOcrOptions {
  /** 單張逾時(ms);預設 8000 */
  timeoutMs?: number
  /** 啟動(載入 WinRT + 建 OcrEngine)逾時;預設 15000(防毒掃描 PowerShell 時第一次可能很慢) */
  startTimeoutMs?: number
  /** OCR 語言;預設 zh-Hant-TW */
  lang?: string
  /** 閒置多久自動結束行程(ms);0 = 不自動結束(預設) */
  idleMs?: number
  log?: (msg: string) => void
}

/** 去掉整行註解後轉 UTF-16LE base64(`-EncodedCommand` 的格式;命令列上限 32767 字元)。 */
export function encodeScript (script: string): string {
  const body = script
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter(l => !/^\s*#/.test(l))
    .join('\n')
  return Buffer.from(body, 'utf16le').toString('base64')
}

interface Pending {
  resolve: (r: OcrResult) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const LANG_MISSING_TTL_MS = 30_000

export class WinOcr {
  private readonly script: string
  private readonly opts: Required<Omit<WinOcrOptions, 'log'>> & { log: (msg: string) => void }
  private proc: ChildProcessWithoutNullStreams | null = null
  private readyPromise: Promise<OcrReady> | null = null
  private pending = new Map<string, Pending>()
  private seq = 0
  private chain: Promise<unknown> = Promise.resolve()
  private langMissing: { at: number, error: OcrError } | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor (script: string, opts: WinOcrOptions = {}) {
    this.script = script
    this.opts = {
      timeoutMs: opts.timeoutMs ?? 8000,
      startTimeoutMs: opts.startTimeoutMs ?? 15000,
      lang: opts.lang ?? 'zh-Hant-TW',
      idleMs: opts.idleMs ?? 0,
      log: opts.log ?? ((m) => { console.log(m) })
    }
  }

  get running (): boolean { return this.proc != null }

  /** 啟動(或沿用)行程;resolve = 語言包可用。 */
  start (): Promise<OcrReady> {
    if (this.readyPromise) return this.readyPromise
    if (process.platform !== 'win32') {
      return Promise.reject(new OcrError('unsupported-platform', 'Windows OCR 只在 Windows 上可用'))
    }
    if (this.langMissing && Date.now() - this.langMissing.at < LANG_MISSING_TTL_MS) {
      return Promise.reject(this.langMissing.error)
    }
    const t0 = Date.now()
    const env: NodeJS.ProcessEnv = { ...process.env, EXILE_OCR_LANG: this.opts.lang }
    delete env.ELECTRON_RUN_AS_NODE
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeScript(this.script)], {
        windowsHide: true,
        env
      })
    } catch (e) {
      return Promise.reject(new OcrError('spawn-failed', (e as Error).message))
    }
    this.proc = proc
    const p = new Promise<OcrReady>((resolve, reject) => {
      let settled = false
      const startTimer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new OcrError('timeout', `OCR 行程 ${this.opts.startTimeoutMs} ms 內沒有就緒`))
        this.kill('start timeout')
      }, this.opts.startTimeoutMs)
      let buf = ''
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        buf += chunk
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const raw = buf.slice(0, nl).replace(/^﻿/, '').trim()
          buf = buf.slice(nl + 1)
          if (!raw) continue
          let msg: any
          try { msg = JSON.parse(raw) } catch {
            this.opts.log(`[ocr] 非 JSON 輸出:${raw.slice(0, 200)}`)
            continue
          }
          if (!settled && msg.ready === true) {
            settled = true
            clearTimeout(startTimer)
            this.opts.log(`[ocr] 行程就緒 lang=${msg.lang} langs=${(msg.langs ?? []).join(',')}(${Date.now() - t0} ms)`)
            resolve(msg as OcrReady)
            continue
          }
          if (!settled && msg.error) {
            settled = true
            clearTimeout(startTimer)
            const err = new OcrError(msg.error === 'lang-missing' ? 'lang-missing' : 'spawn-failed', String(msg.error), msg.langs)
            if (err.kind === 'lang-missing') this.langMissing = { at: Date.now(), error: err }
            this.opts.log(`[ocr] 無法啟動:${msg.error} 已安裝 ${(msg.langs ?? []).join(',') || '(無)'}`)
            reject(err)
            continue
          }
          this.onResponse(msg)
        }
      })
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        const s = chunk.trim()
        if (s) this.opts.log(`[ocr] stderr: ${s.slice(0, 500)}`)
      })
      proc.on('error', (e) => {
        if (!settled) {
          settled = true
          clearTimeout(startTimer)
          reject(new OcrError('spawn-failed', e.message))
        }
        this.onExit(`error ${e.message}`)
      })
      proc.on('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(startTimer)
          reject(new OcrError('crashed', `OCR 行程在就緒前結束(exit ${code})`))
        }
        this.onExit(`exit ${code}`)
      })
    })
    this.readyPromise = p
    p.catch(() => { if (this.proc === proc) this.kill('start failed') })
    return p
  }

  private onResponse (msg: any) {
    const id = String(msg.id ?? '')
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new OcrError('ocr-failed', String(msg.error)))
    else p.resolve({ ms: msg.ms, w: msg.w, h: msg.h, lines: msg.lines ?? [] })
  }

  private onExit (reason: string) {
    if (this.proc) this.opts.log(`[ocr] 行程結束(${reason})`)
    this.proc = null
    this.readyPromise = null
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new OcrError('crashed', `OCR 行程結束(${reason})`))
      this.pending.delete(id)
    }
  }

  private kill (reason: string) {
    const proc = this.proc
    if (!proc) return
    this.opts.log(`[ocr] 結束行程(${reason})`)
    try { proc.kill() } catch {}
    this.onExit(reason)
  }

  /** 語言包是否可用(會視需要啟動行程)。 */
  async available (): Promise<{ ok: true, lang: string, langs: string[] } | { ok: false, error: OcrErrorKind, langs?: string[], message: string }> {
    try {
      const r = await this.start()
      this.armIdle()
      return { ok: true, lang: r.lang, langs: r.langs }
    } catch (e) {
      const err = e instanceof OcrError ? e : new OcrError('spawn-failed', String(e))
      return { ok: false, error: err.kind, langs: err.langs, message: err.message }
    }
  }

  /** `image` = BitmapDecoder 認得的編碼影像(JPEG / PNG) */
  recognize (image: Buffer): Promise<OcrResult> {
    return this.enqueue({ image: image.toString('base64') })
  }

  recognizeFile (file: string): Promise<OcrResult> {
    return this.enqueue({ path: file })
  }

  private enqueue (payload: { image?: string, path?: string }): Promise<OcrResult> {
    const run = async (): Promise<OcrResult> => {
      await this.start()
      const proc = this.proc
      if (!proc) throw new OcrError('crashed', 'OCR 行程不在')
      const id = String(++this.seq)
      return await new Promise<OcrResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!this.pending.has(id)) return
          this.pending.delete(id)
          reject(new OcrError('timeout', `OCR 逾時(${this.opts.timeoutMs} ms)`))
          this.kill('request timeout')
        }, this.opts.timeoutMs)
        this.pending.set(id, { resolve, reject, timer })
        proc.stdin.write(JSON.stringify({ id, ...payload }) + '\n')
      })
    }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => {})
    void this.chain.then(() => { this.armIdle() })
    return next
  }

  private armIdle () {
    if (!this.opts.idleMs || this.pending.size) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.pending.size && this.proc) this.close('idle')
    }, this.opts.idleMs)
    this.idleTimer.unref?.()
  }

  close (reason = 'close') {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
    const proc = this.proc
    if (!proc) return
    try { proc.stdin.end() } catch {}
    this.kill(reason)
  }
}
