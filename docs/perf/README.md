# 效能量測(第 29 步)

兩套工具,量同一組情境:

| 工具 | 在哪裡跑 | 量什麼 | 什麼時候用 |
|---|---|---|---|
| **內建診斷** `perf-monitor` | ExileAppraiser 自己(main 行程) | 本程式各行程 CPU / 記憶體、主行程卡頓、uiohook 事件數、掃描擷取 / OCR 次數、視窗列舉次數、**自動標記目前情境** | 長時間掛著看「哪個情境在吃資源」、使用者回報變慢時請他開 |
| **外部腳本** `scripts/perf-scenario.mjs` | 另一個終端機 | 本程式全部行程(含 WinOcr 的 PowerShell)的 CPU / GPU / 工作集、系統 CPU / 3D、遊戲行程 CPU / GPU、(有 PresentMon 時)遊戲 FPS | 改版前後逐情境比較、發版前回歸(步 31) |

兩者都**不送任何鍵盤 / 滑鼠輸入**、不切換視窗、不上傳;資料只存本機。

## 內建診斷(perf-log)

### 開啟
- **設定 › 記錄 › 效能**:勾「記錄效能診斷」,立即生效;開關存在 `%APPDATA%\exile-appraiser\perf.json`(`{"enabled": true}`),下次啟動照樣開。
  不寫進 `config.json`、不進 host-config —— 關著時程式行為與 v0.1.2 完全相同。
- **命令列** `--perf-log`:這次啟動就開(例:`ExileAppraiser.exe --perf-log`;開發版 `npx electron main/dist/main.js --perf-log`)。
  設定頁會顯示「這次以 --perf-log 參數啟動」;在設定頁關掉 = 這次執行停止,並把 perf.json 設成關。
- 「開啟效能記錄檔」按鈕用系統預設程式開今天的檔(還沒有就開記錄資料夾)。瀏覽器預覽端沒有效能區。

### 輸出
每 5 秒一筆,兩個出口:
1. **app-log 一行摘要**(設定 › 記錄 看得到,也進 `exile-appraiser-<日期>.log`):
   ```
   [perf] 情境 fg-idle+reveal | CPU 3.1%(Browser 1.2 GPU 0.4 Tab 1.5 Utility 0)WS 412.3 MB | 卡頓 p95 1.2 / 最長 9.8 ms | uiohook 0/s | 褻瀆 擷取 1/s OCR 0.2/s | 符文 disabled | 列舉 0 | 視窗 顯示 | WinOcr pid 12345
   ```
2. **`userData/logs/perf-<YYYY-MM-DD>.log`**:JSONL(一行一筆 JSON),沿用 app-log 的 `LogFileWriter` —— 非同步寫、單檔 20 MB 換 `.1`、跨日換檔、保留 7 天(只刪 `perf-<日期>.log[.1]`)。

JSONL 欄位(`v: 1`):

| 欄位 | 意思 |
|---|---|
| `ts` / `time` | epoch ms / 本機時間 |
| `windowMs` | 這筆涵蓋的時間(上一筆到這一筆) |
| `scenario` | 情境鍵(見下方「情境定義」) |
| `tags` | 情境各旗標:`mode`、`game`(absent / background / foreground / unknown)、`panel` / `settings` / `picker`、`revealOcr` / `runeOcr`、`bg`、`windowVisible` |
| `cpu.total` / `cpu.byType` | Electron `app.getAppMetrics()` 的 `percentCPUUsage` 加總 / 依行程類型(Browser = main、GPU、Tab = renderer、Utility…)。**單核 100% 為基準**,自上一筆起的平均;外部腳本用的是工作管理員基準(÷ 邏輯處理器數),兩者要換算才能比 |
| `wsMB` | 工作集(MB),加總 / 依類型 |
| `procs` | 逐行程 `{pid, type, name?, cpu, wsMB}`(getAppMetrics 不含 WinOcr 的 PowerShell;它在 `winOcr.pid`,外部腳本會量) |
| `lag` | main 事件迴圈卡頓 `{n, p95, max}`(ms):每 20 ms 排一次 setTimeout,實際間隔 − 20。**Windows 預設計時器解析度約 15.6 ms**,setTimeout(20) 實際約 31 ms 才觸發,所以閒置時 p95 約 11–12 ms 是底噪(本機實測 p95 12 / 最長 12–26 ms,程式閒置、遊戲沒開);比情境看差值與最長值 |
| `uiohook` | `evPerSec` = 全域掛鉤每秒事件數(滑鼠移動 / 按鍵 / 滾輪,掛鉤沒開 = 0)、`running` / `holders` = uiohookGate 是否持有 / 持有者數 |
| `reveal` / `rune` | 褻瀆 / 符文 PanelScan:`state`(`active` 或被擋原因)、`ticks`、`capPerSec`(擷取請求,含 100 ms 內共用同一張)、`ocrPerSec`(區域 OCR)、`locates`(整畫面定位 OCR)、`skippedUnchanged` / `skippedBusy`、`blocked`(這段時間被 scanBlock 擋下的 tick 依原因) |
| `detect` | GameDetector:`enums` = `desktopCapturer.getSources` 視窗列舉次數、`processProbes` = PowerShell 確認次數、`running` |
| `winOcr` | WinOcr 常駐 PowerShell 是否在跑、pid |

快速統計(PowerShell):
```powershell
Get-Content "$env:APPDATA\exile-appraiser\logs\perf-2026-10-03.log" | ConvertFrom-Json |
  Group-Object scenario | ForEach-Object { [pscustomobject]@{ 情境 = $_.Name; 筆數 = $_.Count;
    CPU = [math]::Round(($_.Group.cpu.total | Measure-Object -Average).Average, 2);
    WS = [math]::Round(($_.Group.wsMB.total | Measure-Object -Average).Average, 1) } }
```

### 成本
- **關著**:不開計時器、不掛 uiohook 監聽、不建寫檔器、不讀設定檔;只有各模組計數器的 `++`
  (`GameDetector` `detectorCounters`、`PanelScan` `sched.captures` / `blockCounts`)與啟動時讀一次 `perf.json`。
- **開著**:每 5 秒一次 getAppMetrics + 讀一次 `config.json`(背景圖旗標)+ 一行 log + 一行 JSONL;卡頓探針每 20 ms 一個 setTimeout;
  uiohook 監聽只做 `++`。本身的負擔會算進 Browser 行程的 CPU —— 比較情境時全程開著,差值才公平。

## 外部腳本 `scripts/perf-scenario.mjs`

```bash
node scripts/perf-scenario.mjs --list                                   # 情境清單
node scripts/perf-scenario.mjs --game PathOfExile --hwaccel off --label v0.1.2
node scripts/perf-scenario.mjs --only no-app,fg-idle,panel --seconds 30 --game PathOfExileSteam
node scripts/perf-scenario.mjs --app electron ...                       # 開發版(npx electron main)
```

| 參數 | 預設 | 說明 |
|---|---|---|
| `--seconds` | 60 | 每個情境量幾秒;GPU 計數器每秒一個樣本,少於 8 自動補到 8 |
| `--delay` | 5 | 按 Enter 後等幾秒才開始(給你切回遊戲) |
| `--app` | ExileAppraiser | 主行程名稱;子孫行程(GPU / renderer / utility / WinOcr 的 powershell / conhost)依 ParentProcessId 一起算 |
| `--game` | (無) | 遊戲行程名稱(工作管理員「詳細資料」的名稱去掉 .exe,例 `PathOfExile`、`PathOfExileSteam`、`PathOfExile_x64Steam`)。不給就不量遊戲 |
| `--hwaccel on\|off` | (未標記) | **只是標籤**,記在表頭與每列;要真的切換硬體加速請照步 30.5 的設定 |
| `--label` | | 表頭附註(版本、改了什麼) |
| `--only id,id` | 全部 | 只跑這些情境 |
| `--out` | `docs/perf/run-<日期時間>.md` | Markdown;同名 `.json` 存原始數字(步 31 回歸比對用) |

流程:每個情境印出「請擺好:…」,你手動把程式 / 遊戲擺成那個狀態,回終端機按 Enter(`s` 跳過、`q` 結束,已量的照樣存),
倒數 `--delay` 秒後量 `--seconds` 秒。**腳本不送任何輸入、不切視窗、不關 / 開任何程式**。

### 指標
| 欄 | 來源 | 意思 |
|---|---|---|
| 本程式 CPU % | `Win32_Process` Kernel + User 時間,開始 / 結束兩次快照 | CPU 時間差 ÷(經過秒數 × 邏輯處理器數)× 100 = 工作管理員基準。量測中才啟動的子行程整段算;量測中結束的算不到(明細會標「量測期間結束 N 個」) |
| 本程式 GPU % | `\GPU Engine(*)\Utilization Percentage`,instance 名稱 `pid_<pid>_…` 屬於本程式的全部引擎加總 | 每秒一個樣本的平均(≥ 8 個)。用 `pid_<pid>_` 比對,避免 pid 前綴相同的行程混進來 |
| 本程式 WS MB | 結束快照的 WorkingSetSize 加總 | |
| 系統 CPU % | `\Processor Information(_Total)\% Processor Utility`(沒有才用 `\Processor(_Total)\% Processor Time`) | 與工作管理員相同;有些機器的 `Processor` 物件不存在(本機實測) |
| 系統 3D % | 所有行程 `engtype_3D` 引擎加總 | 多張卡 / 多個 3D 引擎時可能 > 100,**只看差值** |
| 遊戲 CPU % / GPU % | 同上,換成 `--game` 的行程 | |
| FPS 平均 / 1% low | PresentMon(PATH 上有 `PresentMon.exe` 或 `PresentMon-*.exe` 才量) | 平均 = 1000 ÷ 平均幀時間;1% low = 最慢 1% 幀的平均幀時間換算。沒有 PresentMon → 表格寫「無 FPS」;PresentMon 通常要系統管理員或 Performance Log Users 群組 |

差值表:每個情境 − 「無程式基準」(`no-app`)的系統 CPU / 系統 3D / 遊戲 CPU / 遊戲 GPU / FPS。本程式自己的欄位在基準情境是 0,直接看絕對值。

## 情境定義

內建診斷的情境鍵 = 基本情境 + 附加旗標(`+reveal` 褻瀆 OCR 開、`+rune` 符文 OCR 開、`+bg` 背景圖開且查價面板 / 設定開著)。
「OCR 開」= 啟用 + PoE2 + overlay + 沒被使用者暫停(遊戲失焦、面板開著造成的暫時停也算開);PoE1 一律關。

| 腳本 id | 名稱 | 要擺成的狀態 | 內建診斷情境鍵 |
|---|---|---|---|
| `no-app` | 無程式基準 | 結束 ExileAppraiser;遊戲照要比較的狀態開著(建議前景、城鎮不動) | (程式沒開) |
| `no-game` | 遊戲沒開 | 程式開(overlay、預設設定),遊戲關 | `no-game` |
| `game-bg` | 遊戲開、不在前景 | 遊戲開著但切到別的視窗 | `game-bg` |
| `fg-idle` | 前景無面板 | 遊戲前景、城鎮不動;查價面板關;褻瀆 / 符文自動辨識都關 | `fg-idle` |
| `panel` | 查價面板開 | 查一件物品後面板停在畫面上;背景圖關 | `panel` |
| `ocr-reveal` | 褻瀆 OCR 開 | PoE2;褻瀆自動辨識開(符文關);面板關 | `fg-idle+reveal` |
| `ocr-rune` | 符文 OCR 開 | PoE2;符文塑形自動辨識開(褻瀆關);面板關 | `fg-idle+rune` |
| `bg-on` | 背景圖開 | 啟用背景圖並選圖;查價面板開著 | `panel+bg` |
| `settings` | 設定視窗開 | 設定視窗(一般分頁)開著 | `settings`(框選層 = `picker`) |
| `window` | window 模式 | 關掉 overlay 模式(重新啟動成小視窗),視窗顯示 | `window`(遊戲 / 面板狀態 = unknown) |

注意:PoE2 的褻瀆自動辨識**預設開**,量 `fg-idle` / `panel` 前要先關掉,不然數字會含 OCR。
window 模式下 main 不知道遊戲 / 查價面板 / 設定的狀態(renderer 只在 overlay 回報),情境鍵只有 `window`(+`bg`)。

## 基準表

- `baseline-v0.1.2.md`:v0.1.2 現況(待使用者實機跑,8 情境 × 硬體加速 開 / 關)。
- 之後每步(30.x)改完重跑對應情境,改前改後數字寫進該步的說明;步 31 起發版前跑一次並與上一版比較。
- `changes-round5.md`:30.2(PanelScan 閒置)/ 30.3(GameDetector 退避)/ 30.8(Prices 定期更新)/ 30.6(背景圖)改前改後、30.7(overlay 原生 hook thread)調查結論,含不靠遊戲的 no-game 量測做法與 renderer 成本的 offscreen 量法。
