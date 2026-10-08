/**
 * 第 33 步(2026-10-04,使用者裁定):正則書籤快捷存取 —— 書籤 → 搜尋字串 → 複製 + 貼進遊戲。
 *
 * 三個入口共用:設定視窗旁的書籤列(`RegexBookmarkBar.vue`,source `bar`)、熱鍵叫出的小面板(`RegexQuickPanel.vue`,`quick`)、
 * 書籤個別熱鍵(main `regex-bookmark-run` → `runRegexBookmarkFromHotkey`,`hotkey`)。
 * - 字串:`regex/src/quick.ts` `bookmarkQuery`(= 載入書籤後的單頁輸出;不動目前的勾選)。清單第一次用到才載(`catalogueFor`)。
 * - 送出:Electron → main `regex-paste`(能貼就交還焦點 → Ctrl+F → 貼上 → Enter;不能貼只複製並回原因,`main/src/regex-paste.ts`)。
 *   瀏覽器預覽 / 純瀏覽器 → 這裡用 `navigator.clipboard` 只複製(`preview`)。
 * - 一次一個(`running`):執行中再點 / 再按 = 忽略(main 另有同樣的保護)。
 */
import { shallowRef } from 'vue'
import { bookmarkQuery, findBookmark } from '@exile-appraiser/regex'
import type { RegexBookmarkRunEvent, RegexPasteSource } from '@ipc/types'
import { Host } from '@/web/background/IPC'
import { catalogueFor, ensureStateLoaded, useRegexStore } from './store'
import type { QuickOutcome } from './quick-geom'

/** 執行中(畫面上顯示「輸入中…」;同時只跑一個) */
export const quickRunning = shallowRef(false)

async function copyInBrowser (text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    console.warn('[regex-quick] 瀏覽器複製失敗', e)
    return false
  }
}

/** 書籤 → 字串(找不到書籤 / 頁 / 清單載入失敗 = null) */
async function queryOf (index: number): Promise<{ text: string, name: string } | null> {
  const store = useRegexStore()
  const b = store.ui.bookmarks[index]
  if (!b || !b.game) return null
  // 第 37 步:物品詞綴數值頁的書籤要先載入那一頁(第一次用到才讀 stats.ndjson)
  const cat = await catalogueFor(b.game, b.page)
  if (!cat) return null
  const q = bookmarkQuery(cat.pages, b)
  if (!q) return null
  if (q.missed > 0) console.warn(`[regex-quick] 書籤「${b.name}」有 ${q.missed} 個鍵還原不到(賽季資料改了)`)
  return { text: q.query, name: b.name }
}

/** 執行書籤(書籤列 / 快速面板);回傳結果給畫面顯示提示 */
export async function runRegexBookmark (index: number, source: RegexPasteSource): Promise<QuickOutcome> {
  if (quickRunning.value) return { pasted: false, copied: false, reason: 'busy' }
  quickRunning.value = true
  try {
    await ensureStateLoaded()
    const q = await queryOf(index)
    if (!q) return { pasted: false, copied: false, reason: 'missing' }
    if (!q.text) return { pasted: false, copied: false, reason: 'empty' }
    if (Host.canRegexPaste) {
      const r = await Host.regexPaste({ text: q.text, name: q.name, source })
      if (r) return r.pasted ? { pasted: true, copied: true } : { pasted: false, copied: r.copied, reason: r.reason }
    }
    const copied = await copyInBrowser(q.text)
    return { pasted: false, copied, reason: copied ? 'preview' : 'copy-failed' }
  } catch (e) {
    console.error('[regex-quick] 執行書籤失敗', e)
    return { pasted: false, copied: false, reason: 'missing' }
  } finally {
    quickRunning.value = false
  }
}

/**
 * 2026-10-08 懸浮選單:另一代的書籤只複製,不貼(貼進不是那款的遊戲沒有意義)。字串與貼上相同(`bookmarkQuery`)。
 */
export async function copyRegexBookmark (index: number): Promise<QuickOutcome> {
  if (quickRunning.value) return { pasted: false, copied: false, reason: 'busy' }
  quickRunning.value = true
  try {
    await ensureStateLoaded()
    const q = await queryOf(index)
    if (!q) return { pasted: false, copied: false, reason: 'missing' }
    if (!q.text) return { pasted: false, copied: false, reason: 'empty' }
    const copied = await copyInBrowser(q.text)
    return { pasted: false, copied, reason: copied ? 'other-game' : 'copy-failed' }
  } catch (e) {
    console.error('[regex-quick] 複製書籤失敗', e)
    return { pasted: false, copied: false, reason: 'missing' }
  } finally {
    quickRunning.value = false
  }
}

/** 懸浮選單書籤列下方的字串預覽(找不到 / 載入失敗 = '';清單第一次用到才載) */
export async function regexBookmarkPreview (index: number): Promise<string> {
  try {
    return (await queryOf(index))?.text ?? ''
  } catch {
    return ''
  }
}

/**
 * 書籤個別熱鍵(main 已註冊、遊戲在前景):找回書籤 → 字串 → `regex-paste`(source `hotkey`)。
 * 沒貼成的提示由 main 畫在右下角提示視窗(overlay 此時可能是閒置隱藏的);找不到書籤也交給 main 提示(`missing`)。
 */
export async function runRegexBookmarkFromHotkey (e: RegexBookmarkRunEvent): Promise<void> {
  if (quickRunning.value) return
  quickRunning.value = true
  try {
    await ensureStateLoaded()
    const store = useRegexStore()
    const index = findBookmark(store.ui.bookmarks, e)
    const q = index >= 0 ? await queryOf(index) : null
    await Host.regexPaste(q ? { text: q.text, name: q.name, source: 'hotkey' } : { text: '', name: e.name, source: 'hotkey', missing: true })
  } catch (err) {
    console.error('[regex-quick] 書籤熱鍵失敗', err)
  } finally {
    quickRunning.value = false
  }
}
