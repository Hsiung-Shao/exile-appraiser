# 從命令列送 Poe Regex 分享碼(`--regex-share`)

2026-10-07 起，外部程式(目前是 PobTools)可以用命令列參數把 Poe Regex 分享碼交給 ExileAppraiser。
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
- **兩個參數不能同時給**，同時給會回報錯誤。

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

- `main/test/regex-share.test.ts`:參數解析(兩種寫法、Chromium 重排、缺值、兩個都給)、格式檢查、讀檔(假 fs)、重新啟動不帶參數、信箱依目標交出、啟動等待(假時鐘)、上限一致、接線守門。
- `renderer/test/regex-incoming.test.ts`:確認流程(錯誤 / 解碼失敗 / 確認才套用 / 取消不改 / 新請求取代舊請求)、字串兩語、接線。
- `regex/test/share.test.ts`:解碼上限(超長、壓縮炸彈)。
