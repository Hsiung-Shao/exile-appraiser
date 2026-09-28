// 移植自 Awakened PoE Trade `main/src/shortcuts/HostClipboard.ts`(MIT);
// 改動:Logger 換成 console、語言偵測表只留本專案支援的語系但保留上游其餘項目以免誤判。
import { clipboard, Clipboard } from 'electron'

const POLL_DELAY = 48
const POLL_LIMIT = 500

// PoE must read clipboard within this timeframe,
// after that we restore clipboard.
// If game lagged for some reason, it will read
// wrong content (= restored clipboard, potentially containing password).
const RESTORE_AFTER = 120

export class HostClipboard {
  private pollPromise?: Promise<string>
  private elapsed = 0
  private shouldRestore = false

  private isRestored = true

  get isPolling () { return this.pollPromise != null }

  updateOptions (restoreClipboard: boolean) {
    this.shouldRestore = restoreClipboard
  }

  async readItemText (): Promise<string> {
    this.elapsed = 0
    if (this.pollPromise) {
      return await this.pollPromise
    }

    let textBefore = clipboard.readText()
    if (isPoeItem(textBefore)) {
      textBefore = ''
      if (process.platform !== 'linux') {
        clipboard.writeText('')
      } else {
        clipboard.writeText(`__PPZ_FORCE_EMPTY_${Date.now()}`)
      }
    } else if (process.platform === 'linux') {
      clipboard.writeText(`__PPZ_FORCE_EMPTY_${Date.now()}`)
    }

    this.pollPromise = new Promise((resolve, reject) => {
      const poll = () => {
        const textAfter = clipboard.readText()

        if (isPoeItem(textAfter)) {
          if (this.shouldRestore) {
            clipboard.writeText(textBefore)
          }
          this.pollPromise = undefined
          resolve(textAfter)
        } else {
          this.elapsed += POLL_DELAY
          if (this.elapsed < POLL_LIMIT) {
            setTimeout(poll, POLL_DELAY)
          } else {
            if (this.shouldRestore) {
              clipboard.writeText(textBefore)
            }
            this.pollPromise = undefined
            console.warn('[ClipboardPoller] No item text found.')
            reject(new Error('Reading clipboard timed out'))
          }
        }
      }
      setTimeout(poll, POLL_DELAY)
    })

    return this.pollPromise
  }

  restoreShortly (cb: (clipboard: Clipboard) => void) {
    if (!this.isRestored) {
      return
    }

    this.isRestored = false
    const saved = clipboard.readText()
    cb(clipboard)
    setTimeout(() => {
      if (this.shouldRestore) {
        clipboard.writeText(saved)
      }
      this.isRestored = true
    }, RESTORE_AFTER)
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
