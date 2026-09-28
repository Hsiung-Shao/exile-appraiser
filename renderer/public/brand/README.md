# ExileAppraiser 圖示來源

## 設計
- `icon.svg`(256 viewBox):深色漸層圓角方底(`#1a2029 → #0e1116`,描邊 `#2a3442`)+ 金色天平(`#f0c96a → #c8963a`,代表「鑑價」),
  樑頂一顆菱形呼應 PobTools 品牌菱形。配色取自 PobTools slate 主題。自繪,無第三方素材。
  - 金色漸層必須 `gradientUnits="userSpaceOnUse"`:支柱/橫樑/底座是純垂直或水平的 `<line>`,外框寬或高為 0,
    用預設的 objectBoundingBox 漸層會讓整條線不畫(SVG 規範,librsvg 與瀏覽器都一樣)。
- `tray.svg`:托盤專用單色版。去掉底板、天平與菱形全用 `#f0c96a`、線寬 14 → 20,viewBox 收緊到天平本體(`14 14 228 228`)讓 16px 用滿。
- 點陣化時(`scripts/build-icons.mjs`)另加一圈深色描邊 `#1a202c`(以 alpha 膨脹實作):
  `icon.ico` 的 16px 層 0.5px;托盤 16px 0.5px、32px 1px(同一個邏輯寬度)。淺色工作列/托盤上才看得出輪廓。
- 16/24/32px 先以 4× 超取樣渲染再 lanczos3 縮小。

## 重產
```bash
npm run build-icons     # 需 root devDependency sharp
```
冪等:同一版 sharp 下重跑輸出逐位元組相同。改了 SVG 就重跑並把產物一起 commit。

## 產物(`renderer/public/`)
| 檔案 | 尺寸 | 用途 |
|---|---|---|
| `icon.png` | 512×512 | Electron 視窗圖示(`main/src/main.ts` 的 `iconPath()`) |
| `icon.ico` | 16/24/32/48/64/128/256,每層 PNG 壓縮 | 安裝檔/exe(`main/electron-builder.yml` 的 `win.icon`)、`index.html` favicon |
| `tray-16.png` | 16×16 透明底 | 系統托盤(顯示縮放 < 150%) |
| `tray-32.png` | 32×32 透明底 | 系統托盤(顯示縮放 ≥ 150%) |

Vite 會把 `public/` 整個複製到 `renderer/dist/`,electron-builder 再把 `renderer/dist` 放到 app 根目錄,所以 prod 從 `__dirname` 讀得到。
