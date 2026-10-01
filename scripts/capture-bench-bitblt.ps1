# exile-appraiser 效能修正第 17 步量測輔助(main/src/ocr/capture-bench.ts 的 --bench-blt=<這支>):
# 與 electron-overlay-window src/lib/windows.c ow_screenshot 相同的 GDI 呼叫序列(GetDC(GetDesktopWindow) → 32bpp top-down DIBSection → BitBlt SRCCOPY → 複製),
# 在 per-monitor DPI aware 的執行緒擷取螢幕實體像素矩形。原生 screenshot() 只能擷取「目前 attach 的前景視窗」,attach 的視窗不在要比對的位置時用這支代替。
# -Out <檔案> 寫出 BGRA(呼叫端讀完即刪;只用於 fixture 顯示區),-Out none 只量耗時;stdout 一行 JSON(每次耗時、alpha 抽樣)。
param([int]$X, [int]$Y, [int]$W, [int]$H, [string]$Out = 'none', [int]$N = 1)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public static class Blt {
  [StructLayout(LayoutKind.Sequential)] public struct BIH { public int biSize; public int biWidth; public int biHeight; public short biPlanes; public short biBitCount; public int biCompression; public int biSizeImage; public int x1; public int x2; public int c1; public int c2; }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BIH bi, uint usage, out IntPtr bits, IntPtr sec, uint off);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint rop);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  public static void Aware() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
  public static byte[] Shot(int x, int y, int w, int h, out double ms) {
    var sw = Stopwatch.StartNew();
    var bi = new BIH(); bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32; bi.biCompression = 0; bi.biSizeImage = w * h * 4;
    IntPtr src = GetDC(GetDesktopWindow()); IntPtr dst = CreateCompatibleDC(src); IntPtr bits;
    IntPtr bmp = CreateDIBSection(src, ref bi, 0, out bits, IntPtr.Zero, 0);
    SelectObject(dst, bmp);
    BitBlt(dst, 0, 0, w, h, src, x, y, 0x00CC0020);
    byte[] buf = new byte[w * h * 4]; Marshal.Copy(bits, buf, 0, buf.Length);
    DeleteDC(dst); ReleaseDC(IntPtr.Zero, src); DeleteObject(bmp);
    ms = sw.Elapsed.TotalMilliseconds;
    return buf;
  }
}
'@
[Blt]::Aware()
$times = @(); $buf = $null
for ($i = 0; $i -lt $N; $i++) { $ms = 0.0; $buf = [Blt]::Shot($X, $Y, $W, $H, [ref]$ms); $times += [math]::Round($ms, 2) }
$a0 = 0; $a255 = 0; $n = $buf.Length / 4
for ($i = 3; $i -lt $buf.Length; $i += 4 * 97) { if ($buf[$i] -eq 0) { $a0++ } elseif ($buf[$i] -eq 255) { $a255++ } }
if ($Out -ne 'none') { [IO.File]::WriteAllBytes($Out, $buf) }
'{"ms":[' + ($times -join ',') + '],"alphaSample0":' + $a0 + ',"alphaSample255":' + $a255 + '}'
