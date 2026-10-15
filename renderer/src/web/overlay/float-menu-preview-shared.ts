/** 懸浮選單書籤預覽的共用實例(純邏輯在 float-menu-preview.ts,這裡接 store / quick) */
import { regexBookmarkPreview } from '@/web/regex/quick'
import { useRegexStore } from '@/web/regex/store'
import { createPreviewCache } from './float-menu-preview'
import type { PreviewBookmark, PreviewCache } from './float-menu-preview'

let shared: PreviewCache | null = null
/** 懸浮選單用的共用實例(模組層級,選單收起再叫出仍保留) */
export function sharedPreviewCache (): PreviewCache {
  if (!shared) {
    shared = createPreviewCache({
      bookmarkAt: i => useRegexStore().ui.bookmarks[i] as unknown as PreviewBookmark | undefined,
      stateTag: b => {
        const g = b.game === 'poe2' ? 'poe2' : 'poe1'
        const im = useRegexStore().itemMods[g]
        return `${im.phase}|${im.formsMissing ? 1 : 0}`
      },
      compute: regexBookmarkPreview
    })
  }
  return shared
}
