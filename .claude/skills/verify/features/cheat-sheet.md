# 懸浮選單 › 速查表(一次匯入多張、釘住後再放大)

懸浮選單只在 overlay 模式出現,純瀏覽器沒有 host → 用 `../harness/overlay-host.html`(假 host:`windowMode: 'overlay'`、
設定存 `localStorage` 的 `zz.config`、`sheetPick` 回傳 `window.__picks`、`on*` 回呼存 `window.__cbs`)。
匯入的檔名是假的(`app://sheet/…` 瀏覽器打不開 → 圖片載入失敗是預期的),放大用內建那張。

## 準備
1. 把 `../harness/overlay-host.html` 複製成 `renderer/zz-verify-sheet.html`(**不 commit**,收尾刪掉)。
2. `preview_start { name: "renderer" }` → `navigate http://localhost:5173/zz-verify-sheet.html`,等 3 秒。

## 旅程
1. 叫出選單:`javascript_tool` 執行 `window.__cbs.onFocusChange({ overlay: true, game: false, usingHotkey: true })`,點 `[data-action="menu-sheet"]`。
2. 一次匯入多張:`window.__picks = ['syndicate-11111111.png','heist-22222222.png','expedition-33333333.webp']`,把 `[data-action="sheet-change"]`(或 `sheet-import`)
   捲進畫面後**用 computer 點**;再設 `window.__picks = ['heist-22222222.png','delve-44444444.png']` 點一次。
   記下 `window.__lastKeep`、`[data-menu="sheet-tabs"] button` 文字(`on` 加 `*`)、`localStorage['zz.config']` 的 `cheatSheets` / `cheatSheet` → `state-import.json`。
3. 重新整理頁面,重做步驟 1,點 `[data-sheet="builtin"]`、`[data-action="sheet-pin"]`;在 `[data-menu="sheet-zoom-view"]` 上 `computer scroll up` 三次、
   拖曳一次、按 － / 整張 / ＋ 與雙擊(看 `[data-menu="sheet-zoom-pct"]` 與圖片 `style.transform`)。最後滾輪放大後截圖。
   記下倍率、transform、三顆按鈕是否存在、膠囊清單、存檔、匯入鈕文字 → `state-zoom.json`。
4. `node .claude/skills/verify/check-cheat-sheet.mjs <證據目錄>`。

## 收尾
刪 `renderer/zz-verify-sheet.html`;`preview_stop`。

## 破壞對照
建議破壞點:`FloatMenu.vue` 的 `@wheel.prevent="onSheetWheel"` 拿掉 → 滾輪不放大,`state-zoom.json` 倍率 100% → 斷言非 0。
