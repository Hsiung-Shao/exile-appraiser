/**
 * 設定頁熱鍵欄位下方的問題文字(熱鍵總表、倉庫與聊天分頁、正則書籤共用)。
 * 三種來源,依序:遊戲保留鍵 / 與前面的熱鍵重複(`hotkey-conflicts.ts`,與 main 註冊規則相同,涵蓋**全部**熱鍵欄位)
 * → main 回報被其他程式佔用(`hotkeyRegistration` 錯誤字串裡引號內的鍵)。
 * 對不回任何欄位的 main 錯誤由 `otherError` 給熱鍵卡片底部顯示。
 * 第 16 步:褻瀆 / 符文暫停鍵相同不算問題(`issueText` 回空),改由 `sharedText` 給提示「與…共用,一次切換兩者」。
 * 第 33 步:正則書籤快速面板 / 書籤個別熱鍵也在表內(書籤熱鍵從 `regex/bookmark-hotkeys.ts` 來,只算目前遊戲的)。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, hotkeyRegistration } from '@/web/Config'
import { hotkeyIssues, hotkeySlots, normalizeHotkey } from './hotkey-conflicts'
import { regexBookmarkHotkeyList } from '@/web/regex/bookmark-hotkeys'

/** 衝突對象的顯示名稱(i18n 鍵) */
const SLOT_LABEL: Record<string, string> = {
  quick: 'ppz.hotkey',
  locked: 'ppz.hotkey_locked',
  overlay: 'ppz.overlay_key',
  ocr: 'ppz.scan.slot_reveal_pause',
  region: 'ppz.scan.slot_reveal_region',
  runeshape: 'ppz.scan.slot_rune_pause',
  runeRegion: 'ppz.scan.slot_rune_region',
  regexQuick: 'ppz.regex.quick_hotkey'
}

export function useHotkeyIssues () {
  const { t } = useI18n()
  const config = AppConfig()
  const slots = computed(() => hotkeySlots({ ...config, regexBookmarkHotkeys: regexBookmarkHotkeyList.value }))
  const issues = computed(() => hotkeyIssues(slots.value))
  /** main 回報被其他程式佔用的熱鍵(錯誤字串裡引號內的鍵) */
  const takenKeys = computed(() => {
    const reg = hotkeyRegistration.value
    if (!reg || reg.ok || !reg.error) return [] as string[]
    return [...reg.error.matchAll(/"([^"]+)"/g)].map(m => m[1])
  })
  const quote = (s: string) => config.uiLanguage === 'en' ? `"${s}"` : `「${s}」`
  function slotName (id: string): string {
    const rx = /^rxbm:(\d+)$/.exec(id)
    if (rx) {
      const b = regexBookmarkHotkeyList.value.find(x => x.index === Number(rx[1]))
      return quote((b?.name ?? '').slice(0, 24))
    }
    const m = /^(cmd|stash):(\d+)$/.exec(id)
    if (m) {
      const n = Number(m[2])
      const text = m[1] === 'cmd' ? config.commands[n]?.text : config.stashSearch[n]?.text
      return quote((text ?? '').slice(0, 24))
    }
    return quote(t(SLOT_LABEL[id] ?? id))
  }
  /** 欄位 `id`(`hotkey-conflicts.ts` 的 slot id)目前填的 `hotkey` 有什麼問題;沒有 → '' */
  function issueText (id: string, hotkey: string): string {
    const is = issues.value.get(id)
    if (is?.kind === 'reserved') return t('ppz.chat.issue_reserved', { key: is.key })
    if (is?.kind === 'duplicate') return t('ppz.chat.issue_duplicate', { key: is.key, other: slotName(is.with) })
    if (hotkey && takenKeys.value.includes(normalizeHotkey(hotkey))) return t('ppz.hotkey_conflict', { key: normalizeHotkey(hotkey) })
    return ''
  }
  /** 第 16 步:欄位與另一個辨識的暫停鍵共用(合併成一個動作)→ 提示文字;沒有 → '' */
  function sharedText (id: string): string {
    const is = issues.value.get(id)
    if (is?.kind !== 'shared') return ''
    return t(is.with === 'runeshape' ? 'ppz.scan.shared_with_rune' : 'ppz.scan.shared_with_reveal')
  }
  /** main 的註冊錯誤裡沒有任何一個鍵對得回目前的欄位 → 整句顯示在熱鍵卡片底部 */
  const otherError = computed(() => {
    const reg = hotkeyRegistration.value
    if (!reg || reg.ok || !reg.error) return ''
    const mine = new Set(slots.value.map(s => s.hotkey).filter(Boolean))
    return takenKeys.value.some(k => mine.has(k)) ? '' : reg.error
  })
  return { issueText, sharedText, otherError, slotName }
}
