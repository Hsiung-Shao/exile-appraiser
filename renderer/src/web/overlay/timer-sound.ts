/**
 * 2026-11-28 計時器音效(一般計時器提醒 / 倒數歸零 / 設定頁試聽)。
 * file '' = 內建:WebAudio 合成三聲嗶(不帶音檔);否則播使用者匯入的檔(Electron `app://sound/`、預覽 `<prefix>sound/`,網址規則同背景圖)。
 * 純瀏覽器(沒有 host)沒有匯入檔 → 退回內建。播放失敗只記 log。
 */
import { Host } from '../background/IPC'
import { normSoundFile } from './timer-display'

let ctx: AudioContext | null = null

function beep (volume: number): void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx ??= new AC()
  void ctx.resume?.()
  const t0 = ctx.currentTime
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    const at = t0 + i * 0.25
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + 0.2)
  }
}

export function soundUrl (file: string): string | null {
  const name = normSoundFile(file)
  if (!name || !Host.isElectron) return null
  const enc = encodeURIComponent(name)
  if (!Host.isPreview) return `app://sound/${enc}`
  try { return new URL(`sound/${enc}`, document.baseURI).href } catch { return null }
}

export function playTimerSound (file: string, volume: number): void {
  const v = Math.min(1, Math.max(0, volume))
  if (v === 0) return
  const url = soundUrl(file)
  try {
    if (!url) { beep(v); return }
    const a = new Audio(url)
    a.volume = v
    void a.play().catch((e: unknown) => { console.warn(`[timer] 音效播放失敗:${String(e)}`) })
  } catch (e) {
    console.warn(`[timer] 音效播放失敗:${String(e)}`)
  }
}
