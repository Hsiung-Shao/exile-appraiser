/**
 * speedrun 計時器自動分段(2026-11-10):監看遊戲 Client.txt,只讀新增的行,送出「進入區域」事件。
 * 移植自 Awakened PoE Trade `main/src/host-files/GameLogWatcher.ts`(MIT):從檔尾開始、檔案變了就讀到 EOF。
 * 與上游不同:檔案 / 監看由呼叫端注入(測試用假檔);行以 Buffer 切(避免多位元組字被切在兩次讀之間);只轉送區域行。
 * 只讀檔、不送任何輸入;沒有 setTarget 就沒有監看(關著零成本)。
 */
import path from 'node:path'
import { parseAreaLine } from '../../core/src/speedrun/client-log'

export interface LogFile { size (): Promise<number>, read (buf: Buffer, position: number): Promise<number>, close (): Promise<void> }
export interface GameLogDeps {
  open (path: string): Promise<LogFile>
  /** 回傳取消監看 */
  watch (path: string, intervalMs: number, onChange: () => void): () => void
  onArea (e: { area: string, level: number }): void
  log? (msg: string): void
}

export const GAME_LOG_INTERVAL_MS = 250

export class GameLogWatcher {
  private readonly deps: GameLogDeps
  private state: { path: string, file: LogFile, offset: number, cancel: () => void, reading: boolean, again: boolean, rest: Buffer } | null = null
  /** 每次換目標遞增:舊目標的非同步讀取完成後不再送事件 */
  private gen = 0
  private readonly buf = Buffer.allocUnsafe(64 * 1024)

  constructor (deps: GameLogDeps) {
    this.deps = deps
  }

  get watching (): boolean { return this.state != null }
  get path (): string | null { return this.state?.path ?? null }

  /** `force` = 同一路徑也重開(遊戲附著時:Client.txt 可能被刪掉重建,舊 handle 讀不到新檔;審查 2026-11-10) */
  async setTarget (target: string | null, intervalMs = GAME_LOG_INTERVAL_MS, force = false): Promise<void> {
    if (!force && target === this.state?.path) return
    await this.stop()
    if (!target) return
    const gen = this.gen
    let file: LogFile
    try {
      file = await this.deps.open(target)
    } catch (e) {
      this.deps.log?.(`[speedrun] 打不開 Client.txt:${target}(${e instanceof Error ? e.message : String(e)})`)
      return
    }
    if (gen !== this.gen) { await file.close(); return }
    const offset = await file.size()
    const st = { path: target, file, offset, cancel: () => {}, reading: false, again: false, rest: Buffer.alloc(0) }
    this.state = st
    st.cancel = this.deps.watch(target, intervalMs, () => { void this.onChange(gen) })
    this.deps.log?.(`[speedrun] 監看 Client.txt:${target}(從 ${offset} 位元組開始)`)
  }

  async dispose (): Promise<void> {
    await this.stop()
  }

  private async stop (): Promise<void> {
    this.gen++
    const st = this.state
    if (!st) return
    this.state = null
    st.cancel()
    await st.file.close()
  }

  private async onChange (gen: number): Promise<void> {
    const st = this.state
    if (!st || gen !== this.gen) return
    if (st.reading) { st.again = true; return }
    st.reading = true
    try {
      do {
        st.again = false
        // 檔案被清空 / 截斷(比讀到的位置還小)→ 從頭讀(審查 2026-11-10)
        const size = await st.file.size()
        if (gen !== this.gen) return
        if (size < st.offset) {
          this.deps.log?.(`[speedrun] Client.txt 變小(${st.offset} → ${size}),從頭讀`)
          st.offset = 0
          st.rest = Buffer.alloc(0)
        }
        for (;;) {
          const n = await st.file.read(this.buf, st.offset)
          if (gen !== this.gen) return
          if (n <= 0) break
          st.offset += n
          this.consume(st, this.buf.subarray(0, n))
        }
      } while (st.again && gen === this.gen)
    } catch (e) {
      this.deps.log?.(`[speedrun] 讀 Client.txt 失敗:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      st.reading = false
    }
  }

  private consume (st: NonNullable<GameLogWatcher['state']>, chunk: Buffer): void {
    let data = st.rest.length ? Buffer.concat([st.rest, chunk]) : Buffer.from(chunk)
    let nl: number
    while ((nl = data.indexOf(0x0a)) >= 0) {
      const hit = parseAreaLine(data.subarray(0, nl).toString('utf8'))
      if (hit) this.deps.onArea(hit)
      data = data.subarray(nl + 1)
    }
    st.rest = Buffer.from(data)
  }
}

/** Client.txt 路徑:手動指定 > 執行中遊戲程式目錄的 `logs\Client.txt` > 預設安裝位置(存在才算) */
export function resolveClientLogPath (opts: { manual: string, processExes: string[], exists: (p: string) => boolean, defaults: string[] }): string | null {
  if (opts.manual.trim()) return opts.manual
  for (const exe of opts.processExes) {
    const p = path.win32.join(path.win32.dirname(exe), 'logs', 'Client.txt')
    if (opts.exists(p)) return p
  }
  return opts.defaults.find(p => opts.exists(p)) ?? null
}

/** 預設安裝位置(移植 APT POSSIBLE_PATH,Windows;PoE2 加獨立版 / Steam 資料夾名) */
export const DEFAULT_CLIENT_LOGS: Record<'poe1' | 'poe2', string[]> = {
  poe1: [
    'C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile\\logs\\Client.txt'
  ],
  poe2: [
    'C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt'
  ]
}
