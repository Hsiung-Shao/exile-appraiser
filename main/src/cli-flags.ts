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

/** 第 34 步:更新提醒的開發版驗證參數(搭 `--force-update-check` + `scripts/make-fake-update-feed.mjs`)。 */
export interface ReminderDevOptions {
  /** `--reminder-interval-ms=<n>`:提醒間隔(1000–600000;預設 10 分鐘)。 */
  intervalMs?: number
  /** `--reminder-auto=later,skip`:每次提醒出現約 2 秒後依序代按(頁面內 DOM click,不是 OS 輸入);只准 later / skip(絕不代按「立即更新」)。 */
  auto: Array<'later' | 'skip'>
  /** `--toast-display=secondary`:提示 / 提醒畫在副螢幕(沒有副螢幕 → 主螢幕),驗證時不擋主螢幕。 */
  secondaryDisplay: boolean
}

/** 只在**非 packaged** 時接受(正式版一律 null,不讓捷徑 / 使用者誤觸)。 */
export function reminderDevOptions (argv: readonly string[], isPackaged: boolean): ReminderDevOptions | null {
  if (isPackaged) return null
  const val = (prefix: string) => argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
  const n = Number(val('--reminder-interval-ms='))
  const intervalMs = Number.isFinite(n) && n >= 1000 && n <= 600_000 ? Math.round(n) : undefined
  const auto = (val('--reminder-auto=') ?? '').split(',').map(s => s.trim())
    .filter((s): s is 'later' | 'skip' => s === 'later' || s === 'skip')
  const secondaryDisplay = argv.includes('--toast-display=secondary')
  if (intervalMs == null && auto.length === 0 && !secondaryDisplay) return null
  return { intervalMs, auto, secondaryDisplay }
}
