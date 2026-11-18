// 設定視窗重整旅程(features/settings-ia.md):設定視窗開著時貼進 javascript_tool。
// 逐頁點左選單(頁面內 DOM click,只作用在內建瀏覽器這個分頁)→ 收集選單分組、每頁頁首與卡片的 data-setting / data-about、
// 熱鍵總表的組與「到 … ›」、正則子分頁,最後從熱鍵總表點倉庫組的連結看跳轉與返回連結。回傳值原樣存成 state-settings-ia.json。
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const win = document.querySelector('[data-settings="window"]')
  if (!win) return { error: '設定視窗沒開' }
  const groups = []
  for (const el of win.querySelectorAll('.sw-nav > *')) {
    if (el.classList.contains('sw-nav-group')) groups.push({ label: el.textContent.trim(), tabs: [] })
    else if (el.classList.contains('sw-nav-item') && groups.length) groups.at(-1).tabs.push({ id: el.dataset.tab, text: el.textContent.trim(), hasIcon: !!el.querySelector('svg path[d]') })
  }
  const pages = {}
  let hotkeyGroups = []
  let regexViews = []
  for (const g of groups) {
    for (const tb of g.tabs) {
      win.querySelector(`.sw-nav-item[data-tab="${tb.id}"]`).click()
      await sleep(600)
      const body = win.querySelector('.settings-body')
      pages[tb.id] = {
        title: body.querySelector('.sw-page-title')?.textContent.trim() ?? null,
        lead: body.querySelector('.sw-page-lead')?.textContent.trim() ?? null,
        settings: [...body.querySelectorAll('[data-setting]')].map(e => e.dataset.setting),
        about: [...body.querySelectorAll('[data-about]')].map(e => e.dataset.about)
      }
      if (tb.id === 'hotkeys') hotkeyGroups = [...body.querySelectorAll('section.hk-group')].map(s => ({ id: s.dataset.hkGroup, goto: s.querySelector('.hk-goto')?.dataset.goto ?? null }))
      if (tb.id === 'regex') regexViews = [...body.querySelectorAll('[data-setting="regex-view"] [data-value]')].map(b => b.dataset.value)
    }
  }
  win.querySelector('.sw-nav-item[data-tab="hotkeys"]').click()
  await sleep(600)
  win.querySelector('section.hk-group[data-hk-group="scan"] .hk-goto')?.click()
  await sleep(600)
  const jump = { hash: location.hash, back: !!win.querySelector('[data-action="settings-back"]') }
  win.querySelector('.sw-nav-item[data-tab="general"]').click()
  return { at: new Date().toISOString(), groups, pages, hotkeyGroups, regexViews, jump }
})()
