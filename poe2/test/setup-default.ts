// exile-appraiser: 每個測試檔開跑前先有一份預設環境(資料來源 + 離線交易資料 + 預設 host 選項);
// 上游 vitest.setup.ts 的 vi.mock 是全域生效的,不呼叫 setupTests() 的 spec 也吃得到 —— 這裡對齊那個行為。
import { setupTests } from './vitest.setup'

setupTests()
