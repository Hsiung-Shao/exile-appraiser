# v0.1.2 情境效能基準(待量測)

> **狀態:空表模板,待使用者實機跑。** 情境需要手動操作遊戲,Claude 不代跑。
> 量完把 `scripts/perf-scenario.mjs` 產生的表格貼進下方(或直接把 `--out` 指到這個檔覆蓋),並填「量測環境」。

## 怎麼跑

```bash
# 1) 硬體加速關(v0.1.2 現況:main.ts 無條件 app.disableHardwareAcceleration())
node scripts/perf-scenario.mjs --game <遊戲行程名稱> --hwaccel off --label v0.1.2 --out docs/perf/run-v0.1.2-hwaccel-off.md
# 2) 硬體加速開:v0.1.2 沒有開關,需要步 30.5 的測試版(或本機改掉 disableHardwareAcceleration 的建置)才量得到
node scripts/perf-scenario.mjs --game <遊戲行程名稱> --hwaccel on --label v0.1.2+hwaccel --out docs/perf/run-v0.1.2-hwaccel-on.md
```

建議同時開「設定 › 記錄 › 效能」(或 `--perf-log`),事後用 `perf-<日期>.log` 對照每個情境的掃描 / 掛鉤 / 列舉次數。
情境定義與指標意思見 `README.md`。

## 量測環境(待填)

| 項目 | 值 |
|---|---|
| 日期 | |
| ExileAppraiser 版本 | v0.1.2 |
| 遊戲 / 行程名稱 | |
| 遊戲畫面模式 / 解析度 | |
| CPU / 邏輯處理器 | |
| GPU / 驅動 | |
| 螢幕數 / 遊戲在哪個螢幕 | |
| PresentMon | 有 / 無(無 = 表內「無 FPS」) |
| 每情境秒數 | 60 |

## 各情境(待量測)

| 情境 | 硬體加速 | 樣本 | 本程式 CPU % | 本程式 GPU % | 本程式 WS MB | 行程數 | 系統 CPU % | 系統 3D % | 遊戲 CPU % | 遊戲 GPU % | FPS 平均 | FPS 1% low |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 無程式基準(`no-app`) | off | | | | | | | | | | | |
| 遊戲沒開(`no-game`) | off | | | | | | | | | | | |
| 遊戲開、不在前景(`game-bg`) | off | | | | | | | | | | | |
| 前景無面板(`fg-idle`) | off | | | | | | | | | | | |
| 查價面板開(`panel`) | off | | | | | | | | | | | |
| 褻瀆 OCR 開(`ocr-reveal`) | off | | | | | | | | | | | |
| 符文 OCR 開(`ocr-rune`) | off | | | | | | | | | | | |
| 背景圖開(`bg-on`) | off | | | | | | | | | | | |
| 設定視窗開(`settings`) | off | | | | | | | | | | | |
| window 模式(`window`) | off | | | | | | | | | | | |
| 無程式基準(`no-app`) | on | | | | | | | | | | | |
| 遊戲沒開(`no-game`) | on | | | | | | | | | | | |
| 遊戲開、不在前景(`game-bg`) | on | | | | | | | | | | | |
| 前景無面板(`fg-idle`) | on | | | | | | | | | | | |
| 查價面板開(`panel`) | on | | | | | | | | | | | |
| 褻瀆 OCR 開(`ocr-reveal`) | on | | | | | | | | | | | |
| 符文 OCR 開(`ocr-rune`) | on | | | | | | | | | | | |
| 背景圖開(`bg-on`) | on | | | | | | | | | | | |
| 設定視窗開(`settings`) | on | | | | | | | | | | | |
| window 模式(`window`) | on | | | | | | | | | | | |

## 與基準(無程式)的差值(待量測)

| 情境 | 硬體加速 | 系統 CPU Δ | 系統 3D Δ | 遊戲 CPU Δ | 遊戲 GPU Δ | FPS 平均 Δ | FPS 1% low Δ |
|---|---|---|---|---|---|---|---|
| (量完由腳本產生) | | | | | | | |

## 觀察(待填)

- 
