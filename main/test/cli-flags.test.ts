// code review 第 B 批:`--capture-bench` 只給開發版(非 packaged);main.ts 不得靜態 import 量測程式碼。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { captureBenchMode } from '../src/cli-flags'

describe('captureBenchMode', () => {
  it('沒帶參數 → off', () => {
    expect(captureBenchMode(['electron', '.'], false)).toBe('off')
    expect(captureBenchMode(['ExileAppraiser.exe'], true)).toBe('off')
  })
  it('開發版(非 packaged)→ run', () => {
    expect(captureBenchMode(['electron', 'main/dist/main.js', '--capture-bench', '--bench-out=x.json'], false)).toBe('run')
  })
  it('正式版(packaged)→ ignored(忽略並正常啟動)', () => {
    expect(captureBenchMode(['ExileAppraiser.exe', '--capture-bench'], true)).toBe('ignored')
  })
})

describe('main.ts 守門', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
  it('capture-bench 只以動態 import() 載入(不在啟動路徑上執行)', () => {
    expect(src).not.toMatch(/^import[^\n]*['"]\.\/ocr\/capture-bench['"]/m)
    expect(src).toMatch(/import\(['"]\.\/ocr\/capture-bench['"]\)/)
  })
  it('只在 captureBenchMode === "run" 時進入量測', () => {
    expect(src).toMatch(/captureBenchMode\(process\.argv, app\.isPackaged\)/)
  })
})
