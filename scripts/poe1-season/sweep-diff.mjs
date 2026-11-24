// @ts-check
// 開季差異掃描的純函式:新舊兩份類型掃描(dump-type-sweep.mjs 的 build 輸出)只留「新版這類物品才有」的句子,並寫報告。
// 測試 poe1/test/type-sweep-diff.test.ts;用法見 dump-type-sweep.mjs 檔頭「開季差異掃描」。

/** @typedef {{ class: any, bases: any[], uniques?: any[], explicit: number[], implicit: number[] }} SweepClass */
/** @typedef {{ lines: [string, string][], classes: Record<string, SweepClass>, meta: { mods: string[], stats: string[], shape?: string }[], allMods?: string[] }} Sweep */

/** `[連結|顯示文字]` 留顯示文字;`{0}` 換數值(`{0:+d}` 帶正負號)或名稱 */
export function fill (/** @type {string} */ text, /** @type {Array<number | string | { en: string, zh: string }>} */ vals, /** @type {'en' | 'zh'} */ lang) {
  let seq = -1
  return text.replace(/\\n/g, '\n').replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1').replace(/\[([^\]]*)\]/g, '$1')
    .replace(/\{(\d*)(?::([^}]*))?\}/g, (_, i, fmt) => {
      seq += 1
      const v = vals[i === '' ? seq : Number(i)] ?? 0
      if (typeof v === 'object') return v[lang]
      return (fmt ?? '').includes('+') && typeof v === 'number' && v >= 0 ? `+${v}` : String(v)
    })
}

/** 去重鍵:只有模板代入的數值換成 #,句子本身寫死的數字與代入的名稱照留(「per 15 / per 100 Dexterity」是兩句) */
export const lineShape = (/** @type {string} */ en, /** @type {string} */ zh, /** @type {Array<number | { en: string, zh: string }>} */ vals) => {
  // 代入一個不會撞到的數字再換成 #:正負號(含 `{0:+d}` 的 +)照留,「+30% / -30% 火焰抗性」仍是兩句
  const h = vals.map(v => typeof v === 'object' ? v : v < 0 ? -987654321 : 987654321)
  return JSON.stringify([fill(en, h, 'en'), fill(zh, h, 'zh')]).replace(/987654321/g, '#')
}

const pobNorm = (/** @type {string} */ s) => s.toLowerCase().replace(/\(-?[\d.]+--?[\d.]+\)/g, '#').replace(/[+-](?=[#\d])/g, '').replace(/ skill$/, '').trim()
/**
 * PoB 傳奇行(實際數值或「(a-b)」範圍)對不對得上這句詞綴的 shape(lineShape 的英文):
 * shape 的 # 可對任何數字,句子本身寫死的數字要相同(野變 per 15 ≠ Eldritch per 100);正負號、大小寫、結尾「 Skill」不看
 */
export function pobLineFits (/** @type {string} */ shapeEn, /** @type {string} */ pobLine) {
  const parts = pobNorm(shapeEn).split('#').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('(?:#|\\d+(?:\\.\\d+)?)')}$`).test(pobNorm(pobLine))
}

/** 只差數字算同一句(沒有模板的句子用這個;有模板的用 meta 的 shape) */
export const sweepKey = (/** @type {string} */ en, /** @type {string} */ zh) => JSON.stringify([en, zh]).replace(/\d+(?:\.\d+)?/g, '#')

/**
 * @param {Sweep} oldSweep @param {Sweep} newSweep
 * @returns {{ lines: [string, string][], classes: Record<string, SweepClass>, origins: string[], meta: Sweep['meta'] }}
 */
export function diffSweep (oldSweep, newSweep) {
  const keyOf = (/** @type {Sweep} */ s, /** @type {number} */ ix) => s.meta?.[ix]?.shape ?? sweepKey(...s.lines[ix])
  // 舊版存在的全部詞綴(含沒進掃描的,例如 domain 沒命名被濾掉);沒給就退回掃描裡有句子的詞綴
  const oldMods = new Set(oldSweep.allMods ?? oldSweep.meta.flatMap(m => m.mods))
  /** 舊版每個描述句鍵印出過的句子 @type {Map<string, Set<string>>} */
  const oldStatKeys = new Map()
  oldSweep.meta.forEach((m, ix) => { for (const s of m.stats) (oldStatKeys.get(s) ?? oldStatKeys.set(s, new Set()).get(s))?.add(keyOf(oldSweep, ix)) })

  /** @type {Record<string, { explicit: number[], implicit: number[] }>} */
  const keptOf = {}
  const kept = new Set()
  for (const [cls, c] of Object.entries(newSweep.classes)) {
    const o = oldSweep.classes[cls]
    const had = new Set(o ? [...o.explicit, ...o.implicit].map(ix => keyOf(oldSweep, ix)) : [])
    const pick = (/** @type {number[]} */ ixs) => ixs.filter(ix => !had.has(keyOf(newSweep, ix)))
    const k = { explicit: pick(c.explicit), implicit: pick(c.implicit) }
    if (!k.explicit.length && !k.implicit.length) continue
    keptOf[cls] = k
    for (const ix of [...k.explicit, ...k.implicit]) kept.add(ix)
  }
  const order = [...kept].sort((a, b) => a - b)
  const newIx = new Map(order.map((ix, i) => [ix, i]))
  const origin = (/** @type {number} */ ix) => {
    const m = newSweep.meta[ix]
    if (m.mods.some(id => !oldMods.has(id))) return 'new-mod'
    const k = keyOf(newSweep, ix)
    if (m.stats.some(s => oldStatKeys.has(s) && !oldStatKeys.get(s)?.has(k))) return 'changed'
    return 'new-spawn'
  }
  return {
    lines: order.map(ix => newSweep.lines[ix]),
    classes: Object.fromEntries(Object.entries(keptOf).map(([cls, k]) => [cls, {
      ...newSweep.classes[cls], explicit: k.explicit.map(ix => /** @type {number} */ (newIx.get(ix))), implicit: k.implicit.map(ix => /** @type {number} */ (newIx.get(ix)))
    }])),
    origins: order.map(origin),
    meta: order.map(ix => newSweep.meta[ix])
  }
}

const ORIGINS = /** @type {const} */ ([
  ['new-mod', '新詞綴'], ['changed', '句子改字(同一個 stat)'], ['new-spawn', '舊詞綴這季出現在這類物品']
])
const cell = (/** @type {string} */ s) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')

/**
 * 差異掃描報告(Markdown):總表 → 依來源分組列每句與缺口說明 → 類別層級缺口。
 * @param {{ diff: ReturnType<typeof diffSweep> & { diff?: { old: string, new: string } }, gaps: Record<string, string>, queryGaps: Record<string, string> }} input
 */
export function buildReport ({ diff, gaps, queryGaps }) {
  const v = diff.diff ?? { old: '?', new: '?' }
  /** 句子層級的缺口說明:鍵 `<類別>|<段>|<英文>` 或其後再接 `|<段>|<語言>` / `|same` */
  const notesOf = (/** @type {string} */ cls, /** @type {string} */ type, /** @type {string} */ en) => {
    const base = `${cls}|${type}|${en}`
    // 找不到底材的類別整類沒跑解析與查詢(一語缺也算)→ 每句標未驗,不能看起來像通過
    const noBase = gaps[`${cls}|base`] ? [`未驗:${gaps[`${cls}|base`]}`] : []
    return noBase.concat([...Object.entries(gaps), ...Object.entries(queryGaps)]
      .filter(([k]) => k === base || k.startsWith(base + '|')).map(([k, n]) => `${k.slice(base.length + 1) || '解析'}:${n}`))
  }
  /** @type {{ ix: number, cls: string, type: string, notes: string[] }[]} */
  const rows = []
  for (const [cls, c] of Object.entries(diff.classes)) {
    for (const type of /** @type {const} */ (['explicit', 'implicit'])) {
      for (const ix of c[type]) rows.push({ ix, cls, type, notes: notesOf(cls, type, diff.lines[ix][0]) })
    }
  }
  const gapLines = new Set(rows.filter(r => r.notes.length).map(r => r.ix))
  const lineKeys = new Set(rows.map(r => `${r.cls}|${r.type}|${diff.lines[r.ix][0]}`))
  const classNotes = [...Object.entries(gaps), ...Object.entries(queryGaps)]
    .filter(([k]) => ![...lineKeys].some(l => k === l || k.startsWith(l + '|')))
  const out = [
    `# PoE1 開季差異掃描 ${v.old} → ${v.new}`,
    '',
    '句子照 GGPK 組成(推定,不是實機剪貼簿);缺口說明取自 type-sweep-diff 的兩份缺口清單。',
    '',
    '| 項目 | 句數 |', '|---|---|',
    `| 差異句 | ${diff.lines.length} |`,
    `| 有缺口 | ${gapLines.size} |`,
    ...ORIGINS.map(([o, label]) => `| ${o}(${label}) | ${diff.origins.filter(x => x === o).length} |`)
  ]
  for (const [o, label] of ORIGINS) {
    const mine = rows.filter(r => diff.origins[r.ix] === o)
    if (!mine.length) continue
    out.push('', `## ${o}:${label}`, '', '| 類別 | 段 | 英文 | 繁中 | 缺口 |', '|---|---|---|---|---|')
    for (const r of mine) out.push(`| ${cell(r.cls)} | ${r.type} | ${cell(diff.lines[r.ix][0])} | ${cell(diff.lines[r.ix][1])} | ${cell(r.notes.join(';'))} |`)
  }
  if (classNotes.length) {
    out.push('', '## 類別層級缺口', '', '| 鍵 | 說明 |', '|---|---|')
    for (const [k, n] of classNotes) out.push(`| ${cell(k)} | ${cell(n)} |`)
  }
  return out.join('\n') + '\n'
}
