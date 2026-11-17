// 2026-11-18 code review:3.30 綢帶子頁上線後,懸浮選單與設定狀態列用 `ppz.stash.subtab_<子頁>` 顯示子頁名稱,缺鍵會露出原始鍵名。
import { describe, expect, it } from 'vitest'
import zh from '../src/i18n/cmn-Hant.json'
import en from '../src/i18n/en.json'
import { STASH_SUBTABS } from '../../core/src/stash/layout'
import { NINJA_CATEGORIES } from '../../core/src/ninja/client'
import { NINJA_SNAPSHOT_SCHEMA } from '../../core/src/ninja/cache'
import { ninjaCategorySlug } from '../../core/src/ninja/lookup'

const stash = (j: any): Record<string, string> => j.ppz.stash

describe('倉庫子頁名稱與綢帶價格', () => {
  it('每個子頁在繁中與英文都有 subtab_<id> 字串', () => {
    for (const id of STASH_SUBTABS) {
      expect(stash(zh)[`subtab_${id}`], `zh ${id}`).toBeTruthy()
      expect(stash(en)[`subtab_${id}`], `en ${id}`).toBeTruthy()
    }
    expect(stash(zh).subtab_threads).toBe('綢帶')
    expect(stash(en).subtab_threads).toBe('Threads')
  })
  it('設定頁說明提到綢帶子頁', () => {
    expect(stash(zh).hint).toContain('綢帶')
    expect(stash(en).hint).toContain('Threads')
  })
  it('加了 Thread 類別後快照 schema 升到 4(舊快照沒有綢帶價格,要整批作廢)', () => {
    expect(NINJA_CATEGORIES.poe1.exchange).toContain('Thread')
    expect(NINJA_SNAPSHOT_SCHEMA).toBe(4)
  })
  it('poe.ninja 綢帶網頁 slug 是 threads(thread 會 404,2026-11-18 實測)', () => {
    expect(ninjaCategorySlug('Thread')).toBe('threads')
  })
})
