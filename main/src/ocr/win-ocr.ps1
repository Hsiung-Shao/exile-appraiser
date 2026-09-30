# exile-appraiser(WP-S):常駐 Windows OCR 服務(PowerShell 5.1 + WinRT Windows.Media.Ocr)。
#
# 由 main/src/ocr/WinOcr.ts 以 `powershell.exe -NoProfile -NonInteractive -EncodedCommand <本檔>` 啟動
# (esbuild text loader 內嵌進 main.js);scripts/ocr-fixture.mjs 讀同一個檔 → fixture 快照與 runtime 同一支腳本。
# 不用 `-Command -`:那會把 stdin 當腳本,資料就沒地方送。
#
# 協定(每行一個 JSON,UTF-8;輸出一律 ASCII,非 ASCII 以 \uXXXX 跳脫,避開主控台碼頁):
#   啟動:stdout `{"ready":true,"lang":"zh-Hant-TW","langs":[...],"maxDim":N}`;
#         缺語言包 `{"error":"lang-missing","lang":"zh-Hant-TW","langs":[...]}` 後結束(exit 3)。
#   請求:stdin  `{"id":"1","image":"<base64>"}` 或 `{"id":"1","path":"C:\\...\\x.png"}`
#         (影像是 BitmapDecoder 認得的格式:runtime 送 JPEG q95 —— nativeImage.toPNG 對放大後的整張畫面要 1.5 秒,JPEG 不到 0.1 秒)
#   回應:stdout `{"id":"1","ms":123,"w":W,"h":H,"lines":[{"text":"...","x":..,"y":..,"w":..,"h":..,"words":[{"text","x","y","w","h"}]}]}`
#         失敗 `{"id":"1","error":"..."}`
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

function Await-Op($op, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  $null = $task.Wait(-1)
  return $task.Result
}

function Esc([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($c -eq 34) { $null = $sb.Append('\"') }
    elseif ($c -eq 92) { $null = $sb.Append('\\') }
    elseif ($c -lt 32 -or $c -gt 126) { $null = $sb.Append(('\u{0:x4}' -f $c)) }
    else { $null = $sb.Append($ch) }
  }
  return $sb.ToString()
}

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

while ($true) {
  $req = [Console]::In.ReadLine()
  if ($null -eq $req) { break }
  if ($req.Trim().Length -eq 0) { continue }
  $id = ''
  try {
    $m = $reId.Match($req)
    if ($m.Success) { $id = $m.Groups[1].Value }
    $t0 = [Diagnostics.Stopwatch]::StartNew()
    $mp = $rePng.Match($req)
    if ($mp.Success) {
      $bytes = [Convert]::FromBase64String($mp.Groups[1].Value)
    } else {
      $mpath = $rePath.Match($req)
      if (-not $mpath.Success) { throw 'request has neither image nor path' }
      $p = [regex]::Unescape($mpath.Groups[1].Value)
      $bytes = [System.IO.File]::ReadAllBytes($p)
    }
    $ms = New-Object System.IO.MemoryStream(, $bytes)
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $decoder = Await-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-Op ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $linesOut = New-Object System.Collections.Generic.List[string]
    foreach ($line in $result.Lines) {
      $x0 = [double]::MaxValue; $y0 = [double]::MaxValue; $x1 = 0.0; $y1 = 0.0
      $wordsOut = New-Object System.Collections.Generic.List[string]
      foreach ($w in $line.Words) {
        $r = $w.BoundingRect
        if ($r.X -lt $x0) { $x0 = $r.X }
        if ($r.Y -lt $y0) { $y0 = $r.Y }
        if ($r.X + $r.Width -gt $x1) { $x1 = $r.X + $r.Width }
        if ($r.Y + $r.Height -gt $y1) { $y1 = $r.Y + $r.Height }
        $wordsOut.Add('{"text":"' + (Esc $w.Text) + '","x":' + (Num $r.X) + ',"y":' + (Num $r.Y) + ',"w":' + (Num $r.Width) + ',"h":' + (Num $r.Height) + '}')
      }
      if ($wordsOut.Count -eq 0) { continue }
      $linesOut.Add('{"text":"' + (Esc $line.Text) + '","x":' + (Num $x0) + ',"y":' + (Num $y0) + ',"w":' + (Num ($x1 - $x0)) + ',"h":' + (Num ($y1 - $y0)) + ',"words":[' + ($wordsOut -join ',') + ']}')
    }
    $elapsed = $t0.ElapsedMilliseconds
    Emit ('{"id":"' + (Esc $id) + '","ms":' + $elapsed + ',"w":' + $bitmap.PixelWidth + ',"h":' + $bitmap.PixelHeight + ',"lines":[' + ($linesOut -join ',') + ']}')
    $bitmap.Dispose()
    $ms.Dispose()
  } catch {
    Emit ('{"id":"' + (Esc $id) + '","error":"' + (Esc ($_.Exception.Message)) + '"}')
  }
}
