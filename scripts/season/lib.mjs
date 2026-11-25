// 開季流程共用的純函式(PoE1 / PoE2 同一套;2026-11-25)。依賴全部由參數注入,測試在 poe1/test/season-automation.test.ts。

/** 跑到資料不再變為止:每輪前後比 hash,相同就停;跑滿 maxRounds 仍在變 = stable false(呼叫端要大聲失敗) */
export async function untilStable ({ run, hash, maxRounds = 5 }) {
  for (let round = 1; round <= maxRounds; round++) {
    const before = await hash()
    await run(round)
    if (before === await hash()) return { rounds: round, stable: true }
  }
  return { rounds: maxRounds, stable: false }
}

const NEED_TABLES = ['ggpk_stat', 'ggpk_cell', 'ggpk_row', 'rel']

/**
 * 開季前置檢查。versions = 本機 GGPK sqlite 的 version 表;tableCounts = Supabase 最新 version 各表列數。
 * PoE2 只有一個版本時只警告(沒有舊版可比,只跑共用規則與快照)。
 */
export async function precheck ({ game, versions, dockerOk, tableCounts }) {
  const errors = []
  const warnings = []
  const done = versions.filter(v => v.complete).sort((a, b) => a.id - b.id)
  const neu = done.at(-1)
  const old = done.length > 1 ? done.at(-2) : neu
  if (done.length === 0) errors.push('本機 GGPK 版本庫沒有完整的版本:請先在 PobTools 抽 GGPK')
  else if (done.length === 1) {
    if (game === 'poe1') errors.push(`本機 GGPK 版本庫只有一個完整版本(${neu.gameVersion}),沒有舊版可比:請先在 PobTools 抽新版 GGPK`)
    else warnings.push(`本機 GGPK 版本庫只有一個版本(${neu.gameVersion}),沒有舊版可比:只跑共用規則與快照`)
  }
  if (!await dockerOk()) errors.push('Docker 沒有在跑(Supabase supabase_db_pobtools-ggpk-db):請先開 Docker,或在 PobTools 匯入')
  else {
    const counts = await tableCounts()
    for (const t of NEED_TABLES) if (!(counts[t] > 0)) errors.push(`Supabase 最新 version 的 ${t} 沒有資料:請先在 PobTools 匯入`)
  }
  return { ok: errors.length === 0, errors, warnings, old, new: neu }
}

/** 改 renderer/src/web/settings/game-versions.ts 裡某遊戲那一行的版號;其他位元組不動 */
export function setGameVersion (source, game, version) {
  const re = new RegExp(`^(\\s*${game}:\\s*')[^']*(')`, 'm')
  if (!re.test(source)) throw new Error(`game-versions.ts 找不到 ${game} 那一行`)
  return source.replace(re, (_, a, b) => `${a}${version}${b}`)
}

/** 只改 package.json 頂層的 "version"(兩格縮排那一層) */
export function bumpVersion (pkgText, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`版號要是 x.y.z:${version}`)
  const re = /^( {2}"version":\s*")[^"]*(")/m
  if (!re.test(pkgText)) throw new Error('package.json 找不到頂層 version')
  return pkgText.replace(re, (_, a, b) => `${a}${version}${b}`)
}

/**
 * 物品詞綴數值頁:寫入前後 id 整個換掉的項目(同一個英文 ref、新版唯一一條)→ 舊 id 對新 id。
 * `X|ref` 型由 algoEntryIndex 自己退回,不進表;existing 只加不改。
 * aliasOf(英文句) = 新版資料裡把這句留作寫法(含 superseded)的詞綴 ref:併列時舊列的句子會搬進另一列(PoE1 規則 30),ref 不同也算同一條。
 */
export function renamedEntryIds ({ before, after, existing = {}, aliasOf = (/** @type {string} */ _s) => /** @type {string[]} */ ([]) }) {
  const out = { ...existing }
  const now = new Set(after.map(e => e.id))
  for (const e of before) {
    if (e.id.includes('|') || now.has(e.id) || e.id in out) continue
    const refs = new Set([e.en[0], ...aliasOf(e.en[0])])
    const hits = after.filter(a => refs.has(a.en[0]) && a.id !== e.id)
    if (hits.length === 1) out[e.id] = hits[0].id
  }
  return out
}

/** 同文另一個 id 實測:逐一匿名搜尋;429 依 Retry-After 等,同一個 id 最多重試 3 次 */
export async function probeTwinIds ({ ids, search, sleep }) {
  const out = []
  for (const id of ids) {
    let r = await search(id)
    let tries = 0
    while (r.status === 429 && tries < 3) {
      tries++
      await sleep((r.retryAfter ?? 60) * 1000)
      r = await search(id)
    }
    out.push(r.status === 200 ? { id, total: r.total } : { id, error: String(r.status) })
  }
  return out
}

/** 實測有物品(total > 0)且還沒在表裡的 id 附加到尾端 */
export function addLiveTwins (list, results) {
  const next = [...list]
  for (const r of results) if (r.total > 0 && !next.includes(r.id)) next.push(r.id)
  return next
}
