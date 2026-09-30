// exile-appraiser(WP-S):OCR 腳本內嵌(main/build/script.mjs 的 esbuild `loader: { '.ps1': 'text' }`)。
// scripts/ocr-fixture.mjs 直接讀 win-ocr.ps1 同一個檔,不經這裡。
import script from './win-ocr.ps1'

export const WIN_OCR_SCRIPT: string = script
