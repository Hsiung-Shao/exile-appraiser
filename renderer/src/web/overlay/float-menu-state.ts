/**
 * 懸浮選單的介面狀態;模組層級 = 收起再叫出時維持上次的(只在這次執行內,不寫設定)。
 * 2026-10-08:展開的區塊;2026-10-15 A 版(指令面板):篩選膠囊、搜尋字、鍵盤選取列(id)。
 */
import { shallowRef } from 'vue'
import type { MenuChip } from './float-menu-items'

/** A 版只剩工具列「速查表」會展開 */
export type FloatMenuSection = '' | 'sheet'

export const floatMenuSection = shallowRef<FloatMenuSection>('')
export const floatMenuChip = shallowRef<MenuChip>('all')
export const floatMenuQuery = shallowRef('')
/** 鍵盤選取的項目 id(`MenuItem.id`);清單變了找不到 → 視為沒選 */
export const floatMenuSel = shallowRef<string | null>(null)
