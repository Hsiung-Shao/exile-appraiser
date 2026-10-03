// 第 29 步:依情境量測 ExileAppraiser 對電腦與遊戲的影響(CI 外手動跑;docs/perf/README.md)。
//
// **只量測、只讀**:不送任何鍵盤 / 滑鼠輸入、不切換視窗、不關閉或啟動任何程式。每個情境只印出要你手動擺好的狀態,
// 等你在這個終端機按 Enter(之後倒數 `--delay` 秒讓你切回遊戲)才開始量。
//
//   node scripts/perf-scenario.mjs [選項]
//     --seconds <n>      每個情境量幾秒(預設 60;每秒一個 GPU 計數器樣本,少於 8 會自動補到 8)
//     --delay <n>        按 Enter 後等幾秒才開始(預設 5,給你切回遊戲)
//     --app <名稱>       本程式主行程名稱(預設 ExileAppraiser;開發版用 electron)。子行程(GPU / renderer / utility /
//                        WinOcr 的 powershell 等)依父行程關係一起算
//     --game <名稱>      遊戲行程名稱(例:PathOfExile_x64Steam、PathOfExileSteam);給了才量遊戲的 CPU / GPU / FPS
//     --hwaccel on|off   只是標籤(記在表頭與每列),不會改設定
//     --label <文字>     表頭附註(例:v0.1.2、改了什麼)
//     --only <id,id>     只跑這些情境(id 見 --list)
//     --out <檔案>       Markdown 輸出(預設 docs/perf/run-<日期時間>.md;同名 .json 存原始數字)
//     --list             列出情境後結束
//
// 指標:
//   本程式 CPU % = 這段時間全部行程 CPU 時間差 ÷(經過秒數 × 邏輯處理器數)× 100(與工作管理員同一個基準)
//   本程式 GPU % = `\GPU Engine(pid_<pid>_*)\Utilization Percentage` 全部引擎加總,每秒一個樣本取平均
//   系統 3D %   = 所有行程 `engtype_3D` 引擎的加總(多張卡 / 多個引擎時可能 > 100,只看差值)
//   FPS        = 本機 PATH 上有 PresentMon 才量(平均 = 1000 ÷ 平均幀時間;1% low = 最慢 1% 幀的平均幀時間換算)
import child_process from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- 情境

/**
 * 情境清單。`id` 與 main 效能診斷(`main/src/perf/perf-monitor.ts` `deriveScenario`)的情境鍵對應
 * (`ocr-reveal` = `fg-idle+reveal`、`ocr-rune` = `fg-idle+rune`、`bg-on` = `panel+bg`)。
 */
export const SCENARIOS = [
  { id: 'no-app', title: '無程式基準', setup: '結束 ExileAppraiser(托盤「結束」)。遊戲照你要比較的狀態開著(建議:遊戲在前景、站在城鎮不動)。', baseline: true },
  { id: 'no-game', title: '遊戲沒開', setup: '開 ExileAppraiser(overlay 模式,預設設定);關閉遊戲。' },
  { id: 'game-bg', title: '遊戲開、不在前景', setup: '遊戲開著但切到別的視窗(例如桌面 / 瀏覽器),遊戲不要最小化以外的操作。' },
  { id: 'fg-idle', title: '前景無面板', setup: '遊戲在前景、站在城鎮不動;查價面板關;設定 › 熱鍵與視窗 的褻瀆 / 符文自動辨識都關。' },
  { id: 'panel', title: '查價面板開', setup: '遊戲在前景,查一件物品後讓查價面板停在畫面上(滑鼠移到面板外不動);背景圖關。' },
  { id: 'ocr-reveal', title: '褻瀆 OCR 開', setup: 'PoE2;開褻瀆自動辨識(符文關);遊戲在前景、查價面板關。可開著靈魂之井揭露面板。' },
  { id: 'ocr-rune', title: '符文 OCR 開', setup: 'PoE2;開符文塑形自動辨識(褻瀆關);遊戲在前景、查價面板關。可開著符文塑形面板。' },
  { id: 'bg-on', title: '背景圖開', setup: '設定 › 一般 啟用背景圖並選一張圖;遊戲在前景,開查價面板停著(同「查價面板開」)。' },
  { id: 'settings', title: '設定視窗開', setup: '遊戲在前景,開設定視窗(一般分頁)停著不動。' },
  { id: 'window', title: 'window 模式', setup: '設定關掉 overlay 模式(程式會重新啟動成獨立小視窗),讓視窗顯示在畫面上;遊戲在前景。' }
]

// ---------------------------------------------------------------- 參數

/** 純函式:命令列 → 選項(錯誤丟 Error) */
export function parseArgs (argv, now = new Date()) {
  const o = {
    seconds: 60, delay: 5, app: 'ExileAppraiser', game: null, hwaccel: null, label: '', only: null, out: null, list: false, help: false
  }
  const need = (i, flag) => {
    const v = argv[i + 1]
    if (v == null || v.startsWith('--')) throw new Error(`${flag} 需要一個值`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--seconds': { const n = Number(need(i, a)); i++; if (!(n > 0) || !Number.isFinite(n)) throw new Error('--seconds 要是正數'); o.seconds = Math.round(n); break }
      case '--delay': { const n = Number(need(i, a)); i++; if (!(n >= 0) || !Number.isFinite(n)) throw new Error('--delay 要 ≥ 0'); o.delay = Math.round(n); break }
      case '--app': o.app = need(i, a); i++; break
      case '--game': o.game = need(i, a); i++; break
      case '--hwaccel': {
        const v = need(i, a).toLowerCase(); i++
        if (v !== 'on' && v !== 'off') throw new Error('--hwaccel 只能是 on 或 off')
        o.hwaccel = v
        break
      }
      case '--label': o.label = need(i, a); i++; break
      case '--only': {
        const ids = need(i, a).split(',').map(s => s.trim()).filter(Boolean); i++
        const bad = ids.filter(id => !SCENARIOS.some(s => s.id === id))
        if (bad.length) throw new Error(`未知的情境:${bad.join(', ')}(--list 看清單)`)
        o.only = ids
        break
      }
      case '--out': o.out = need(i, a); i++; break
      case '--list': o.list = true; break
      case '-h': case '--help': o.help = true; break
      default: throw new Error(`未知的參數:${a}`)
    }
  }
  if (!o.out) o.out = path.join('docs', 'perf', `run-${stamp(now)}.md`)
  return o
}

const pad = (n) => String(n).padStart(2, '0')
/** `YYYYMMDD-HHMMSS`(本機時間) */
export const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/** 樣本數:每秒一個,至少 8 */
export const sampleCount = (seconds) => Math.max(8, Math.round(seconds))

// ---------------------------------------------------------------- 行程

const baseName = (n) => String(n ?? '').toLowerCase().replace(/\.exe$/, '')

/** 純函式:行程快照 + 主行程名稱 → 主行程與全部子孫的 pid(依 ParentProcessId) */
export function processTree (procs, rootName) {
  const want = baseName(rootName)
  const kids = new Map()
  for (const p of procs) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, [])
    kids.get(p.ppid).push(p.pid)
  }
  const out = new Set()
  const stack = procs.filter(p => baseName(p.name) === want).map(p => p.pid)
  while (stack.length) {
    const pid = stack.pop()
    if (out.has(pid)) continue
    out.add(pid)
    for (const k of kids.get(pid) ?? []) if (k !== pid) stack.push(k)
  }
  return out
}

/** 純函式:同名行程(遊戲)的 pid */
export function processesNamed (procs, name) {
  const want = baseName(name)
  return new Set(procs.filter(p => baseName(p.name) === want).map(p => p.pid))
}

const r1 = (n) => Math.round(n * 10) / 10

/**
 * 純函式:開始 / 結束兩次快照 → 一組行程的 CPU %(工作管理員基準)與結束時工作集。
 * 結束時才出現的(量測期間啟動,例如 WinOcr 的 PowerShell)整段 CPU 都算;量測期間結束的拿不到(`exited` 計數)。
 */
export function cpuOf (start, end, pidsStart, pidsEnd, wallSec, cores) {
  const s = new Map(start.filter(p => pidsStart.has(p.pid)).map(p => [p.pid, p]))
  let cpuSec = 0
  let wsBytes = 0
  const procs = []
  for (const p of end) {
    if (!pidsEnd.has(p.pid)) continue
    const before = s.get(p.pid)
    // pid 被重複使用(建立時間不同)= 新行程
    const d = before && before.created === p.created ? p.cpu - before.cpu : p.cpu
    cpuSec += Math.max(0, d)
    wsBytes += p.ws
    procs.push({ pid: p.pid, name: p.name, cpuPct: r1(wallSec > 0 ? Math.max(0, d) / (wallSec * cores) * 100 : 0), wsMB: r1(p.ws / 1048576) })
  }
  const exited = [...s.keys()].filter(pid => !end.some(p => p.pid === pid && pidsEnd.has(pid))).length
  return {
    cpuPct: r1(wallSec > 0 ? cpuSec / (wallSec * cores) * 100 : 0),
    wsMB: r1(wsBytes / 1048576),
    count: procs.length,
    exited,
    procs: procs.sort((a, b) => b.cpuPct - a.cpuPct || b.wsMB - a.wsMB)
  }
}

/**
 * 純函式:GPU 計數器樣本 → 平均。`samples` = 每秒一個 `{ cpu: 系統 CPU %, gpu: { [pid]: [全部引擎加總, 3D 引擎加總] } }`。
 * 回傳本程式 / 遊戲(全部引擎)與系統(3D 引擎,所有行程)平均。
 */
export function gpuOf (samples, appPids, gamePids) {
  const n = samples.length
  if (!n) return { n: 0, appGpu: null, gameGpu: null, sys3d: null, sysCpu: null }
  let app = 0; let game = 0; let sys = 0; let cpu = 0; let cpuN = 0
  for (const s of samples) {
    for (const [pidStr, v] of Object.entries(s.gpu ?? {})) {
      const pid = Number(pidStr)
      const all = Number(v?.[0]) || 0
      const d3 = Number(v?.[1]) || 0
      if (appPids.has(pid)) app += all
      if (gamePids && gamePids.has(pid)) game += all
      sys += d3
    }
    if (typeof s.cpu === 'number' && Number.isFinite(s.cpu)) { cpu += s.cpu; cpuN++ }
  }
  return {
    n,
    appGpu: r1(app / n),
    gameGpu: gamePids ? r1(game / n) : null,
    sys3d: r1(sys / n),
    sysCpu: cpuN ? r1(cpu / cpuN) : null
  }
}

// ---------------------------------------------------------------- PresentMon

/**
 * 純函式:PresentMon CSV → FPS 平均 / 1% low。幀時間欄位依序找 `MsBetweenPresents`、`msBetweenPresents`、`FrameTime`。
 * 1% low = 最慢 1%(至少 1 幀)幀時間的平均換算成 FPS。沒有可用的幀 → null。
 */
export function parsePresentMonCsv (text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return null
  const head = lines[0].split(',').map(h => h.trim())
  const col = ['MsBetweenPresents', 'msBetweenPresents', 'FrameTime'].map(h => head.indexOf(h)).find(i => i >= 0)
  if (col == null) return null
  const ft = []
  for (const l of lines.slice(1)) {
    const v = Number(l.split(',')[col])
    if (Number.isFinite(v) && v > 0) ft.push(v)
  }
  if (!ft.length) return null
  const mean = ft.reduce((a, b) => a + b, 0) / ft.length
  const sorted = [...ft].sort((a, b) => b - a)
  const k = Math.max(1, Math.floor(sorted.length * 0.01))
  const worst = sorted.slice(0, k).reduce((a, b) => a + b, 0) / k
  return { frames: ft.length, fpsAvg: r1(1000 / mean), fps1Low: r1(1000 / worst) }
}

/** PATH 上的 PresentMon(找不到回 null) */
export function findPresentMon (envPath = process.env.PATH ?? '', exists = fs.existsSync, readdir = (d) => { try { return fs.readdirSync(d) } catch { return [] } }) {
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const plain = path.join(dir, 'PresentMon.exe')
    if (exists(plain)) return plain
    const hit = readdir(dir).find(f => /^presentmon.*\.exe$/i.test(f))
    if (hit) return path.join(dir, hit)
  }
  return null
}

// ---------------------------------------------------------------- 表格

const cell = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`)
const delta = (v, b) => {
  if (v == null || b == null) return '—'
  const d = r1(v - b)
  return d > 0 ? `+${d}` : String(d)
}

/** 純函式:量測結果 → Markdown(情境 × 指標 + 與「無程式基準」的差值 + 行程明細) */
export function buildMarkdown (meta, results) {
  const L = []
  L.push(`# ExileAppraiser 情境效能量測 ${meta.when}`)
  L.push('')
  L.push(`- 標籤:${meta.label || '(無)'}`)
  L.push(`- 硬體加速:${meta.hwaccel ?? '(未標記)'}`)
  L.push(`- 每情境 ${meta.seconds} 秒、GPU 計數器每秒一個樣本;邏輯處理器 ${meta.cores};主行程名稱 \`${meta.app}\``)
  L.push(`- 遊戲行程:${meta.game ? `\`${meta.game}\`` : '(未指定,不量遊戲)'}`)
  L.push(`- FPS:${meta.presentMon ? `PresentMon(\`${meta.presentMon}\`)` : '**無 FPS**(本機 PATH 沒有 PresentMon)'}`)
  L.push(`- 主機:${meta.host}(${meta.os})`)
  L.push('')
  L.push('## 各情境')
  L.push('')
  L.push('| 情境 | 硬體加速 | 樣本 | 本程式 CPU % | 本程式 GPU % | 本程式 WS MB | 行程數 | 系統 CPU % | 系統 3D % | 遊戲 CPU % | 遊戲 GPU % | FPS 平均 | FPS 1% low |')
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    if (r.skipped) { L.push(`| ${r.title}(\`${r.id}\`) | ${meta.hwaccel ?? '—'} | 略過 | — | — | — | — | — | — | — | — | — | — |`); continue }
    const fps = r.fps ? r.fps : null
    L.push(`| ${r.title}(\`${r.id}\`) | ${meta.hwaccel ?? '—'} | ${r.gpu.n} | ${cell(r.app.cpuPct)} | ${cell(r.gpu.appGpu)} | ${cell(r.app.wsMB)} | ${r.app.count} | ` +
      `${cell(r.gpu.sysCpu)} | ${cell(r.gpu.sys3d)} | ${cell(r.game?.cpuPct)} | ${cell(r.gpu.gameGpu)} | ` +
      `${fps ? fps.fpsAvg : meta.presentMon && meta.game ? '失敗' : '無 FPS'} | ${fps ? fps.fps1Low : '—'} |`)
  }
  const base = results.find(r => r.baseline && !r.skipped)
  L.push('')
  L.push('## 與基準(無程式)的差值')
  L.push('')
  if (!base) {
    L.push('沒有量「無程式基準」(`no-app`),不算差值。')
  } else {
    L.push('| 情境 | 系統 CPU Δ | 系統 3D Δ | 遊戲 CPU Δ | 遊戲 GPU Δ | FPS 平均 Δ | FPS 1% low Δ |')
    L.push('|---|---|---|---|---|---|---|')
    for (const r of results) {
      if (r.skipped || r === base) continue
      L.push(`| ${r.title}(\`${r.id}\`) | ${delta(r.gpu.sysCpu, base.gpu.sysCpu)} | ${delta(r.gpu.sys3d, base.gpu.sys3d)} | ` +
        `${delta(r.game?.cpuPct, base.game?.cpuPct)} | ${delta(r.gpu.gameGpu, base.gpu.gameGpu)} | ` +
        `${delta(r.fps?.fpsAvg, base.fps?.fpsAvg)} | ${delta(r.fps?.fps1Low, base.fps?.fps1Low)} |`)
    }
  }
  L.push('')
  L.push('## 行程明細(本程式,依 CPU 排序)')
  L.push('')
  for (const r of results) {
    if (r.skipped) continue
    const list = r.app.procs.map(p => `${p.name}#${p.pid} ${p.cpuPct}% / ${p.wsMB} MB`).join('、') || '(沒有找到本程式行程)'
    const warn = []
    if (r.baseline && r.app.count) warn.push('⚠ 基準情境仍找到本程式行程')
    if (!r.baseline && !r.app.count) warn.push('⚠ 沒有找到本程式行程')
    if (r.app.exited) warn.push(`量測期間結束 ${r.app.exited} 個(CPU 沒算到)`)
    if (r.gpu.n < 8) warn.push(`GPU 樣本只有 ${r.gpu.n} 個(< 8)`)
    if (r.fpsError) warn.push(`PresentMon:${r.fpsError}`)
    L.push(`- **${r.title}**:${list}${warn.length ? `(${warn.join(';')})` : ''}`)
  }
  L.push('')
  L.push('指標定義與情境說明見 `docs/perf/README.md`。')
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------- 量測(PowerShell,只讀)

/**
 * 量測腳本:開始快照(Win32_Process)→ Get-Counter 每秒一次(全部 GPU 引擎 + 系統 CPU)→ 結束快照;JSON 一行輸出。
 * GPU 引擎依 instance 名稱的 `pid_<pid>_` 分組,每個 pid 輸出 [全部引擎加總, 3D 引擎加總]。
 */
export function measureScript (samples) {
  return `
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Snap {
  Get-CimInstance Win32_Process | ForEach-Object {
    $c = 0; if ($_.CreationDate) { $c = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }
    [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name;
      cpu = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 1e7; ws = [double]$_.WorkingSetSize; created = $c }
  }
}
$t0 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$start = @(Snap)
$out = New-Object System.Collections.ArrayList
$sets = Get-Counter -Counter @('\\GPU Engine(*)\\Utilization Percentage', '\\Processor Information(_Total)\\% Processor Utility', '\\Processor(_Total)\\% Processor Time') -SampleInterval 1 -MaxSamples ${Math.max(1, Math.round(samples))} -ErrorAction SilentlyContinue
foreach ($set in $sets) {
  $g = @{}; $cpu = $null; $cpuOld = $null
  foreach ($s in $set.CounterSamples) {
    if ($s.Path -like '*processor information(_total)*') { $cpu = [double]$s.CookedValue; continue }
    if ($s.Path -like '*processor(_total)*') { $cpuOld = [double]$s.CookedValue; continue }
    if ($s.InstanceName -match '^pid_(\\d+)_') {
      $k = $Matches[1]
      if (-not $g.ContainsKey($k)) { $g[$k] = @(0.0, 0.0) }
      $g[$k][0] += [double]$s.CookedValue
      if ($s.InstanceName -like '*engtype_3d') { $g[$k][1] += [double]$s.CookedValue }
    }
  }
  if ($null -eq $cpu) { $cpu = $cpuOld }
  [void]$out.Add([pscustomobject]@{ cpu = $cpu; gpu = $g })
}
$end = @(Snap)
$t1 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
[pscustomobject]@{ t0 = $t0; t1 = $t1; cores = [Environment]::ProcessorCount; start = $start; end = $end; samples = @($out) } | ConvertTo-Json -Depth 6 -Compress
`
}

function runPowerShell (script) {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(script, 'utf16le').toString('base64')
    child_process.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) { reject(new Error(`${err.message}\n${stderr}`)); return }
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
        try { resolve(JSON.parse(line)) } catch (e) { reject(new Error(`PowerShell 輸出不是 JSON:${line.slice(0, 200)}`)) }
      })
  })
}

/** PresentMon 量 `seconds` 秒(遊戲行程),回傳 CSV 文字 */
function runPresentMon (exe, game, seconds) {
  const csv = path.join(os.tmpdir(), `exile-appraiser-perf-${process.pid}-${Date.now()}.csv`)
  const name = /\.exe$/i.test(game) ? game : `${game}.exe`
  return new Promise((resolve, reject) => {
    child_process.execFile(exe, [
      '--process_name', name, '--output_file', csv, '--timed', String(seconds), '--terminate_after_timed',
      '--stop_existing_session', '--session_name', 'ExileAppraiserPerf', '--no_console_stats'
    ], { windowsHide: true, timeout: (seconds + 30) * 1000 }, (err) => {
      let text = null
      try { text = fs.readFileSync(csv, 'utf8') } catch { /* 沒產生 */ }
      try { fs.rmSync(csv, { force: true }) } catch { /* ignore */ }
      if (text) resolve(text)
      else reject(err ?? new Error('沒有輸出(可能需要以系統管理員或 Performance Log Users 群組執行)'))
    })
  })
}

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

/** 一個情境:PowerShell 量測(+ 可選 PresentMon)→ 結果 */
async function measureScenario (sc, opts, presentMon) {
  const n = sampleCount(opts.seconds)
  const pm = presentMon && opts.game ? runPresentMon(presentMon, opts.game, n).then(parsePresentMonCsv, (e) => ({ error: e.message })) : null
  const raw = await runPowerShell(measureScript(n))
  const start = asArray(raw.start)
  const end = asArray(raw.end)
  const samples = asArray(raw.samples)
  const wall = Math.max(0.001, (raw.t1 - raw.t0) / 1000)
  const appStart = processTree(start, opts.app)
  const appEnd = processTree(end, opts.app)
  const app = cpuOf(start, end, appStart, appEnd, wall, raw.cores)
  let game = null
  let gamePids = null
  if (opts.game) {
    const gs = processesNamed(start, opts.game)
    gamePids = processesNamed(end, opts.game)
    game = cpuOf(start, end, gs, gamePids, wall, raw.cores)
  }
  const allApp = new Set([...appStart, ...appEnd])
  const gpu = gpuOf(samples, allApp, gamePids)
  let fps = null
  let fpsError = null
  if (pm) {
    const r = await pm
    if (r && r.error) fpsError = r.error
    else if (r) fps = r
    else fpsError = 'CSV 沒有可用的幀(遊戲不在前景 / 名稱不符?)'
  }
  return { id: sc.id, title: sc.title, baseline: Boolean(sc.baseline), wallSec: r1(wall), cores: raw.cores, app, game, gpu, fps, fpsError }
}

// ---------------------------------------------------------------- 主程式

function usage () {
  const head = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).slice(0, 18)
  console.log(head.map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
}

async function main () {
  let opts
  try { opts = parseArgs(process.argv.slice(2)) } catch (e) { console.error(e.message); usage(); process.exit(2) }
  if (opts.help) { usage(); return }
  if (opts.list) {
    for (const s of SCENARIOS) console.log(`${s.id.padEnd(11)} ${s.title}:${s.setup}`)
    return
  }
  if (process.platform !== 'win32') { console.error('只支援 Windows(Get-Counter / Win32_Process)'); process.exit(2) }
  const presentMon = findPresentMon()
  const list = opts.only ? SCENARIOS.filter(s => opts.only.includes(s.id)) : SCENARIOS
  console.log(`情境量測:${list.length} 個情境 × ${opts.seconds} 秒;FPS ${presentMon ? `用 ${presentMon}` : '無(PATH 沒有 PresentMon)'}${opts.game ? `;遊戲 ${opts.game}` : ''}`)
  console.log('本腳本不送任何鍵盤 / 滑鼠輸入;每個情境請你手動擺好,再回到這裡按 Enter。輸入 s 跳過、q 結束(已量的照樣存檔)。\n')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const lines = []
  let waiting = null
  let closed = false
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l) } else lines.push(l) })
  rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(null) } })
  const ask = (q) => {
    process.stdout.write(q)
    if (lines.length) return Promise.resolve(lines.shift())
    if (closed) return Promise.resolve(null)
    return new Promise((resolve) => { waiting = resolve })
  }

  const results = []
  const when = new Date()
  for (const [i, sc] of list.entries()) {
    console.log(`\n[${i + 1}/${list.length}] ${sc.title}(${sc.id})`)
    console.log(`  請擺好:${sc.setup}`)
    const ans = await ask('  準備好按 Enter 開始(s 跳過 / q 結束):')
    const a = (ans ?? '').trim().toLowerCase()
    if (ans == null || a === 'q') { console.log('  結束'); break }
    if (a === 's') { results.push({ id: sc.id, title: sc.title, baseline: Boolean(sc.baseline), skipped: true }); continue }
    for (let d = opts.delay; d > 0; d--) {
      process.stdout.write(`\r  ${d} 秒後開始…(現在切回遊戲並擺好狀態)   `)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    process.stdout.write(`\r  量測中(約 ${sampleCount(opts.seconds)} 秒)…                       \n`)
    try {
      const r = await measureScenario(sc, opts, presentMon)
      results.push(r)
      console.log(`  本程式 CPU ${r.app.cpuPct}% GPU ${r.gpu.appGpu}% WS ${r.app.wsMB} MB(${r.app.count} 個行程)| 系統 CPU ${r.gpu.sysCpu}% 3D ${r.gpu.sys3d}%` +
        (r.game ? ` | 遊戲 CPU ${r.game.cpuPct}% GPU ${r.gpu.gameGpu}%` : '') + (r.fps ? ` | FPS ${r.fps.fpsAvg} / 1% ${r.fps.fps1Low}` : ''))
    } catch (e) {
      console.error(`  量測失敗:${e.message}`)
      results.push({ id: sc.id, title: sc.title, baseline: Boolean(sc.baseline), skipped: true })
    }
  }
  rl.close()
  if (!results.length) { console.log('沒有任何結果,不存檔'); return }

  const meta = {
    when: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`,
    label: opts.label, hwaccel: opts.hwaccel, seconds: opts.seconds, cores: os.cpus().length, app: opts.app, game: opts.game,
    presentMon, host: os.hostname(), os: `${os.type()} ${os.release()}`
  }
  const out = path.resolve(ROOT, opts.out)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, buildMarkdown(meta, results))
  fs.writeFileSync(out.replace(/\.md$/i, '') + '.json', JSON.stringify({ meta, results }, null, 2) + '\n')
  console.log(`\n已存:${out}(原始數字:同名 .json)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
