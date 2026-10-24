// 移植自 Awakened PoE Trade `main/src/shortcuts/HostClipboard.ts`(MIT);
// 改動:Logger 換成 console、語言偵測表只留本專案支援的語系但保留上游其餘項目以免誤判。
// 2026-10-24 Electron 44 起主行程 `clipboard.readText()/writeText()` 回傳 Promise:整個檔改成非同步。
// - 讀物品文字拆成 `armItemRead()`(讀 before、清空剪貼簿)與 `pollItemText()`(輪詢),呼叫端必須等 arm 完成才送複製鍵,
//   否則晚到的清空會蓋掉遊戲剛複製的物品文字。工作階段在第一個 await 之前同步建立,同一時間重複呼叫共用同一個。
// - `restoreShortly` 的節流旗標在第一個 await 之前同步上鎖;cb 或剪貼簿讀寫失敗一律解鎖(舊版 cb 丟例外會永久鎖死)。
import { clipboard } from 'electron'

const POLL_DELAY = 48
const POLL_LIMIT = 500

// PoE must read clipboard within this timeframe,
// after that we restore clipboard.
// If game lagged for some reason, it will read
// wrong content (= restored clipboard, potentially containing password).
const RESTORE_AFTER = 120

/** 剪貼簿讀寫(Electron 44 起 `clipboard` 全面非同步;方法可回傳值或 Promise,測試用假物件) */
export interface ClipboardIO {
  readText (): string | Promise<string>
  writeText (text: string): void | Promise<void>
}

/** 一次「複製物品文字」的工作階段:arm 讀 before 並清空,poll 輪詢到物品文字或逾時 */
interface ReadSession {
  /** arm 讀到的原剪貼簿內容;undefined = 未知(沒有 arm 過),結束時不寫回,免得把使用者的剪貼簿蓋成空字串 */
  textBefore: string | undefined
  /** 逾時時間點(`Date.now()` 毫秒);重按複製鍵會延長 */
  deadline: number
  armed: Promise<void>
  poll?: Promise<string>
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

export class HostClipboard {
  private session?: ReadSession
  /** 上一次查價正在把 before 寫回:下一次 arm 要等它完成,否則會讀到還沒寫回的物品文字 */
  private pendingRestore?: Promise<void>
  private shouldRestore = false

  private isRestored = true

  constructor (private readonly io: ClipboardIO = clipboard) {}

  get isPolling () { return this.session != null }

  updateOptions (restoreClipboard: boolean) {
    this.shouldRestore = restoreClipboard
  }

  /**
   * 讀 before 並在它是物品文字時清空剪貼簿(之後才能分辨「遊戲新複製的」)。
   * 已有工作階段時只延長逾時並回傳同一個 arm。失敗時工作階段作廢(下次可重新開始)並把錯誤丟給呼叫端。
   */
  armItemRead (): Promise<void> {
    const existing = this.session
    if (existing) {
      existing.deadline = Date.now() + POLL_LIMIT
      return existing.armed
    }
    const s: ReadSession = { textBefore: undefined, deadline: Date.now() + POLL_LIMIT, armed: Promise.resolve() }
    this.session = s
    s.armed = this.arm(s).catch((e: unknown) => {
      if (this.session === s) this.session = undefined
      throw e
    })
    return s.armed
  }

  private async arm (s: ReadSession): Promise<void> {
    // 上一次查價的寫回還沒完成就讀,會把還沒被換掉的物品文字當成 before(之後還原成空字串)
    if (this.pendingRestore) await this.pendingRestore
    let textBefore = await this.io.readText()
    if (isPoeItem(textBefore)) {
      textBefore = ''
      await this.io.writeText(process.platform !== 'linux' ? '' : `__PPZ_FORCE_EMPTY_${Date.now()}`)
    } else if (process.platform === 'linux') {
      await this.io.writeText(`__PPZ_FORCE_EMPTY_${Date.now()}`)
    }
    s.textBefore = textBefore
  }

  /**
   * 等 arm 完成後輪詢(第 n 次讀取在 48×n ms),讀到物品文字回傳;逾時 reject。結束時依設定把 before 寫回。
   * 沒有 arm 過就盡力輪詢,但 before 未知(結束時不寫回)。
   */
  pollItemText (): Promise<string> {
    let s = this.session
    if (!s) {
      s = { textBefore: undefined, deadline: Date.now() + POLL_LIMIT, armed: Promise.resolve() }
      this.session = s
    }
    if (s.poll) return s.poll
    s.poll = this.pollLoop(s)
    return s.poll
  }

  private async pollLoop (s: ReadSession): Promise<string> {
    try {
      await s.armed
      s.deadline = Date.now() + POLL_LIMIT
      for (;;) {
        await sleep(POLL_DELAY)
        const textAfter = await this.io.readText()
        if (isPoeItem(textAfter)) {
          await this.finish(s)
          return textAfter
        }
        if (Date.now() >= s.deadline) {
          await this.finish(s)
          console.warn('[ClipboardPoller] No item text found.')
          throw new Error('Reading clipboard timed out')
        }
      }
    } finally {
      if (this.session === s) this.session = undefined
    }
  }

  /**
   * 結果已定(讀到物品或逾時):**先**把工作階段摘掉(之後再按熱鍵開新的,不會沿用舊 poll 而拿到上一件物品),
   * 再寫回 before;寫回期間登記為 `pendingRestore`,新的 arm 會等它完成。
   */
  private async finish (s: ReadSession): Promise<void> {
    if (this.session === s) this.session = undefined
    const p = this.restoreBefore(s)
    this.pendingRestore = p
    try {
      await p
    } finally {
      if (this.pendingRestore === p) this.pendingRestore = undefined
    }
  }

  /** 還原失敗只記 log,不蓋掉讀到的物品文字或逾時的結果;before 未知時不寫 */
  private async restoreBefore (s: ReadSession): Promise<void> {
    if (!this.shouldRestore || s.textBefore === undefined) return
    try {
      await this.io.writeText(s.textBefore)
    } catch (e) {
      console.warn('[ClipboardPoller] 還原剪貼簿失敗', e)
    }
  }

  async readItemText (): Promise<string> {
    await this.armItemRead()
    return await this.pollItemText()
  }

  /**
   * 120 ms 內不重入(防遊戲「Too many actions」):`cb` 完成後再等 `RESTORE_AFTER` ms,依設定把原內容寫回,寫完才解鎖。
   * 上鎖期間再呼叫直接略過;cb 或讀剪貼簿失敗 → 立刻解鎖並把錯誤傳回呼叫端。
   */
  async restoreShortly (cb: (io: Pick<ClipboardIO, 'writeText'>) => void | Promise<void>): Promise<void> {
    if (!this.isRestored) {
      return
    }

    this.isRestored = false
    let saved: string
    try {
      saved = await this.io.readText()
      await cb(this.io)
    } catch (e) {
      this.isRestored = true
      throw e
    }
    setTimeout(() => { void this.finishRestore(saved) }, RESTORE_AFTER)
  }

  private async finishRestore (saved: string): Promise<void> {
    try {
      if (this.shouldRestore) {
        await this.io.writeText(saved)
      }
    } catch (e) {
      console.warn('[HostClipboard] 還原剪貼簿失敗', e)
    } finally {
      this.isRestored = true
    }
  }
}

export function isPoeItem (text: string) {
  return LANGUAGE_DETECTOR.find(({ firstLine }) => text.startsWith(firstLine))
}

const LANGUAGE_DETECTOR = [
  { lang: 'en', firstLine: 'Item Class: ' },
  { lang: 'ru', firstLine: 'Класс предмета: ' },
  { lang: 'fr', firstLine: 'Classe d\'objet: ' },
  { lang: 'de', firstLine: 'Gegenstandsklasse: ' },
  { lang: 'pt', firstLine: 'Classe do Item: ' },
  { lang: 'es', firstLine: 'Clase de objeto: ' },
  { lang: 'th', firstLine: 'ชนิดไอเทม: ' },
  { lang: 'ko', firstLine: '아이템 종류: ' },
  { lang: 'cmn-Hant', firstLine: '物品種類: ' },
  { lang: 'cmn-Hans', firstLine: '物品类别: ' },
  // PoE2(照 Exiled Exchange 2 的 uncutSkillGemLine):未切割技能寶石的剪貼簿沒有「物品種類」行,直接從稀有度開始
  { lang: 'en', firstLine: 'Rarity: ' },
  { lang: 'cmn-Hant', firstLine: '稀有度: ' }
]
