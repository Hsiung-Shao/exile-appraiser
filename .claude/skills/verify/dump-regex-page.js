// 貼進內建瀏覽器 javascript_tool 執行(唯讀):回傳正則面板目前頁的頁面選單、分類、勾選數、看得見的列與輸出字串。
// 回傳值原樣存成證據目錄的 state-<步驟>.json,交給 check-tincture-page.mjs 斷言。
(() => {
  const one = s => document.querySelector(`[data-regex="${s}"]`)
  const pageSel = one('page')
  const groupSel = one('group')?.querySelector('select') ?? one('group')
  return {
    page: pageSel?.value ?? '',
    pages: [...(pageSel?.options ?? [])].map(o => ({ id: o.value, title: o.text })),
    group: groupSel?.tagName === 'SELECT' ? groupSel.options[groupSel.selectedIndex]?.text : '',
    groups: groupSel?.tagName === 'SELECT' ? [...groupSel.options].map(o => o.text) : [],
    count: one('count')?.innerText ?? '',
    rows: (one('list')?.innerText ?? '').split('\n').map(s => s.trim()).filter(Boolean),
    query: one('query')?.value ?? '',
    notice: one('notice')?.innerText ?? ''
  }
})()
