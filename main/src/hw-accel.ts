/**
 * 第五輪 30.5:硬體加速設定(`config.json` 的 `hardwareAcceleration`,預設 false = 改版前一律 `app.disableHardwareAcceleration()`)。
 *
 * `disableHardwareAcceleration()` 只能在 app ready 之前呼叫,所以 main 在模組頂層**同步**讀設定檔(與 `resolveWindowMode` 同一個檔),
 * 改了要重新啟動才生效(設定 › 一般「重新啟動」鈕 = IPC `app-relaunch`,先把 renderer 目前的設定寫檔再 `relaunchSelf`)。
 * 純函式,不 import electron(測試 `main/test/hw-accel.test.ts`)。
 */

/** 設定檔內容 → 是否開硬體加速。讀不到 / 壞檔 / 沒有這個鍵 / 不是 true → false(= 改版前行為) */
export function hardwareAccelerationFromConfig (raw: string | null | undefined): boolean {
  if (raw == null) return false
  try {
    const obj = JSON.parse(raw) as unknown
    return obj != null && typeof obj === 'object' && (obj as { hardwareAcceleration?: unknown }).hardwareAcceleration === true
  } catch {
    return false
  }
}

/**
 * 這次啟動要不要關硬體加速。selftest / 量測 / 控制參數 / 第二實例(`skipStartup`)維持改版前的「一律關」,
 * 只有正常啟動才看設定。
 */
export function shouldDisableHardwareAcceleration (opts: { skipStartup: boolean, setting: boolean }): boolean {
  return opts.skipStartup || !opts.setting
}

/** `app-relaunch` 收到的設定內容:必須是 JSON 物件字串才寫檔(不讓壞內容蓋掉設定檔) */
export function isConfigContents (v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0) return false
  try {
    const o = JSON.parse(v) as unknown
    return o != null && typeof o === 'object' && !Array.isArray(o)
  } catch {
    return false
  }
}
