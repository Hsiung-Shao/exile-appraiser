/**
 * 懸浮選單(2026-10-08)目前展開的區塊;模組層級 = 收起再叫出時維持上次的(只在這次執行內,不寫設定)。
 */
import { shallowRef } from 'vue'

export type FloatMenuSection = '' | 'bookmarks' | 'sheet'

export const floatMenuSection = shallowRef<FloatMenuSection>('')
