// exile-appraiser: 上游把 RateLimiter 放在 trade/ 底下(Vue shallowReactive 版);本專案抽到 core 供兩個遊戲共用,這裡只留轉接。
// 上游 E 版與 APT 版的邏輯相同(只差格式),core 版見 core/src/http/RateLimiter.ts。
export { RateLimiter } from '@exile-appraiser/core/http/RateLimiter'
