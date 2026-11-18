// 設定 › 正則版面的量測(貼進內建瀏覽器 javascript_tool;先開 設定 › 正則 › 產生器、遊戲 PoE1、清單「地圖詞綴」、至少勾一條)。
// 回傳值存成 <證據目錄>/state-<寬度>.json(840 與 1000 各跑一次),再跑 check-regex-layout.mjs。
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const rect = e => e.getBoundingClientRect()
  const where = () => { const e = q('.rx-panel [data-regex=section]'); return e.closest('.rx-side') ? 'side' : e.closest('.rx-col') ? 'col' : '?' }
  const side = q('.rx-side'); const col = q('.rx-col')
  const st = { width: window.innerWidth, panelW: Math.round(rect(q('.rx-panel')).width) }
  st.cols = { sideX: rect(side).x, colX: rect(col).x, sideY: rect(side).y, colY: rect(col).y, outInSide: !!side.querySelector('[data-regex=output]') }
  // 數值條件:先確定是展開,再收合、再展開,各記一次位置與焦點
  if (where() === 'side') { q('.rx-panel [data-regex=section-toggle]').click(); await sleep(300) }
  st.expanded = where()
  st.focus = []
  for (let i = 0; i < 2; i++) {
    const b = q('.rx-panel [data-regex=section-toggle]'); b.focus(); b.click(); await sleep(300)
    st.focus.push(document.activeElement?.dataset?.regex ?? '')
    if (i === 0) st.collapsed = where()
  }
  st.lang = [...document.querySelectorAll('[data-regex=lang] button')].map(b => b.textContent.trim())
  st.query = q('[data-regex=query]').value
  q('[data-setting=regex-view] [data-value=bookmarks]').click(); await sleep(500)
  const cards = [...document.querySelectorAll('.rx-bm-cards > .card')]
  const sw = q('[data-setting=regex-bookmark-bar]')
  st.bookmarks = {
    underlineTabs: document.querySelectorAll('[data-setting=regex-view].tabs > .tab').length,
    cards: cards.length,
    cardsSameRow: cards.length === 2 && Math.abs(rect(cards[0]).y - rect(cards[1]).y) < 2,
    switchTrackW: Math.round(rect(sw.parentElement.querySelector('.scan-switch-track')).width)
  }
  q('[data-setting=regex-view] [data-value=generator]').click(); await sleep(300)
  return JSON.stringify(st)
})()
