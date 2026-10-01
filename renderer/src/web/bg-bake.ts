/**
 * exile-appraiser(2026-10-01,效能修正第 10 步):自訂背景圖的「預先模糊」。
 *
 * 以前 `.bgimg` 用 CSS `filter: brightness() blur(≤24px)`,每次該區域重繪(拆粉表 / 正則清單捲動、查價結果更新)
 * 都要即時重做一次模糊(本程式關掉硬體加速,全在 CPU 上做)。改成:設定(圖、亮度、霧面)、容器大小、裝置像素比或主題底色變了,
 * 才在 renderer 用 canvas 照「同一串 filter」畫一次、輸出 PNG blob URL,`.bgimg` 改用那張圖當背景、不再套 CSS filter;
 * 平常重繪只是貼一張靜態圖。
 *
 * 與原本 CSS 外觀等價的做法(逐項對應 pobtools.css `.bgimg`):
 * - 畫布 = `.bgimg` 自己的框 × 裝置像素 × BG_SCALE(= CSS 的 `scale(1.04)`):CSS 的 filter 是在放大後的解析度上
 *   點陣化並模糊的,照這個解析度畫,經 `background-size: 100% 100%` + 同一個 scale(1.04) 顯示時剛好 1:1,不多一次重取樣
 *   (只用框的大小畫再放大 1.04,細線條處會差到 14/255;照放大後的解析度畫,最大差 ≤ 5/255)。
 * - 先在中間畫布不加濾鏡畫「底色 `--surface-0-c` + 圖(background-size: cover、置中)」,再整張以
 *   `ctx.filter = 'brightness(b) blur(N×dpr×1.04 px)'` 畫到輸出畫布 —— 與 CSS 對整個元素(背景色 + 圖)套 filter 同一個順序、
 *   同一個 std-dev(CSS blur 長度在螢幕上要乘 dpr 與 scale;canvas filter 的長度是畫布像素)。
 * - 邊緣:CSS filter 把元素框外當透明(霧面大時邊緣會淡出,scale(1.04) 只遮掉一部分);canvas filter 一樣把畫布外當透明,
 *   PNG 保留 alpha,所以邊緣淡出的量也一樣 —— 刻意不 clamp,外觀才不變。
 * - 霧面 0 → 不預先模糊,維持原本的 CSS(只有亮度 filter)。
 * - 為什麼不直接把 canvas 放進 DOM:canvas 會自成合成層,疊在上面的文字因此從 LCD 次像素反鋸齒變成灰階(量測時看得出來);
 *   一般背景圖不會,文字呈現與原本相同。
 *
 * 純邏輯(何時重算、revoke、霧面 0 不模糊、過期的結果不套用、連續變更只畫最新的)在 `BgBaker`,
 * DOM 細節由呼叫端注入(BgLayer.vue),測試 `renderer/test/background.test.ts`。
 */

/** 預先模糊需要的設定(useTheme.ts `bgBakeSpec` 產生);null = 不預先模糊(沒有圖 / 關閉 / 霧面 0) */
export interface BgBakeSpec {
  url: string
  /** 亮度 0–1(= CSS `--bg-bright`) */
  bright: number
  /** 模糊半徑(CSS px,= CSS `--bg-blur`);> 0 */
  blurPx: number
}

/** 一次繪製的完整輸入:設定 + 目前的框大小(裝置像素)/ dpr / 主題底色 */
export interface BgBakeInput extends BgBakeSpec {
  /** 畫布寬高(裝置像素,= `.bgimg` 框 × dpr) */
  width: number
  height: number
  dpr: number
  /** `--surface-0-c` 的計算值(CSS 的 `.bgimg` 背景色) */
  color: string
}

/** 與 pobtools.css `.bgimg { transform: scale(1.04) }` 同值(樣式守門測試核對) */
export const BG_SCALE = 1.04

/** 繪製結果是否相同的鍵:任何一項變了才重畫 */
export function bgBakeKey (i: BgBakeInput): string {
  return [i.url, i.bright, i.blurPx, i.width, i.height, i.dpr, i.color].join('|')
}

/** `background-size: cover; background-position: center` 的落點(以畫布像素計) */
export function bgCoverRect (imgW: number, imgH: number, boxW: number, boxH: number): { x: number, y: number, w: number, h: number } {
  const s = Math.max(boxW / imgW, boxH / imgH)
  const w = imgW * s
  const h = imgH * s
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/** 與 CSS `.bgimg` 同一串 filter;scale = 畫布像素 / CSS px(dpr × BG_SCALE) */
export function bgBakeFilter (bright: number, blurPx: number, scale: number): string {
  return `brightness(${bright}) blur(${Math.round(blurPx * scale * 1000) / 1000}px)`
}

/** 一次繪製的計畫:畫布大小、圖的落點(cover、置中)、filter */
export function bgBakePlan (i: BgBakeInput, imgW: number, imgH: number): { width: number, height: number, rect: { x: number, y: number, w: number, h: number }, filter: string } {
  const width = Math.max(1, Math.round(i.width * BG_SCALE))
  const height = Math.max(1, Math.round(i.height * BG_SCALE))
  return { width, height, rect: bgCoverRect(imgW, imgH, width, height), filter: bgBakeFilter(i.bright, i.blurPx, i.dpr * BG_SCALE) }
}

/** 呼叫端注入的 DOM 動作(測試用假的) */
export interface BgBakerDeps<Img, Out> {
  /** 載入並解碼來源圖;失敗 reject(→ 原本的 CSS 呈現) */
  load: (url: string) => Promise<Img>
  /** 畫一張預先模糊的圖(canvas → PNG blob URL → 預先解碼);失敗 reject */
  render: (img: Img, input: BgBakeInput) => Promise<Out>
  /** 換上(同步;新圖已解碼好才呼叫,不閃爍) */
  show: (out: Out) => void
  /** 不再顯示 / 過期沒用到的圖 → revoke blob URL */
  discard: (out: Out) => void
  /** 不再用的來源圖(換圖 / 霧面 0 / 卸載)→ 釋放解碼後的記憶體 */
  release: (img: Img) => void
  /** 切回原本的 CSS 呈現(霧面 0 / 沒有圖 / 載入失敗 / 框大小 0) */
  clear: () => void
}

const drawable = (i: BgBakeInput | null): i is BgBakeInput => i != null && i.blurPx > 0 && i.width > 0 && i.height > 0

/**
 * 狀態機:`update(input | null)` 每次設定 / 大小 / 主題變了就呼叫。
 * - 鍵與畫面上的相同就不重畫;同一張來源圖只載入一次(換圖 / 霧面 0 時釋放);
 * - 一次只畫一張:畫的途中又有變更只記下最新的,畫完再畫最新的(拖滑桿不會排一長串);
 * - 新圖好了才換,舊圖換下時 revoke;畫好時設定已經變了的結果直接 revoke 不套用;
 * - 霧面 0 / 沒有圖 → 立刻回到原本的 CSS 並 revoke 目前的圖。
 */
export class BgBaker<Img, Out> {
  private img: { url: string, img: Img } | null = null
  private shown: { key: string, out: Out } | null = null
  private latest: BgBakeInput | null = null
  private busy = false
  private disposed = false
  /** 載入失敗的來源圖(不重試,換圖或關掉再開才重試);畫失敗的鍵(同上) */
  private failedUrl: string | null = null
  private failedKey: string | null = null

  constructor (private readonly deps: BgBakerDeps<Img, Out>) {}

  /** 目前畫面對應的鍵(null = 原本的 CSS 呈現) */
  get key (): string | null { return this.shown?.key ?? null }

  update (input: BgBakeInput | null): void {
    if (this.disposed) return
    this.latest = input
    const off = input == null || !(input.blurPx > 0)
    if (!drawable(input)) {
      this.toCss()
      // 霧面 0 / 沒有圖:來源圖也不用留;只是框暫時是 0(隱藏)就留著,顯示回來不必重新解碼
      if (off) { this.dropImage(); this.failedUrl = null; this.failedKey = null }
      return
    }
    if (this.shown?.key === bgBakeKey(input)) return
    if (!this.busy) void this.run()
  }

  /** 卸載:釋放來源圖、revoke 目前的圖;途中的載入 / 繪製完成時直接丟掉 */
  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.dropImage()
    this.toCss()
  }

  private async run (): Promise<void> {
    this.busy = true
    try {
      while (!this.disposed) {
        const input = this.latest
        if (!drawable(input)) break
        const key = bgBakeKey(input)
        if (this.shown?.key === key || input.url === this.failedUrl || key === this.failedKey) break
        if (this.img?.url !== input.url) {
          this.dropImage()
          let img: Img
          try {
            img = await this.deps.load(input.url)
          } catch {
            this.failedUrl = input.url
            if (this.latest?.url === input.url) this.toCss()
            continue
          }
          if (this.disposed) { this.deps.release(img); break }
          this.img = { url: input.url, img }
          continue // 載入期間設定可能又變了:重新看最新的
        }
        let out: Out
        try {
          out = await this.deps.render(this.img.img, input)
        } catch {
          this.failedKey = key
          if (this.latest && drawable(this.latest) && bgBakeKey(this.latest) === key) this.toCss()
          continue
        }
        const cur = this.latest
        if (this.disposed || !drawable(cur) || bgBakeKey(cur) !== key) { this.deps.discard(out); continue }
        const old = this.shown
        this.deps.show(out)
        this.shown = { key, out }
        if (old) this.deps.discard(old.out)
      }
    } finally {
      this.busy = false
    }
  }

  private toCss (): void {
    const old = this.shown
    if (!old) return
    this.shown = null
    this.deps.clear()
    this.deps.discard(old.out)
  }

  private dropImage (): void {
    const old = this.img
    if (!old) return
    this.img = null
    this.deps.release(old.img)
  }
}
