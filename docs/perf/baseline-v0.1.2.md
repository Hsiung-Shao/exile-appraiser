# ExileAppraiser 情境效能量測 2026-10-03 13:21

- 標籤:v0.1.2
- 硬體加速:off
- 每情境 60 秒、GPU 計數器每秒一個樣本;邏輯處理器 16;主行程名稱 `ExileAppraiser`
- 遊戲行程:`PathOfExile`
- FPS:**無 FPS**(本機 PATH 沒有 PresentMon)
- 主機:Hsiung(Windows_NT 10.0.26100)

> ⚠ 本表「無程式基準(no-app)」那列量測時程式其實仍在執行(見行程明細),**無效**;有效基準見 `baseline-v0.1.2-noapp.md`(2026-10-04 另日量測,場景不同,跨日數字只能粗比)。下方差值表因此不可用。

## 各情境

| 情境 | 硬體加速 | 樣本 | 本程式 CPU % | 本程式 GPU % | 本程式 WS MB | 行程數 | 系統 CPU % | 系統 3D % | 遊戲 CPU % | 遊戲 GPU % | FPS 平均 | FPS 1% low |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 無程式基準(`no-app`) | off | 60 | 2.5 | 0 | 1155.4 | 6 | 56.3 | 98.1 | 8.1 | 92.1 | 無 FPS | — |
| 遊戲沒開(`no-game`) | off | 60 | 0.8 | 0 | 1047.5 | 6 | 43.7 | 3.8 | 0 | 0 | 無 FPS | — |
| 遊戲開、不在前景(`game-bg`) | off | 60 | 0.8 | 0 | 703.6 | 6 | 53.2 | 97.7 | 9.9 | 92.5 | 無 FPS | — |
| 前景無面板(`fg-idle`) | off | 60 | 0.7 | 0 | 954.7 | 6 | 52.8 | 97.6 | 9.7 | 95.1 | 無 FPS | — |
| 查價面板開(`panel`) | off | 60 | 0.8 | 0 | 1162.6 | 6 | 53.6 | 98 | 10 | 92.1 | 無 FPS | — |
| 褻瀆 OCR 開(`ocr-reveal`) | off | 60 | 2.1 | 0 | 1087.6 | 6 | 56.1 | 97.4 | 9.3 | 91.3 | 無 FPS | — |
| 符文 OCR 開(`ocr-rune`) | off | 60 | 0.2 | 0 | 1006 | 6 | 51.9 | 97.4 | 8.3 | 91.6 | 無 FPS | — |
| 背景圖開(`bg-on`) | off | 60 | 0.8 | 0 | 1007.2 | 6 | 52.1 | 98.4 | 9 | 92.7 | 無 FPS | — |
| 設定視窗開(`settings`) | off | 60 | 0.7 | 0 | 1007.3 | 6 | 56 | 98.2 | 12.8 | 92.3 | 無 FPS | — |
| window 模式(`window`) | off | 略過 | — | — | — | — | — | — | — | — | — | — |

## 與基準(無程式)的差值

| 情境 | 系統 CPU Δ | 系統 3D Δ | 遊戲 CPU Δ | 遊戲 GPU Δ | FPS 平均 Δ | FPS 1% low Δ |
|---|---|---|---|---|---|---|
| 遊戲沒開(`no-game`) | -12.6 | -94.3 | -8.1 | -92.1 | — | — |
| 遊戲開、不在前景(`game-bg`) | -3.1 | -0.4 | +1.8 | +0.4 | — | — |
| 前景無面板(`fg-idle`) | -3.5 | -0.5 | +1.6 | +3 | — | — |
| 查價面板開(`panel`) | -2.7 | -0.1 | +1.9 | 0 | — | — |
| 褻瀆 OCR 開(`ocr-reveal`) | -0.2 | -0.7 | +1.2 | -0.8 | — | — |
| 符文 OCR 開(`ocr-rune`) | -4.4 | -0.7 | +0.2 | -0.5 | — | — |
| 背景圖開(`bg-on`) | -4.2 | +0.3 | +0.9 | +0.6 | — | — |
| 設定視窗開(`settings`) | -0.3 | +0.1 | +4.7 | +0.2 | — | — |

## 行程明細(本程式,依 CPU 排序)

- **無程式基準**:powershell.exe#32908 1.5% / 185.5 MB、ExileAppraiser.exe#51000 1.1% / 296.5 MB、ExileAppraiser.exe#28748 0% / 497.6 MB、ExileAppraiser.exe#63472 0% / 114.7 MB、ExileAppraiser.exe#35728 0% / 53 MB、conhost.exe#46432 0% / 8.1 MB(⚠ 基準情境仍找到本程式行程)
- **遊戲沒開**:ExileAppraiser.exe#51000 0.8% / 199.3 MB、ExileAppraiser.exe#28748 0% / 495.5 MB、powershell.exe#32908 0% / 176.8 MB、ExileAppraiser.exe#63472 0% / 114.7 MB、ExileAppraiser.exe#35728 0% / 53 MB、conhost.exe#46432 0% / 8.2 MB
- **遊戲開、不在前景**:ExileAppraiser.exe#51000 0.7% / 201.4 MB、powershell.exe#32908 0% / 176.7 MB、ExileAppraiser.exe#28748 0% / 149.1 MB、ExileAppraiser.exe#63472 0% / 115 MB、ExileAppraiser.exe#35728 0% / 53.3 MB、conhost.exe#46432 0% / 8.2 MB
- **前景無面板**:ExileAppraiser.exe#51000 0.7% / 192.3 MB、ExileAppraiser.exe#28748 0% / 406.2 MB、powershell.exe#32908 0% / 184.3 MB、ExileAppraiser.exe#63472 0% / 112.1 MB、ExileAppraiser.exe#35728 0% / 51.7 MB、conhost.exe#46432 0% / 8.2 MB
- **查價面板開**:ExileAppraiser.exe#51000 0.8% / 196.2 MB、ExileAppraiser.exe#28748 0% / 602.2 MB、powershell.exe#32908 0% / 184.3 MB、ExileAppraiser.exe#63472 0% / 119.6 MB、ExileAppraiser.exe#35728 0% / 52.2 MB、conhost.exe#46432 0% / 8.2 MB
- **褻瀆 OCR 開**:ExileAppraiser.exe#51000 1.1% / 227.5 MB、powershell.exe#32908 1% / 190.8 MB、ExileAppraiser.exe#28748 0% / 495.2 MB、ExileAppraiser.exe#63472 0% / 113.7 MB、ExileAppraiser.exe#35728 0% / 52.1 MB、conhost.exe#46432 0% / 8.2 MB
- **符文 OCR 開**:ExileAppraiser.exe#51000 0.2% / 248.3 MB、ExileAppraiser.exe#28748 0% / 407.2 MB、powershell.exe#32908 0% / 174.6 MB、ExileAppraiser.exe#63472 0% / 115.8 MB、ExileAppraiser.exe#35728 0% / 51.8 MB、conhost.exe#46432 0% / 8.2 MB
- **背景圖開**:ExileAppraiser.exe#51000 0.8% / 199.9 MB、ExileAppraiser.exe#28748 0% / 455.4 MB、powershell.exe#32908 0% / 175.6 MB、ExileAppraiser.exe#63472 0% / 116.2 MB、ExileAppraiser.exe#35728 0% / 51.9 MB、conhost.exe#46432 0% / 8.2 MB
- **設定視窗開**:ExileAppraiser.exe#51000 0.7% / 196.3 MB、ExileAppraiser.exe#28748 0% / 455.2 MB、powershell.exe#32908 0% / 175.5 MB、ExileAppraiser.exe#63472 0% / 120.3 MB、ExileAppraiser.exe#35728 0% / 51.9 MB、conhost.exe#46432 0% / 8.2 MB

指標定義與情境說明見 `docs/perf/README.md`。
