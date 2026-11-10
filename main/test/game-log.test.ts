// Client.txt 監看(只讀新增內容、半行補完)與路徑推測。假記憶體檔 + 假 watch(手動觸發),不碰真檔案、不啟動 Electron。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { GameLogWatcher, resolveClientLogPath, type LogFile } from '../src/game-log'

const AREA = (id: string, lv = 60) => `2025/07/18 22:59:37 2784078 1186a064 [DEBUG Client 28660] Generating level ${lv} area "${id}" with seed 1`
const CHAT = '2025/07/18 22:59:40 2787000 1186a064 [INFO Client 123] @From someone: hi'

/** 會長大的記憶體檔 */
function memFile (initial = '') {
  let data = Buffer.from(initial, 'utf8')
  const state = { closed: 0 }
  const file: LogFile = {
    size: async () => data.length,
    read: async (buf, position) => {
      if (position >= data.length) return 0
      const n = Math.min(buf.length, data.length - position)
      data.copy(buf, 0, position, position + n)
      return n
    },
    close: async () => { state.closed++ }
  }
  return { file, state, append: (s: string) => { data = Buffer.concat([data, Buffer.from(s, 'utf8')]) } }
}

function setup (initial = '') {
  const mem = memFile(initial)
  const events: Array<{ area: string, level: number }> = []
  const watches: Array<{ path: string, interval: number, onChange: () => void, cancel: ReturnType<typeof vi.fn> }> = []
  const open = vi.fn(async (_p: string) => mem.file)
  const watcher = new GameLogWatcher({
    open,
    watch: (path, interval, onChange) => {
      const cancel = vi.fn()
      watches.push({ path, interval, onChange, cancel })
      return cancel
    },
    onArea: e => events.push(e)
  })
  // 觸發 onChange 並等非同步讀取跑完
  const fire = async (i = watches.length - 1) => {
    watches[i].onChange()
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
  }
  return { mem, events, watches, open, watcher, fire }
}

describe('GameLogWatcher', () => {
  it('S11 只讀 setTarget 之後新增的內容:舊行不送、整行送一個、半行等補完再送', async () => {
    const { mem, events, watcher, fire } = setup(AREA('1_1_town') + '\n')
    await watcher.setTarget('C:\\log\\Client.txt', 250)
    expect(events).toEqual([])

    mem.append(AREA('2_8_town') + '\n' + AREA('G2_town', 12).slice(0, 40))
    await fire()
    expect(events).toEqual([{ area: '2_8_town', level: 60 }])

    mem.append(AREA('G2_town', 12).slice(40) + '\n')
    await fire()
    expect(events).toEqual([{ area: '2_8_town', level: 60 }, { area: 'G2_town', level: 12 }])
    expect(events.some(e => e.area === '1_1_town')).toBe(false)
  })

  it('S11 非區域行(聊天)與 CRLF 行尾:聊天不送、帶 \\r 的區域行照送', async () => {
    const { mem, events, watcher, fire } = setup()
    await watcher.setTarget('C:\\log\\Client.txt')
    mem.append(CHAT + '\r\n' + AREA('1_3_town', 15) + '\r\n')
    await fire()
    expect(events).toEqual([{ area: '1_3_town', level: 15 }])
  })

  it('S11 沒有新增內容時觸發 onChange 不重複送出', async () => {
    const { mem, events, watcher, fire } = setup()
    await watcher.setTarget('C:\\log\\Client.txt')
    mem.append(AREA('1_2_town') + '\n')
    await fire()
    await fire()
    await fire()
    expect(events.length).toBe(1)
  })

  it('S11 一次追加多行區域行 → 依序全部送出', async () => {
    const { mem, events, watcher, fire } = setup()
    await watcher.setTarget('C:\\log\\Client.txt')
    mem.append(AREA('1_2_town') + '\n' + CHAT + '\n' + AREA('1_3_town') + '\n')
    await fire()
    expect(events.map(e => e.area)).toEqual(['1_2_town', '1_3_town'])
  })

  it('S11 把間隔與路徑交給 watch', async () => {
    const { watches, watcher } = setup()
    await watcher.setTarget('C:\\log\\Client.txt', 250)
    expect(watches.length).toBe(1)
    expect(watches[0].path).toBe('C:\\log\\Client.txt')
    expect(watches[0].interval).toBe(250)
    expect(watcher.watching).toBe(true)
  })

  it('S12 從沒 setTarget 之前不呼叫 watch / open,watching 為 false', () => {
    const { watches, open, watcher } = setup()
    expect(watches.length).toBe(0)
    expect(open).not.toHaveBeenCalled()
    expect(watcher.watching).toBe(false)
  })

  it('S12 setTarget(null) → 取消監看、關檔、watching false', async () => {
    const { mem, watches, watcher } = setup()
    await watcher.setTarget('C:\\log\\Client.txt')
    await watcher.setTarget(null)
    expect(watches[0].cancel).toHaveBeenCalledTimes(1)
    expect(mem.state.closed).toBe(1)
    expect(watcher.watching).toBe(false)
  })

  it('S12 dispose → 取消監看、關檔、watching false', async () => {
    const { mem, watches, watcher } = setup()
    await watcher.setTarget('C:\\log\\Client.txt')
    await watcher.dispose()
    expect(watches[0].cancel).toHaveBeenCalledTimes(1)
    expect(mem.state.closed).toBe(1)
    expect(watcher.watching).toBe(false)
  })

  it('S12 停止後即使舊的 onChange 再被觸發,也不再送事件', async () => {
    const { mem, events, watches, watcher } = setup()
    await watcher.setTarget('C:\\log\\Client.txt')
    await watcher.setTarget(null)
    mem.append(AREA('1_2_town') + '\n')
    watches[0].onChange()
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(events).toEqual([])
  })

  it('S12 換路徑:先取消並關掉舊的,再監看新的', async () => {
    const { mem, watches, open, watcher } = setup()
    await watcher.setTarget('C:\\a\\Client.txt')
    await watcher.setTarget('C:\\b\\Client.txt')
    expect(watches.length).toBe(2)
    expect(watches[0].cancel).toHaveBeenCalledTimes(1)
    expect(watches[1].cancel).not.toHaveBeenCalled()
    expect(mem.state.closed).toBe(1)
    expect(open).toHaveBeenCalledTimes(2)
    expect(watches[1].path).toBe('C:\\b\\Client.txt')
    expect(watcher.watching).toBe(true)
  })

  it('S12 重複 dispose / setTarget(null) 不會重複取消或關檔', async () => {
    const { mem, watches, watcher } = setup()
    await watcher.setTarget('C:\\log\\Client.txt')
    await watcher.dispose()
    await watcher.dispose()
    await watcher.setTarget(null)
    expect(watches[0].cancel).toHaveBeenCalledTimes(1)
    expect(mem.state.closed).toBe(1)
  })
})

describe('resolveClientLogPath', () => {
  const exe1 = 'E:\\Grinding Gear Games\\Path of Exile\\PathOfExile_x64.exe'
  const log1 = 'E:\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt'
  const exe2 = 'D:\\Steam\\steamapps\\common\\Path of Exile 2\\PathOfExileSteam.exe'
  const log2 = 'D:\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt'
  const defLog = 'C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt'
  const mkExists = (...ps: string[]) => (p: string) => ps.includes(p)

  it('S13 手動路徑優先,連 exists 都不看', () => {
    expect(resolveClientLogPath({ manual: 'Z:\\my\\Client.txt', processExes: [exe1], exists: mkExists(log1), defaults: [defLog] }))
      .toBe('Z:\\my\\Client.txt')
  })

  it('S13 手動只有空白 → 視為沒填,走程序目錄', () => {
    expect(resolveClientLogPath({ manual: '   ', processExes: [exe1], exists: mkExists(log1), defaults: [] })).toBe(log1)
  })

  it('S13 沒有手動:程序所在目錄的 logs\\Client.txt(存在才算)', () => {
    expect(resolveClientLogPath({ manual: '', processExes: [exe1], exists: mkExists(log1), defaults: [defLog] })).toBe(log1)
  })

  it('S13 第一個程序的 log 不存在 → 取第一個存在的程序', () => {
    expect(resolveClientLogPath({ manual: '', processExes: [exe1, exe2], exists: mkExists(log2), defaults: [] })).toBe(log2)
  })

  it('S13 程序目錄都沒有 → defaults 裡第一個存在的', () => {
    const d1 = 'C:\\nope\\Client.txt'
    expect(resolveClientLogPath({ manual: '', processExes: [exe1], exists: mkExists(defLog), defaults: [d1, defLog] })).toBe(defLog)
    expect(resolveClientLogPath({ manual: '', processExes: [], exists: mkExists(defLog), defaults: [d1, defLog] })).toBe(defLog)
  })

  it('S13 程序目錄與 defaults 都有時,程序目錄優先', () => {
    expect(resolveClientLogPath({ manual: '', processExes: [exe1], exists: mkExists(log1, defLog), defaults: [defLog] })).toBe(log1)
  })

  it('S13 全部都不存在 → null', () => {
    expect(resolveClientLogPath({ manual: '', processExes: [exe1, exe2], exists: () => false, defaults: [defLog] })).toBeNull()
    expect(resolveClientLogPath({ manual: '', processExes: [], exists: () => false, defaults: [] })).toBeNull()
  })
})

describe('審查修正(2026-11-10)', () => {
  it('Client.txt 被清空後再寫入:從頭讀,新區域行照送', async () => {
    let data = Buffer.from(AREA('1_1_town') + '\n' + AREA('1_2_town') + '\n', 'utf8')
    const file: LogFile = {
      size: async () => data.length,
      read: async (buf, position) => {
        if (position >= data.length) return 0
        const n = Math.min(buf.length, data.length - position)
        data.copy(buf, 0, position, position + n)
        return n
      },
      close: async () => {}
    }
    const events: Array<{ area: string, level: number }> = []
    let onChange = () => {}
    const w = new GameLogWatcher({ open: async () => file, watch: (_p, _i, cb) => { onChange = cb; return () => {} }, onArea: e => events.push(e) })
    await w.setTarget('C:\\log\\Client.txt')
    data = Buffer.from(AREA('G2_town', 12) + '\n', 'utf8')
    onChange()
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(events).toEqual([{ area: 'G2_town', level: 12 }])
  })

  it('force:同一路徑也重開(遊戲附著時舊 handle 可能指向已刪掉的檔)', async () => {
    const open = vi.fn(async () => ({ size: async () => 0, read: async () => 0, close: async () => {} }) as LogFile)
    const w = new GameLogWatcher({ open, watch: () => () => {}, onArea: () => {} })
    await w.setTarget('C:\\log\\Client.txt')
    await w.setTarget('C:\\log\\Client.txt')
    expect(open).toHaveBeenCalledTimes(1)
    await w.setTarget('C:\\log\\Client.txt', undefined, true)
    expect(open).toHaveBeenCalledTimes(2)
  })
})

describe('main.ts 接線(使用者 2026-11-10 裁定)', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/main.ts'), 'utf8')
  const block = src.slice(src.indexOf('const syncGameLog'), src.indexOf("app.on('will-quit', () => { void gameLog.dispose() })"))
  it('遊戲沒附著就停止監看(狀態 no-game),遊戲關掉時重新判斷', () => {
    expect(block).toMatch(/if \(!gameAttached\) \{[\s\S]*?reason: 'no-game'[\s\S]*?setTarget\(null\)/)
    expect(block).toMatch(/poeWindow\?\.onDetach\(\(\) => \{ syncGameLog\(\) \}\)/)
  })
  it('先用 overlay 綁定的視窗標題找遊戲程式,標題經環境變數傳、不拼進指令', () => {
    expect(src).toMatch(/MainWindowTitle -eq \$env:PPZ_GAME_TITLE/)
    expect(src).toMatch(/PPZ_GAME_TITLE: windowTitleFor\(cfg, cfg\.game\)/)
  })
})
