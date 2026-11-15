#!/usr/bin/env node
/**
 * 逐條比對:國際服交易站 `/api/trade/data/stats` 的每個 id(pseudo 群組除外)對 `data/poe1/<語系>/stats.ndjson`。
 * 只讀、不改資料。每個 id 一個結論:
 *   ok        資料有引用這個 id,而且交易站文字 = 該詞綴的 ref 或某個英文 matcher,繁中有現行 matcher
 *   文字不符  資料有引用,但交易站文字對不上任何英文寫法
 *   沒引用 A  同一個 hash 在別的類型(explicit / implicit …)已經有
 *   沒引用 B  文字資料裡有,id 沒有
 *   沒引用 C  資料完全沒有
 *
 * 用法:node scripts/poe1-season/audit-trade-ids.mjs --stats <stats.json> [--report <out.md>]
 *   <stats.json> = 先存下來的 /api/trade/data/stats 回應(要帶瀏覽器 User-Agent 才抓得到)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1] }
const statsFile = arg('--stats')
if (!statsFile) { console.error('缺 --stats <stats.json>'); process.exit(2) }

const norm = (s) => s.replace(/\s*\n\s*/g, '\n').replace(/[+-]?#/g, '#').replace(/ \(Local\)$/, '').toLowerCase().trim()
const read = (lang) => fs.readFileSync(path.join(ROOT, 'data/poe1', lang, 'stats.ndjson'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).flatMap(r => r.stats ?? [r])

export function audit (trade, en, zh) {
  const zhByRef = new Map(zh.map(s => [s.ref, s]))
  const byId = new Map(); const hashes = new Set(); const texts = new Set()
  const push = (k, s) => { if (!byId.has(k)) byId.set(k, []); byId.get(k).push(s) }
  for (const s of en) {
    texts.add(norm(s.ref))
    for (const m of s.matchers) texts.add(norm(m.string))
    for (const ids of Object.values(s.trade?.ids ?? {})) {
      for (const id of ids) {
        const bare = id.split('|')[0]
        push(bare, s)
        if (bare !== id) push(id, s)
        hashes.add(bare.slice(bare.indexOf('.') + 1))
      }
    }
  }
  const rows = []
  for (const e of trade) {
    const type = e.id.slice(0, e.id.indexOf('.'))
    const stats = byId.get(e.id)
    let verdict; let note = ''
    if (!stats) {
      const hash = e.id.slice(e.id.indexOf('.') + 1).split('|')[0]
      verdict = hashes.has(hash) ? '沒引用 A' : texts.has(norm(e.text)) ? '沒引用 B' : '沒引用 C'
    } else {
      const t = norm(e.text)
      const hit = stats.filter(s => norm(s.ref) === t || s.matchers.some(m => norm(m.string) === t))
      if (!hit.length) { verdict = '文字不符'; note = stats[0].ref }
      else if (!hit.some(s => zhByRef.get(s.ref)?.matchers.some(m => !m.superseded))) verdict = '沒有繁中'
      else verdict = 'ok'
    }
    rows.push({ type, family: e.id.includes('.effect_') ? 'effect' : '', id: e.id, text: e.text, verdict, note })
  }
  return rows
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const trade = JSON.parse(fs.readFileSync(statsFile, 'utf8')).result.filter(g => g.id !== 'pseudo').flatMap(g => g.entries)
  const rows = audit(trade, read('en'), read('cmn-Hant'))
  const count = {}
  for (const r of rows) {
    const k = `${r.type}${r.family ? ' (effect)' : ''}`
    count[k] ??= { 總數: 0, ok: 0, 文字不符: 0, '沒引用 A': 0, '沒引用 B': 0, '沒引用 C': 0, 沒有繁中: 0 }
    count[k].總數++
    count[k][r.verdict]++
  }
  console.table(count)
  const out = arg('--report')
  if (out) {
    const one = (s) => s.replace(/\s*\n\s*/g, ' / ').replace(/\|/g, '\\|')
    const cols = ['總數', 'ok', '文字不符', '沒引用 A', '沒引用 B', '沒引用 C', '沒有繁中']
    const lines = ['# PoE1 交易站 id 逐條比對', '', `交易站清單:${trade.length} 個 id(不含 pseudo)。結論定義見 \`scripts/poe1-season/audit-trade-ids.mjs\` 檔頭。`, '',
      `| 類型 | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`,
      ...Object.entries(count).map(([k, c]) => `| ${k} | ${cols.map(x => c[x]).join(' | ')} |`), '']
    const groups = new Map()
    for (const r of rows.filter(r => r.verdict !== 'ok')) {
      const k = `${r.verdict}:${r.type}${r.family ? ' (effect)' : ''}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(r)
    }
    for (const [k, list] of [...groups].sort()) {
      lines.push(`## ${k}(${list.length})`, '', '| id | 交易站文字 | 資料裡的寫法 |', '|---|---|---|', ...list.map(r => `| \`${r.id}\` | ${one(r.text)} | ${one(r.note)} |`), '')
    }
    fs.writeFileSync(path.resolve(out), lines.join('\n'))
    console.log(`報告:${out}(${rows.filter(r => r.verdict !== 'ok').length} 條非 ok)`)
  }
}
