/**
 * 2026-11-09(移植 APT / EE2 `openPoedb`):`hotkeyPoedb` 複製的物品 → 系統瀏覽器開 poedb.tw / poe2db.tw 該物品頁。
 * 網址怎麼算交給呼叫端(App.vue:依遊戲解析 + `poedbUrl` / `poe2dbUrl`);這裡只管失敗不往外拋、只寫 log。
 */
export async function openItemOnPoedb (
  text: string,
  deps: { resolveUrl: (text: string) => Promise<string | null>, open: (url: string) => void, log: (msg: string) => void }
): Promise<boolean> {
  let url: string | null
  try {
    url = await deps.resolveUrl(text)
  } catch (e) {
    deps.log(`[poedb] 解析物品失敗:${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  if (!url) {
    deps.log('[poedb] 解析不出物品,不開網頁')
    return false
  }
  deps.open(url)
  return true
}
