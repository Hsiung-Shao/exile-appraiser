# 從命令列送 Poe Regex 分享碼(`--regex-share`)

2026-10-07 起，外部程式(目前是 PobTools)可以用命令列參數把 Poe Regex 分享碼(覆蓋目前的勾選)或書籤包(加進書籤，見「書籤包」)交給 ExileAppraiser。
使用者在 ExileAppraiser 的確認對話框按「套用」才會生效。

本文件是**給呼叫端(PobTools)實作用的介面規格**。實作在 `main/src/regex-share.ts`(參數、檢查、信箱、顯示目標)
與 `renderer/src/web/regex/incoming-share.ts`(確認流程)。

## 參數

| 參數 | 內容 | 用途 |
|---|---|---|
| `--regex-share=<分享碼>` | 分享碼本身 | 一般情況(建議用 `=` 形式) |
| `--regex-share-file=<檔案路徑>` | UTF-8 文字檔，內容是分享碼 | 碼太長、命令列放不下時 |

- **分享碼格式**：與設定 › 正則「複製分享碼 / 貼上分享碼」相同。也就是 JSON 經 gzip 壓縮後的 base64url,不帶 `=` 補位。
- **兩種寫法都可以**：`--regex-share=值` 與 `--regex-share 值`(空白分隔)。建議用 `=` 形式，原因見「單一實例」一節的 Chromium 重排。
- **長度**：
  - 分享碼最多 4 194 304 字元(4 MiB),與 PobTools `kMaxCodeChars` 相同。
  - 解壓後的 JSON 最多 8 MiB。
  - Windows 命令列上限約 32 767 字元。分享碼超過約 30 000 字元時，請改用 `--regex-share-file`。
- **字元集**：只接受 `A–Z a–z 0–9 - _`。前後空白、換行、UTF-8 BOM 會先去掉。
- **檔案參數**：
  - 檔案大小上限 = 4 MiB + 4096 位元組。
  - 相對路徑以**呼叫端行程的工作目錄**為準；建議傳絕對路徑。
  - ExileAppraiser **只讀不刪**，暫存檔由呼叫端自己清。
- **只能給一個參數**：分享碼與書籤包的四個參數同時給兩個以上，會回報錯誤。

## 單一實例

ExileAppraiser 只允許一個實例在執行。

- **沒有在執行**：這次啟動就是主程式。正常啟動完成後顯示確認對話框。
- **已在執行**：新啟動的行程把參數轉交給主程式後立刻結束(不會開第二個視窗)，由主程式顯示確認對話框。
  - Chromium 轉交參數時，會把開關移到一般參數前面，開關名也會變小寫。`--regex-share 值` 的值因此不一定緊接在開關後面；程式有處理這種情況，但 `=` 形式最穩。
- **結束碼不代表是否套用成功**。交給主程式是非同步的，套用與否由使用者在對話框決定。呼叫端只要能把行程啟動起來就算送出成功。

## 會在哪裡顯示

| ExileAppraiser 狀態 | 確認對話框出現在 |
|---|---|
| 視窗模式(設定沒開 overlay) | ExileAppraiser 視窗(叫到前景)→ 設定 › 正則 |
| overlay 模式，遊戲視窗在 | 遊戲上的 overlay(取得焦點)→ 設定 › 正則 |
| overlay 模式，遊戲沒開 | 用**預設瀏覽器**開設定 › 正則(與系統匣「在瀏覽器開啟設定」同一個本機頁面) |

剛啟動時還不知道遊戲在不在，程式會先等以下其中一件事發生，再決定顯示在哪裡：遊戲視窗綁定成功、開始追蹤遊戲後 2.5 秒仍沒找到，或最多 15 秒。

## 確認對話框

- **顯示內容**：
  - 來源「PobTools」與遊戲(PoE1 / PoE2)。
  - 目前有勾選、套用後會被覆蓋的清單。
  - 分享碼帶進來的清單與勾選數。
  - 自訂文字 / 排除詞數量與模式。
  - 找不到的項目數，以及不存在的清單名稱。
- **「套用」**：與「貼上分享碼」完全相同，會覆蓋該遊戲全部清單的勾選、數值、自訂文字、排除詞與模式。
- **「取消」**：什麼都不改。
- **連續送兩次**：新的會取代還沒按的舊對話框。
- **⚠ 物品詞綴數值頁的鍵不互通**：PobTools 那頁用 GGPK stat id 當鍵，ExileAppraiser 用交易站 stat id，所以這一頁的項目會全部算成「找不到」。其他頁的鍵(英文詞綴行 / 項目 id)兩邊相同。

## 錯誤處理

參數不合格時，ExileAppraiser：

- 在記錄(設定 › 記錄)寫一行 `[regex-share] … 不合格`。記錄只寫分享碼的長度，不寫內容。
- 在設定 › 正則顯示錯誤對話框。
- **不做任何其他事**：不改設定、不寫檔、不刪檔、不執行任何東西。

| 錯誤原因 | 情況 |
|---|---|
| `missing-value` | 有開關但沒有值 |
| `both-flags` | 兩個參數都給了 |
| `empty` | 分享碼是空的 |
| `too-long` | 超過 4 MiB 字元 |
| `charset` | 含 base64url 以外的字元(對話框會顯示是哪個字元) |
| `file-read` | 檔案不存在、讀不到，或路徑不是檔案 |
| `file-too-large` | 檔案超過上限 |
| `decode` | 字元集對、但解不開(不是 gzip、JSON 壞了、版本不符、遊戲不明、解壓後超過 8 MiB) |
| `not-loaded` | 該遊戲的正則清單載入失敗 |

## 書籤包(`--regex-bookmarks`,2026-10-07 第 40 步)

把 PobTools 使用者**自選**的正則書籤(單筆、整個資料夾，兩個遊戲可混選)送進來,**加進書籤，不動目前的勾選**。
實作在 `regex/src/bookmarks-share.ts`,匯出 `encodeBookmarks` / `decodeBookmarks` / `normalizeBookmarkPack` / `mergeBookmarks` / `canonicalBookmarkPackJson` / `bookmarkMissed`。

| 參數 | 內容 |
|---|---|
| `--regex-bookmarks=<書籤包碼>` | 書籤包碼本身 |
| `--regex-bookmarks-file=<檔案路徑>` | UTF-8 文字檔，內容是書籤包碼 |

- 字元集、長度上限、檔案上限、錯誤原因、單一實例轉交、顯示位置，**全部與 `--regex-share` 相同**。
- 四個參數(`--regex-share`、`--regex-share-file`、`--regex-bookmarks`、`--regex-bookmarks-file`)只能給一個，給兩個以上 = `both-flags`。

### 格式

編碼與分享碼相同：JSON → gzip → base64url(不帶 `=` 補位)。解壓後的 JSON 是：

```
{ "kind": "regex-bookmarks", "v": 1,
  "folders": { "poe1": [{ "name": 字串, "collapsed": 布林 }], "poe2": [ ... ] },
  "bookmarks": [ { "name", "page", "game", "mode", "lang", "keys", "alt", "numeric"?, "num"?, "folder"? } ] }
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `kind` | `"regex-bookmarks"` | 固定，不符 = 錯誤 |
| `v` | `1` | 版本，不符 = 錯誤 |
| `folders.poe1` / `folders.poe2` | 陣列 | 資料夾(依順序)。名稱會正規化：去前後空白、連續空白變一個、最多 40 字。`collapsed` 只用在**新建**的資料夾 |
| `bookmarks[].name` | 字串，必填 | 書籤名稱 |
| `bookmarks[].page` | 字串，必填 | 頁 id(例 `map_mods`、`waystone_mods`、`vendor_bases`、`item_mod_values`) |
| `bookmarks[].game` | `"poe1"` / `"poe2"`,必填 | |
| `bookmarks[].mode` | `"any"` / `"all"` / `"none"` | 認不得 → `any` |
| `bookmarks[].lang` | `"zh"` / `"en"` | 輸出語言；認不得 → `zh` |
| `bookmarks[].keys` | 字串陣列 | 勾選的詞綴鍵：語料頁 = 英文第一行；演算法頁 = 項目 id |
| `bookmarks[].alt` | 字串陣列 | 與 `keys` 同順序的中文行(後援) |
| `bookmarks[].numeric` | 物件，選填 | 數值：項目 id → `{ min?, max?, choice? }`。宿主詞綴頁 = 數值區 / 條件區的值 |
| `bookmarks[].num` | 字串陣列，選填 | 宿主詞綴頁的數值區 / 條件區勾選的項目 id |
| `bookmarks[].folder` | 字串，選填 | 資料夾名稱；沒有 / 空 = 未分類。沒列在 `folders` 的會自動補上 |

- 書籤欄位與 ExileAppraiser `regex_state.json` schema 5 的書籤相同(驗證共用 `parseBookmark`)。
- **`hotkey` 不帶**：寫了也會被丟掉，避免熱鍵衝突。
- `keys` 與 `num` 都空的書籤會被略過。
- 壞掉的書籤 / 資料夾略過並記警告，不會讓整包失敗；`kind` / `v` 不符、不是物件、解不開才會整包失敗(`decode`)。
- 稀有度 | 汙染條件列(`item_rarity_class`)的 `choice` 是字母編碼：稀有度 `n` 普通、`m` 魔法、`r` 稀有、`u` 傳奇(依此順序)，加上選填的 `|u` 未汙染 / `|c` 已汙染。例：`mr|u`、`|c`、`r`。舊的單字 `normal` / `magic` / `rare` / `unique` 也接受。

### 合併規則(`mergeBookmarks`)

- **只新增書籤 / 資料夾**:目前的勾選、數值、自訂文字、排除詞、模式都不動，既有書籤也不動。
- **資料夾**:以「遊戲 + 名稱」對應。已有的就併進去(收合狀態不變);沒有的依包內順序加在該遊戲資料夾最後。
- **同名**:同遊戲 + 同資料夾 + 同名(包含這次已加入的)→ 新的那筆改名為 `名 (2)`、`名 (3)`…。不同資料夾同名不算撞名。
- **物品詞綴數值頁**:鍵不互通(PobTools 用 GGPK stat id,這邊用交易站 stat id)。這類書籤**照樣加入**，確認對話框標示「找不到 N 項」;載入時會略過那些項目。

### 確認對話框

- 列出：來源 PobTools、依遊戲 → 資料夾分組要加入的書籤，並標示新資料夾、改名(原名 → 新名)、每筆找不到幾項。
- 按「加入」才寫入；取消不改任何狀態。
- 加入後書籤卡片切到該遊戲、展開放進去的資料夾、捲到卡片，新書籤短暫醒目。

### 對拍

- `encodeBookmarks` 壓縮的是 `canonicalBookmarkPackJson` 產生的**正規 JSON**:鍵順序同上表、沒有空白、選填欄位空的不寫、不帶 `hotkey`。
- **gzip 的位元組因實作而不同**(Node / Chromium 的 CompressionStream 與 zlib 預設參數不一定一樣),所以**碼不保證逐字相同**。請比對「解碼後的 JSON 字串」;下面的碼保證能被兩邊解開。

### 範例

#### 範例一:單筆書籤(PoE1,未分類)

正規 JSON:

```json
{"kind":"regex-bookmarks","v":1,"folders":{"poe1":[],"poe2":[]},"bookmarks":[{"name":"範例一","page":"map_mods","game":"poe1","mode":"none","lang":"zh","keys":["#% more Monster Life"],"alt":["#% 更多怪物生命"]}]}
```

`encodeBookmarks` 產生的碼(272 字元):

```
H4sIAAAAAAAACkWMP4rCQBTGrxI-sXsWWs4Z3BNIkJG8xJDMvDARUUPAwkasFrbaLWxsdpttLGz0NCa5hoy7YPf9_VXIUhtBwXHCq8FMJDPaZSUIS6ghIZY8YldCVSiEh1CTkLwaeVUTXg81qWC1YSh0v7v77XC_bEEodOIjo4upkciDk7_RE0cwEnlnxTIIubYJFDZzEDJeeyp6_cCI4-BNbLlgF4zTmBESdL74r9uvc3P6bLc_3f67-zg271eEdVg_AAeVUVjdAAAA
```

#### 範例二:整個資料夾(PoE1,含數值區與稀有度 | 汙染列)

正規 JSON:

```json
{"kind":"regex-bookmarks","v":1,"folders":{"poe1":[{"name":"刷圖","collapsed":false}],"poe2":[]},"bookmarks":[{"name":"範例二 A","page":"map_mods","game":"poe1","mode":"any","lang":"zh","keys":["#% more Monster Life","Players have #% less effect of Flasks applied to them"],"alt":["#% 更多怪物生命","#%更少施加於玩家的藥劑效果"],"numeric":{"tier":{"min":16},"item_rarity_class":{"choice":"mr|u"}},"num":["tier","item_rarity_class"],"folder":"刷圖"},{"name":"範例二 B","page":"map_mods","game":"poe1","mode":"any","lang":"en","keys":[],"alt":[],"numeric":{"quantity":{"min":80}},"num":["quantity"],"folder":"刷圖"}]}
```

`encodeBookmarks` 產生的碼(546 字元):

```
H4sIAAAAAAAACp2RwWoUQRCGX6X5l7214OYgMjc9eFLwHoalnanZbaZ7euzuDY7rgIccYhRhQVeIIXowh-SgHsRASHyazIyPIT3qboQ9eWq6qv6_qr6aI5dFigiWJvTkxiNjci1s7sCxg2jEkRmVknWI5igNjRBtz1EITYjQ7J01h0twJEYpUTpKEWVCOapjHoq3EG3HNcfa9Jq4-7J79ePl1fkrdgccpZiEoBblWJs0dJ_8Lut7cmiThp8oKnAoUUwQ4ekUHDlVwRaDIdPGEntgCufJsvsyI3A8VKIi69hU7BAbDJki5xhlGSWemYzdU8LljomyVJJS5g3zU9KIOYTyf2zb99-aTwft89PuxUn35kOzuATHYBjCXxft8rLZ_9guL7rXJ83n793B7s93x83-on271x4dBqNipsnKJPDzkmx4tSwQjW7VHNKTHlthpa_GiRKux5xMjUx6GvbZDHXde4Rhev0mUfz3TOuj1HwD6bv_SZqKNekVm393ezwThZe-Wu13--a1yVfZTZPG9S-D8MkChQIAAA
```

#### 範例三:兩個遊戲混選

正規 JSON:

```json
{"kind":"regex-bookmarks","v":1,"folders":{"poe1":[],"poe2":[{"name":"換界石","collapsed":true}]},"bookmarks":[{"name":"範例三 A","page":"map_mods","game":"poe1","mode":"none","lang":"zh","keys":["#% more Monster Life"],"alt":["#% 更多怪物生命"]},{"name":"範例三 B","page":"waystone_mods","game":"poe2","mode":"all","lang":"zh","keys":["Monsters have #% Critical Damage Bonus"],"alt":["#%怪物暴擊傷害加成"],"numeric":{"tier":{"min":15}},"num":["tier"],"folder":"換界石"}]}
```

`encodeBookmarks` 產生的碼(454 字元):

```
H4sIAAAAAAAACnWRsU4CQRCGX2XzE7u1gMRmO9FSn8BczMoNx4XbXbJ3oEguMcZC0ESN2kCBhY0WWkCijT6Nd_caZkGDRK12dv6Zf77k76EZah8ClgI6WN0zpqmkbcbg6ECUOeom8snGED20DJUhdjzuqgrETg9aKoJAfjEqbs-L8QQcNRNFshWTD5HYNqVeyrGw_bFUPJ98vJ99vPbZOjhaMnBNJVu7yvjufjAfm13lUMZ3P200gSOSOoDAYQMcTeo6X5RWmDKW2LbRcUKWbYV1gscho-RLzkfT7H6YHz0W_YfiZpxdvcFL-R9A1QXQvuzGidH0m6qyoJJR9A_UF0zMGrJDrLTCNmyYhDUZsU2pZECsanQ7XsKc8-XDaX49yI5fsqdJNrjLTy_dkG4rsmHNpZGEZN2rQg1RXkvTmeosZor3Hd1SPKmXfgKKwcRg8gEAAA
```

## 呼叫端怎麼找到 ExileAppraiser.exe

安裝檔由 electron-builder(NSIS)產生：

- `appId` = `com.hsiungshao.exile-appraiser`
- `productName` = `ExileAppraiser`
- 執行檔名 = `ExileAppraiser.exe`

NSIS 用的機碼名稱是 `appId` 的 UUID v5(electron-builder 固定的命名空間 `50e065bc-3134-11e6-9bab-38c9862bdaf3`)，
值為 **`c805721a-9270-5327-9a8c-78957523e59b`**(2026-10-07 在已安裝的電腦上實查相符)。

依序嘗試，找到存在的 `ExileAppraiser.exe` 就停：

1. **個人安裝(預設)**：
   - `HKCU\Software\c805721a-9270-5327-9a8c-78957523e59b` 的 `InstallLocation`(REG_SZ),例如 `C:\Users\<使用者>\AppData\Local\Programs\ExileAppraiser`,接上 `\ExileAppraiser.exe`。
   - 備援：`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\c805721a-9270-5327-9a8c-78957523e59b` 的 `DisplayIcon`,形如 `C:\…\ExileAppraiser.exe,0`,去掉結尾的 `,0`。
2. **全機安裝**：同樣兩個機碼，改查 `HKLM`(64 位元檢視)。預設位置 `C:\Program Files\ExileAppraiser\ExileAppraiser.exe`。
3. **預設路徑**：`%LOCALAPPDATA%\Programs\ExileAppraiser\ExileAppraiser.exe`。
4. **執行中的行程**：找映像名稱 `ExileAppraiser.exe` 的行程，取它的完整路徑。
   - 可攜版會解壓到暫存目錄執行，路徑是暫存目錄裡的那一份。對它帶參數一樣會轉交給主程式。
5. **使用者手動指定**：可攜版沒有在執行時沒有任何登錄資訊，請讓使用者在 PobTools 設定 ExileAppraiser 的路徑。

⚠ 不要用 Uninstall 機碼的 `DisplayVersion` 判斷版本。自動更新後它可能還是舊值(實查看到 0.0.91,實際已是 0.2.x)。

**本功能需要 ExileAppraiser v0.2.1 以上**。舊版不認得這兩個參數，只會叫出視窗，不會報錯。

## 範例

```bat
"C:\Users\me\AppData\Local\Programs\ExileAppraiser\ExileAppraiser.exe" --regex-share=H4sIAAAAAAAA...
"C:\Users\me\AppData\Local\Programs\ExileAppraiser\ExileAppraiser.exe" --regex-share-file=C:\Users\me\AppData\Local\Temp\pobtools-regex-share.txt
```

## 測試

- `regex/test/bookmarks-share.test.ts`:書籤包往返、正規 JSON、hotkey 剔除、損壞輸入、上限、合併(資料夾 / 改名 / 其他狀態不動)、找不到計數。
- `main/test/regex-share.test.ts`:參數解析(兩種寫法、Chromium 重排、缺值、兩個都給)、格式檢查、讀檔(假 fs)、重新啟動不帶參數、信箱依目標交出、啟動等待(假時鐘)、上限一致、接線守門。
- `renderer/test/regex-incoming.test.ts`:確認流程(錯誤 / 解碼失敗 / 確認才套用 / 取消不改 / 新請求取代舊請求)、字串兩語、接線。
- `regex/test/share.test.ts`:解碼上限(超長、壓縮炸彈)。
