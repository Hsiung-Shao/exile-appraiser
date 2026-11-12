// 貼進內建瀏覽器 javascript_tool 執行(唯讀):回傳正則書籤卡片、書籤列與存檔(localStorage)的現況。
// 回傳值原樣存成證據目錄的 state-<步驟>.json,交給 check-custom-bookmark.mjs 斷言。
({
  rows: [...document.querySelectorAll('[data-regex="bookmarks"] .rx-bm-item')].map(li => ({
    name: li.dataset.bm,
    meta: li.querySelector('.rx-bm-meta')?.innerText ?? '',
    custom: !!li.querySelector('[data-regex="bm-custom-meta"]'),
    buttons: [...li.querySelectorAll('button[data-regex]')].map(b => b.dataset.regex)
  })),
  bar: [...document.querySelectorAll('[data-regex="quick-bar-item"]')].map(b => b.dataset.bm),
  notice: document.querySelector('[data-regex="notice"]')?.innerText ?? '',
  dialogOpen: !!document.querySelector('[data-regex="bm-custom-dialog"]'),
  saved: (JSON.parse(localStorage.getItem('exile-appraiser.regex_state') ?? 'null')?.bookmarks ?? [])
    .map(b => ({ name: b.name, page: b.page, game: b.game, keys: b.keys }))
})
