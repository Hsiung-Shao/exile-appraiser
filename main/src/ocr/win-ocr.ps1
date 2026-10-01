# exile-appraiser(WP-S):常駐 Windows OCR 服務(PowerShell 5.1 + WinRT Windows.Media.Ocr)。
#
# 由 main/src/ocr/WinOcr.ts 以 `powershell.exe -NoProfile -NonInteractive -EncodedCommand <本檔>` 啟動
# (esbuild text loader 內嵌進 main.js);scripts/ocr-fixture.mjs 讀同一個檔 → fixture 快照與 runtime 同一支腳本。
# 不用 `-Command -`:那會把 stdin 當腳本,資料就沒地方送。
#
# 協定(每行一個 JSON,UTF-8;輸出一律 ASCII,非 ASCII 以 \uXXXX 跳脫,避開主控台碼頁):
#   啟動:stdout `{"ready":true,"lang":"zh-Hant-TW","langs":[...],"maxDim":N}`;
#         缺語言包 `{"error":"lang-missing","lang":"zh-Hant-TW","langs":[...]}` 後結束(exit 3)。
#   請求:stdin  `{"id":"1","path":"C:\\...\\x.img"}`(WinOcr.ts 的做法:影像先寫進暫存檔)或 `{"id":"1","image":"<base64>"}`(暫存檔寫不進去時的退路)
#         (影像是 BitmapDecoder 認得的格式:runtime 送 JPEG q95 —— nativeImage.toPNG 對放大後的整張畫面要 1.5 秒,JPEG 不到 0.1 秒)
#         可加 `"words":false` → 回應的行不帶 `words`(runtime 掃描只用行;fixture 快照不加,照舊帶 words)
#   回應:stdout `{"id":"1","ms":123,"w":W,"h":H,"lines":[{"text":"...","x":..,"y":..,"w":..,"h":..,"words":[{"text","x","y","w","h"}]}]}`
#         失敗 `{"id":"1","error":"..."}`
#   `ms` 從讀到請求那行開始量(含讀檔 / base64 解碼、解碼影像、OCR、組字串)。
# 輸入 JSON 不用 ConvertFrom-Json:PS 5.1 的 JavaScriptSerializer 預設上限 2 MB,放大後的整張截圖 base64 會超過。
# 座標是送進來那張圖的像素(呼叫端自己換算回 client 比例座標)。
# WinRT 會在 CJK 字與字之間插空白(`+86 護 甲 值`),由比對端(poe2/src/desecration/ocr-match.ts)統一去掉。
# 語言:環境變數 EXILE_OCR_LANG(預設 zh-Hant-TW)。

$ErrorActionPreference = 'Stop'
# 不設的話 stdout 被導向時 PowerShell 會在 stderr 印 `#< CLIXML` 進度記錄
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

# 三個用得到的 AsTask<T> 先建好(原本每次 Await-Op 都反射 MakeGenericMethod)
$asTaskDecoder = $asTaskGeneric.MakeGenericMethod([Windows.Graphics.Imaging.BitmapDecoder])
$asTaskBitmap = $asTaskGeneric.MakeGenericMethod([Windows.Graphics.Imaging.SoftwareBitmap])
$asTaskOcr = $asTaskGeneric.MakeGenericMethod([Windows.Media.Ocr.OcrResult])

function Await-Op($op, [Reflection.MethodInfo]$asTask) {
  $task = $asTask.Invoke($null, @($op))
  $null = $task.Wait(-1)
  return $task.Result
}

# JSON 字串跳脫:`"` → `\"`、`\` → `\\`、控制字元與非 ASCII → `\uXXXX`(小寫十六進位,UTF-16 code unit);其餘原樣。
# 與原本逐字元 StringBuilder 版逐位元組相同(0–0xFFFF 全部字元比對過),只是交給 .NET Regex 掃描,只有要跳脫的字元才進 PowerShell
$reEsc = New-Object System.Text.RegularExpressions.Regex('[^\x20\x21\x23-\x5b\x5d-\x7e]')
$escEval = [System.Text.RegularExpressions.MatchEvaluator] {
  param($m)
  $c = [int]$m.Value[0]
  if ($c -eq 34) { return '\"' }
  if ($c -eq 92) { return '\\' }
  return ('\u{0:x4}' -f $c)
}
function Esc([string]$s) { return $reEsc.Replace($s, $escEval) }

function Num([double]$v) { return $v.ToString('0.##', [System.Globalization.CultureInfo]::InvariantCulture) }

function Emit([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

$langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
$langsJson = ($langs | ForEach-Object { '"' + (Esc $_) + '"' }) -join ','
$wanted = $env:EXILE_OCR_LANG
if (-not $wanted) { $wanted = 'zh-Hant-TW' }
$lang = New-Object Windows.Globalization.Language($wanted)
$engine = $null
if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}
if ($null -eq $engine) {
  Emit ('{"error":"lang-missing","lang":"' + (Esc $wanted) + '","langs":[' + $langsJson + ']}')
  exit 3
}
Emit ('{"ready":true,"lang":"' + (Esc $wanted) + '","langs":[' + $langsJson + '],"maxDim":' + [Windows.Media.Ocr.OcrEngine]::MaxImageDimension + '}')

$reId = [regex]'"id"\s*:\s*"([^"]*)"'
$rePng = [regex]'"image"\s*:\s*"([A-Za-z0-9+/=]*)"'
$rePath = [regex]'"path"\s*:\s*"((?:[^"\\]|\\.)*)"'
$reNoWords = [regex]'"words"\s*:\s*false'

while ($true) {
  $req = [Console]::In.ReadLine()
  if ($null -eq $req) { break }
  if ($req.Trim().Length -eq 0) { continue }
  $id = ''
  try {
    $m = $reId.Match($req)
    if ($m.Success) { $id = $m.Groups[1].Value }
    $t0 = [Diagnostics.Stopwatch]::StartNew()
    # path 先看(runtime 的做法;請求行很短),沒有才找 base64
    $mpath = $rePath.Match($req)
    if ($mpath.Success) {
      $p = [regex]::Unescape($mpath.Groups[1].Value)
      $bytes = [System.IO.File]::ReadAllBytes($p)
    } else {
      $mp = $rePng.Match($req)
      if (-not $mp.Success) { throw 'request has neither image nor path' }
      $bytes = [Convert]::FromBase64String($mp.Groups[1].Value)
    }
    $withWords = -not $reNoWords.IsMatch($req)
    $ms = New-Object System.IO.MemoryStream(, $bytes)
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $decoder = Await-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) $asTaskDecoder
    $bitmap = Await-Op ($decoder.GetSoftwareBitmapAsync()) $asTaskBitmap
    $result = Await-Op ($engine.RecognizeAsync($bitmap)) $asTaskOcr
    $linesOut = New-Object System.Collections.Generic.List[string]
    foreach ($line in $result.Lines) {
      $x0 = [double]::MaxValue; $y0 = [double]::MaxValue; $x1 = 0.0; $y1 = 0.0
      $nWords = 0
      $wordsOut = New-Object System.Collections.Generic.List[string]
      foreach ($w in $line.Words) {
        $r = $w.BoundingRect
        if ($r.X -lt $x0) { $x0 = $r.X }
        if ($r.Y -lt $y0) { $y0 = $r.Y }
        if ($r.X + $r.Width -gt $x1) { $x1 = $r.X + $r.Width }
        if ($r.Y + $r.Height -gt $y1) { $y1 = $r.Y + $r.Height }
        $nWords++
        if ($withWords) {
          $wordsOut.Add('{"text":"' + (Esc $w.Text) + '","x":' + (Num $r.X) + ',"y":' + (Num $r.Y) + ',"w":' + (Num $r.Width) + ',"h":' + (Num $r.Height) + '}')
        }
      }
      if ($nWords -eq 0) { continue }
      $head = '{"text":"' + (Esc $line.Text) + '","x":' + (Num $x0) + ',"y":' + (Num $y0) + ',"w":' + (Num ($x1 - $x0)) + ',"h":' + (Num ($y1 - $y0))
      if ($withWords) { $linesOut.Add($head + ',"words":[' + ($wordsOut -join ',') + ']}') } else { $linesOut.Add($head + '}') }
    }
    $elapsed = $t0.ElapsedMilliseconds
    Emit ('{"id":"' + (Esc $id) + '","ms":' + $elapsed + ',"w":' + $bitmap.PixelWidth + ',"h":' + $bitmap.PixelHeight + ',"lines":[' + ($linesOut -join ',') + ']}')
    $bitmap.Dispose()
    $ms.Dispose()
  } catch {
    Emit ('{"id":"' + (Esc $id) + '","error":"' + (Esc ($_.Exception.Message)) + '"}')
  }
}
