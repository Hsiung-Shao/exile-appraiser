/**
 * exile-appraiser(code review 第 B 批):只給開發版用的命令列開關(純函式,main vitest 可測)。
 *
 * `--capture-bench`(效能修正第 17 步的擷取量測,`ocr/capture-bench.ts`)只在**非 packaged**(`npx electron main/dist/main.js …`)時接受;
 * 正式版收到這個參數一律忽略並正常啟動(不讓使用者 / 捷徑誤觸進入量測模式)。量測程式碼在 `main.ts` 以動態 `import()` 載入,
 * 不在啟動路徑上執行。
 */
export function captureBenchMode (argv: readonly string[], isPackaged: boolean): 'run' | 'ignored' | 'off' {
  if (!argv.includes('--capture-bench')) return 'off'
  return isPackaged ? 'ignored' : 'run'
}
