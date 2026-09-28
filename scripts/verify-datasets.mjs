// @ts-check
/**
 * 資料集交叉驗證(Gate 0:「en 與 cmn-Hant 兩份 ndjson 皆能載入且筆數一致」)。
 *
 * ⚠ 「筆數一致」不能照字面比對行數。實測 APT 出貨資料:
 *     items  en=4738 行 / cmn-Hant=4743 行
 *     stats  en=8198 行 / cmn-Hant=8187 行
 *   兩者都不相等,但**內容其實完全對齊**:
 *     - items 的行數差來自同一 refName 的重複列(例如繁中把 Large Life Flask
 *       同時收了「大型生命藥劑」與「生命藥劑(大)」兩個譯名)
 *     - stats 的行數差來自 `resolve` 群組的打包方式不同(en 把某些 stat 併成一列,
 *       zh 沒併或併法不同);展開群組後兩邊都是 8292 個 stat、8217 個唯一 ref
 *
 * 所以真正的判準是**語言無關鍵的集合**:
 *     items → `namespace::refName`
 *     stats → 展開群組後的 `ref`
 * 這也符合專案規則「對接一律用語言無關的鍵,禁止位置對位」。
 *
 * 用法:
 *   node scripts/verify-datasets.mjs          # 驗證,失敗回非零
 *   node scripts/verify-datasets.mjs --json   # 輸出 JSON 供其他工具消費
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.resolve(__dirname, '../data/poe1')

/**
 * 只檢查 en 與 cmn-Hant —— **這不是漏掉 ko / ru**。
 *
 * 那兩個語系由上游的各自社群維護(app_i18n 覆蓋率 ko 96.5%、ru 98.4%),
 * 本專案原樣沿用、不修改也不新增變體列。把它們納入比對只會產生一堆
 * 我們不打算處理的雜訊,反而蓋掉真正該盯的訊號:**我們自己動過的那兩份**。
 */
export const LANGUAGES = ['en', 'cmn-Hant']
/** 語言無關的基準語系:所有比對都以它為骨架。 */
export const REFERENCE_LANGUAGE = 'en'

function readNdjson (lang, kind) {
  const file = path.join(DATA_DIR, lang, `${kind}.ndjson`)
  const raw = fs.readFileSync(file, 'utf-8')
  const out = []
  let lineNo = 0
  for (const line of raw.split('\n')) {
    lineNo += 1
    if (line.trim().length === 0) continue
    try {
      out.push(JSON.parse(line))
    } catch (err) {
      throw new Error(`${file}:${lineNo} JSON 解析失敗:${err.message}`)
    }
  }
  return out
}

/** 展開 stats 的 `resolve` 群組列。 */
export function flattenStats (rows) {
  return rows.flatMap(row => (row && Array.isArray(row.stats)) ? row.stats : [row])
}

function setOf (values) {
  return new Set(values)
}

function diff (a, b) {
  return [...a].filter(v => !b.has(v))
}

export function analyzeDatasets () {
  const report = {
    languages: LANGUAGES,
    items: {},
    stats: {},
    problems: [],
    warnings: []
  }

  // ---------------- items ----------------
  const itemRows = {}
  const itemKeys = {}
  for (const lang of LANGUAGES) {
    const rows = readNdjson(lang, 'items')
    itemRows[lang] = rows
    itemKeys[lang] = setOf(rows.map(r => `${r.namespace}::${r.refName}`))
    report.items[lang] = { lines: rows.length, keys: itemKeys[lang].size }
  }

  const refItems = itemKeys[REFERENCE_LANGUAGE]
  for (const lang of LANGUAGES) {
    if (lang === REFERENCE_LANGUAGE) continue
    const missing = diff(refItems, itemKeys[lang])
    const extra = diff(itemKeys[lang], refItems)
    if (missing.length > 0) {
      report.problems.push({
        code: 'ITEMS_MISSING',
        language: lang,
        count: missing.length,
        sample: missing.slice(0, 20)
      })
    }
    if (extra.length > 0) {
      report.problems.push({
        code: 'ITEMS_EXTRA',
        language: lang,
        count: extra.length,
        sample: extra.slice(0, 20)
      })
    }
  }

  // 同一 refName 對到多個不同譯名 —— 不是錯誤,但需要知道(parser 兩個都要認得)
  for (const lang of LANGUAGES) {
    if (lang === REFERENCE_LANGUAGE) continue
    const namesByKey = new Map()
    for (const row of itemRows[lang]) {
      const key = `${row.namespace}::${row.refName}`
      if (!namesByKey.has(key)) namesByKey.set(key, new Set())
      namesByKey.get(key).add(row.name)
    }
    const multi = [...namesByKey].filter(([, names]) => names.size > 1)
    if (multi.length > 0) {
      report.warnings.push({
        code: 'ITEM_MULTIPLE_TRANSLATIONS',
        language: lang,
        count: multi.length,
        sample: multi.slice(0, 10).map(([key, names]) => ({ key, names: [...names] }))
      })
    }
  }

  // 反向撞名:同一個顯示名對到多個不同的 refName。
  //
  // 這比 ITEM_MULTIPLE_TRANSLATIONS 嚴重 —— 那個是「同一件東西有兩種譯名」(解析時
  // 兩種都認得,是好事);這個是「兩件**不同**的東西共用一個譯名」,從物品文字
  // 根本分辨不出來,送查詢時只能猜一個。
  //
  // 實測繁中有 4 組(en 0 組),其中 UNIQUE::永恆鬥爭 曾造成解析崩潰
  // (見 assets/data/index.ts 的 commonFind 註解)。另外 3 組是基底類型,
  // 兩邊 category 相同所以不影響分類,但查詢會送出其中一個的英文名。
  for (const lang of LANGUAGES) {
    if (lang === REFERENCE_LANGUAGE) continue
    const refsByName = new Map()
    for (const row of itemRows[lang]) {
      const key = `${row.namespace}::${row.name}`
      if (!refsByName.has(key)) refsByName.set(key, new Set())
      refsByName.get(key).add(row.refName)
    }
    const collisions = [...refsByName].filter(([, refs]) => refs.size > 1)
    if (collisions.length > 0) {
      report.warnings.push({
        code: 'ITEM_NAME_COLLISION',
        language: lang,
        count: collisions.length,
        sample: collisions.map(([key, refs]) => ({ key, refNames: [...refs] }))
      })
    }
  }

  // ---------------- stats ----------------
  const statList = {}
  const statRefs = {}
  for (const lang of LANGUAGES) {
    const rows = readNdjson(lang, 'stats')
    const flat = flattenStats(rows)
    statList[lang] = flat
    statRefs[lang] = setOf(flat.map(s => s.ref))
    report.stats[lang] = { lines: rows.length, flattened: flat.length, refs: statRefs[lang].size }
  }

  const refStats = statRefs[REFERENCE_LANGUAGE]
  for (const lang of LANGUAGES) {
    if (lang === REFERENCE_LANGUAGE) continue
    const missing = diff(refStats, statRefs[lang])
    const extra = diff(statRefs[lang], refStats)
    if (missing.length > 0) {
      report.problems.push({
        code: 'STATS_MISSING', language: lang, count: missing.length, sample: missing.slice(0, 20)
      })
    }
    if (extra.length > 0) {
      report.problems.push({
        code: 'STATS_EXTRA', language: lang, count: extra.length, sample: extra.slice(0, 20)
      })
    }
  }

  // trade.ids 是語言無關欄位,兩份資料理應完全相同;不同代表其中一份是舊的
  for (const lang of LANGUAGES) {
    if (lang === REFERENCE_LANGUAGE) continue
    const byRef = new Map()
    for (const s of statList[lang]) if (!byRef.has(s.ref)) byRef.set(s.ref, s)
    const mismatched = []
    for (const s of statList[REFERENCE_LANGUAGE]) {
      const other = byRef.get(s.ref)
      if (other === undefined) continue
      if (JSON.stringify(s.trade?.ids ?? {}) !== JSON.stringify(other.trade?.ids ?? {})) {
        mismatched.push(s.ref)
      }
    }
    if (mismatched.length > 0) {
      report.warnings.push({
        code: 'STATS_TRADE_ID_MISMATCH',
        language: lang,
        count: mismatched.length,
        sample: mismatched.slice(0, 15)
      })
    }
  }

  // 譯文與英文逐字相同 = 疑似未翻譯(不是錯誤,但 Phase 1 要能區分)
  for (const lang of LANGUAGES) {
    if (lang === REFERENCE_LANGUAGE) continue
    const byRef = new Map()
    for (const s of statList[lang]) if (!byRef.has(s.ref)) byRef.set(s.ref, s)
    const untranslated = []
    for (const s of statList[REFERENCE_LANGUAGE]) {
      const other = byRef.get(s.ref)
      if (other === undefined) continue
      const a = s.matchers?.[0]?.string
      const b = other.matchers?.[0]?.string
      if (typeof a === 'string' && a === b) untranslated.push(s.ref)
    }
    if (untranslated.length > 0) {
      report.warnings.push({
        code: 'STATS_UNTRANSLATED',
        language: lang,
        count: untranslated.length,
        sample: untranslated.slice(0, 15)
      })
    }
  }

  return report
}

function formatReport (report) {
  const lines = []
  lines.push('=== 資料集交叉驗證 ===')
  for (const lang of report.languages) {
    const i = report.items[lang]
    const s = report.stats[lang]
    lines.push(
      `  ${lang.padEnd(9)} items: ${String(i.lines).padStart(5)} 行 / ${String(i.keys).padStart(5)} 個唯一鍵` +
      `   stats: ${String(s.lines).padStart(5)} 行 / ${String(s.flattened).padStart(5)} 展開 / ${String(s.refs).padStart(5)} 個 ref`
    )
  }
  if (report.warnings.length > 0) {
    lines.push('')
    lines.push('--- 警告(不阻擋,但必須知道)---')
    for (const w of report.warnings) {
      lines.push(`  [${w.code}] ${w.language}:${w.count} 筆`)
      for (const item of w.sample) {
        lines.push(`      ${typeof item === 'string' ? item : JSON.stringify(item)}`)
      }
      if (w.count > w.sample.length) lines.push(`      …其餘 ${w.count - w.sample.length} 筆`)
    }
  }
  if (report.problems.length > 0) {
    lines.push('')
    lines.push('--- 錯誤 ---')
    for (const p of report.problems) {
      lines.push(`  [${p.code}] ${p.language}:${p.count} 筆`)
      for (const item of p.sample) lines.push(`      ${item}`)
    }
  }
  lines.push('')
  lines.push(report.problems.length === 0 ? 'PASS:語言無關鍵集合完全一致。' : 'FAIL:資料集不對齊。')
  return lines.join('\n')
}

// CLI
if (process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const report = analyzeDatasets()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatReport(report))
  }
  process.exit(report.problems.length === 0 ? 0 : 1)
}
