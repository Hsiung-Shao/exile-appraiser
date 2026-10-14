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
 * - 霧面 0 → 第 30.6 步(2026-10-03)起也預先處理:只做縮放裁切 + 亮度(filter 只有 `brightness()`),面板顯示時就只是貼一張
 *   1:1 的靜態圖,不再每次重繪都把原圖(常見 1920×1080 以上)即時縮放並套 brightness filter。CSS 路徑只剩「圖還沒好 / 失敗」。
 * - 為什麼不直接把 canvas 放進 DOM:canvas 會自成合成層,疊在上面的文字因此從 LCD 次像素反鋸齒變成灰階(量測時看得出來);
 *   一般背景圖不會,文字呈現與原本相同。
 *
 * 純邏輯(何時重算、revoke、霧面 0 不模糊、過期的結果不套用、連續變更只畫最新的)在 `BgBaker`,
 * DOM 細節由呼叫端注入(BgLayer.vue),測試 `renderer/test/background.test.ts`。
 *
 * 第 30.6 步:容器隱藏(查價面板 v-show 藏起、設定視窗關閉)時 BgLayer 整個卸載,畫好的圖交給 `bgBakeCache` 保留,
 * 再顯示時直接換上(鍵相同就不重畫、不閃);背景關閉 / 換圖時清掉。
 *
 * 第 26 步(2026-10-03):顯示位置與填滿方式(`BgLayout`,查價面板 / 設定視窗各一組)。落點由 `bgLayoutRect` 算,
 * 與 CSS `background-position: x% y%` + `background-size: cover | contain | <cover × 倍率>` 同一條公式;預設(50 / 50 / cover)
 * 與原本的 cover 置中逐像素相同。
 */

import { computed, shallowRef, watch, type ComputedRef, type ShallowRef } from 'vue'
import { perfHooks } from './perf/renderer-perf'

/** 填滿方式:cover = 填滿(裁切)、contain = 完整顯示(留邊,空白處主題底色)、zoom = 在 cover 的基礎上再放大 `zoom`% */
export type BgFit = 'cover' | 'contain' | 'zoom'
export const BG_FITS: readonly BgFit[] = ['cover', 'contain', 'zoom']
export const BG_ZOOM_MIN = 100
export const BG_ZOOM_MAX = 300

/** 一個容器(查價面板 / 設定視窗)的顯示位置與填滿方式 */
export interface BgLayout {
  /** 焦點(圖上要保持可見的位置)水平 / 垂直 0–100(%):圖上 x% 的點落在框的 x% 處(= CSS background-position 百分比) */
  x: number
  y: number
  fit: BgFit
  /** 100–300(%),只在 fit = 'zoom' 時有作用 */
  zoom: number
}
export const BG_LAYOUT_DEFAULT: Readonly<BgLayout> = Object.freeze({ x: 50, y: 50, fit: 'cover', zoom: 100 })

/** 實際生效的倍率(非 zoom 模式 = 100) */
export function bgEffectiveZoom (l: BgLayout): number {
  return l.fit === 'zoom' ? l.zoom : 100
}

/** 是否就是預設呈現(cover、置中;CSS 路徑此時不寫任何 inline 變數 = 與改版前相同) */
export function bgLayoutIsDefault (l: BgLayout): boolean {
  return l.x === 50 && l.y === 50 && bgEffectiveZoom(l) === 100 && l.fit !== 'contain'
}

/**
 * 圖在框裡的落點(單位與 box 相同):
 * - cover:s = max(框寬 / 圖寬, 框高 / 圖高);zoom:同 cover 再 × 倍率;contain:s = min(…);
 * - 位置:x = (框寬 − 圖寬 × s) × 焦點x%,y 同理(= CSS background-position 百分比;cover / zoom 時差值 ≤ 0 → 往外推,
 *   contain 時差值 ≥ 0 → 留邊在焦點的反方向)。圖上 (焦點x%, 焦點y%) 那一點永遠落在框的 (焦點x%, 焦點y%)。
 */
export function bgLayoutRect (imgW: number, imgH: number, boxW: number, boxH: number, l: BgLayout = BG_LAYOUT_DEFAULT): { x: number, y: number, w: number, h: number } {
  const s = l.fit === 'contain'
    ? Math.min(boxW / imgW, boxH / imgH)
    : Math.max(boxW / imgW, boxH / imgH) * (bgEffectiveZoom(l) / 100)
  const w = imgW * s
  const h = imgH * s
  // + 0:焦點 0 時 (負數) × 0 = −0,換成 +0(其他值不變)
  return { x: (boxW - w) * (l.x / 100) + 0, y: (boxH - h) * (l.y / 100) + 0, w, h }
}

/**
 * CSS 路徑(霧面 0 / 預先模糊還沒好或失敗)用的 `background-position` / `background-size`;預設 → null(不寫 inline,沿用樣式表的 center / cover)。
 * zoom 要圖的原始大小與框大小(比例即可)才能換成百分比;還不知道 → 先用 cover(倍率 100 的樣子),知道後再補。
 */
export function bgCssLayout (l: BgLayout, img: { w: number, h: number } | null, box: { w: number, h: number }): { pos: string, size: string } | null {
  if (bgLayoutIsDefault(l)) return null
  const pos = `${l.x}% ${l.y}%`
  if (l.fit === 'contain') return { pos, size: 'contain' }
  const z = bgEffectiveZoom(l)
  if (z === 100 || !img || !(img.w > 0 && img.h > 0) || !(box.w > 0 && box.h > 0)) return { pos, size: 'cover' }
  const r = bgLayoutRect(img.w, img.h, box.w, box.h, l)
  const p = (v: number) => `${Math.round(v * 10000) / 10000}%`
  return { pos, size: `${p((r.w / box.w) * 100)} ${p((r.h / box.h) * 100)}` }
}

/** 預先處理需要的設定(useTheme.ts `bgBakeSpec` 產生);null = 沒有背景(沒有圖 / 關閉)。第 30.6 步起霧面 0 也有(blurPx 0) */
export interface BgBakeSpec {
  url: string
  /** 亮度 0–1(= CSS `--bg-bright`) */
  bright: number
  /** 模糊半徑(CSS px,= CSS `--bg-blur`);≥ 0(0 = 只縮放裁切 + 亮度) */
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
  /** 第 26 步:這個容器的顯示位置與填滿方式;省略 = 預設(cover、置中) */
  layout?: BgLayout
}

/** 與 pobtools.css `.bgimg { transform: scale(1.04) }` 同值(樣式守門測試核對) */
export const BG_SCALE = 1.04

/** 繪製結果是否相同的鍵:任何一項變了才重畫 */
export function bgBakeKey (i: BgBakeInput): string {
  const l = i.layout ?? BG_LAYOUT_DEFAULT
  return [i.url, i.bright, i.blurPx, i.width, i.height, i.dpr, i.color, l.fit === 'contain' ? 'contain' : 'cover', bgEffectiveZoom(l), l.x, l.y].join('|')
}

/** `background-size: cover; background-position: center` 的落點(以畫布像素計;= 預設的 `bgLayoutRect`) */
export function bgCoverRect (imgW: number, imgH: number, boxW: number, boxH: number): { x: number, y: number, w: number, h: number } {
  return bgLayoutRect(imgW, imgH, boxW, boxH, BG_LAYOUT_DEFAULT)
}

/** 與 CSS `.bgimg` 同一串 filter;scale = 畫布像素 / CSS px(dpr × BG_SCALE)。霧面 0 只有亮度(CSS 的 blur(0px) 不做事) */
export function bgBakeFilter (bright: number, blurPx: number, scale: number): string {
  if (!(blurPx > 0)) return `brightness(${bright})`
  return `brightness(${bright}) blur(${Math.round(blurPx * scale * 1000) / 1000}px)`
}

/**
 * 一次繪製的計畫:畫布大小、圖的落點(依 layout;預設 cover、置中)、filter。
 * 第 30.6 步:畫布寬高取整數後兩軸比例可能差一點(例:框 460 → 478.4 → 478,高 900 → 936),顯示時畫布會被拉回框 × 1.04;
 * 這時落點改在「框」上算(= CSS 的 background-position / size)再各軸換算到畫布,拉回去後與 CSS 版的矩形完全重合
 * (以前直接在畫布上算,圖會多 / 少 1 個畫布像素,霧面 0 不再模糊後看得出來)。兩軸比例相同時沿用原本的算法(逐位元不變)。
 */
export function bgBakePlan (i: BgBakeInput, imgW: number, imgH: number): {
  width: number
  height: number
  rect: { x: number, y: number, w: number, h: number }
  filter: string
} {
  const width = Math.max(1, Math.round(i.width * BG_SCALE))
  const height = Math.max(1, Math.round(i.height * BG_SCALE))
  const layout = i.layout ?? BG_LAYOUT_DEFAULT
  const kx = width / i.width
  const ky = height / i.height
  let rect: { x: number, y: number, w: number, h: number }
  if (kx === ky) {
    rect = bgLayoutRect(imgW, imgH, width, height, layout)
  } else {
    const r = bgLayoutRect(imgW, imgH, i.width, i.height, layout)
    rect = { x: r.x * kx, y: r.y * ky, w: r.w * kx, h: r.h * ky }
  }
  return { width, height, rect, filter: bgBakeFilter(i.bright, i.blurPx, i.dpr * BG_SCALE) }
}


/** code review 第 B 批:框大小停止變動多久後才重畫(拖曳設定視窗改大小時不每幀重畫 PNG) */
export const BG_RESIZE_SETTLE_MS = 200

/**
 * 框大小變動的去抖(`BgLayer.vue` 的 ResizeObserver 用;測試注入假計時器):
 * - 從 0(隱藏)變成有大小、變成 0、或畫面上還沒有預先模糊的圖(`hasBaked` false)→ 立刻 `fire`(顯示 / 隱藏 / 第一張不延遲);
 * - 其他(拖曳中連續變動)→ 停止變動 `BG_RESIZE_SETTLE_MS` 後才 `fire` 一次;期間 `.bgimg[data-baked]` 沿用舊圖
 *   (`100% 100%` 拉伸,仍是模糊過的圖;比暫時切回 CSS `filter: blur()` 每幀在 CPU 重算便宜,外觀也連續)。
 * 主題 / 霧面 / 圖片變更不經過這裡(維持立即)。
 */
export function createResizeSettle (fire: () => void, opts: {
  ms?: number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: unknown) => void
} = {}) {
  const ms = opts.ms ?? BG_RESIZE_SETTLE_MS
  const set = opts.setTimeout ?? ((fn: () => void, t: number) => setTimeout(fn, t))
  const clear = opts.clearTimeout ?? ((h: unknown) => { clearTimeout(h as ReturnType<typeof setTimeout>) })
  let timer: unknown = null
  const cancel = () => { if (timer != null) { clear(timer); timer = null } }
  return {
    resized (prev: { w: number, h: number }, next: { w: number, h: number }, hasBaked: boolean): void {
      const visibility = !(prev.w > 0 && prev.h > 0) || !(next.w > 0 && next.h > 0)
      if (visibility || !hasBaked) {
        cancel()
        fire()
        return
      }
      cancel()
      timer = set(() => { timer = null; fire() }, ms)
    },
    cancel,
    get pending (): boolean { return timer != null }
  }
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
  /** 切回原本的 CSS 呈現(沒有圖 / 載入失敗 / 框大小 0) */
  clear: () => void
}

const drawable = (i: BgBakeInput | null): i is BgBakeInput => i != null && i.blurPx >= 0 && i.width > 0 && i.height > 0

/**
 * 狀態機:`update(input | null)` 每次設定 / 大小 / 主題變了就呼叫。
 * - 鍵與畫面上的相同就不重畫;同一張來源圖只載入一次(換圖 / 霧面 0 時釋放);
 * - 一次只畫一張:畫的途中又有變更只記下最新的,畫完再畫最新的(拖滑桿不會排一長串);
 * - 新圖好了才換,舊圖換下時 revoke;畫好時設定已經變了的結果直接 revoke 不套用;
 * - 沒有圖(input null)→ 立刻回到原本的 CSS 並 revoke 目前的圖;霧面 0 也照樣預先處理(第 30.6 步)。
 * - 第 30.6 步:`detach()` 卸載時把畫面上的圖交出去(給 `bgBakeCache`,不 revoke),`adopt()` 新掛載時直接換上。
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
    const off = input == null
    if (!drawable(input)) {
      this.toCss()
      // 沒有圖:來源圖也不用留;只是框暫時是 0(隱藏)就留著,顯示回來不必重新解碼
      if (off) { this.dropImage(); this.failedUrl = null; this.failedKey = null }
      return
    }
    if (this.shown?.key === bgBakeKey(input)) return
    if (!this.busy) void this.run()
  }

  /**
   * 第 30.6 步:卸載前把畫面上的圖交出去(不 revoke、不切回 CSS;元素馬上就要移除)。之後照常 `dispose()`。
   * 沒有圖 / 已卸載 → null。
   */
  detach (): { key: string, out: Out } | null {
    if (this.disposed) return null
    const s = this.shown
    this.shown = null
    return s
  }

  /**
   * 第 30.6 步:新掛載時直接換上之前畫好的圖(`bgBakeCache` 取回;同步呼叫 `show`,第一幀就是它、不閃)。
   * 之後第一次 `update` 的鍵相同就不重畫;不同就照常重畫,好了才換掉它。已有圖 / 畫圖中 / 已卸載 → 不收(回 false,呼叫端自行丟棄)。
   */
  adopt (key: string, out: Out): boolean {
    if (this.disposed || this.shown || this.busy) return false
    this.deps.show(out)
    this.shown = { key, out }
    return true
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

/**
 * 第 30.6 步:容器隱藏(BgLayer 卸載)時保留畫好的圖,再顯示時直接換上 —— 不重畫、不閃。
 * 一個容器(查價面板 / 設定視窗)最多一張;放新的會丟掉舊的。背景關閉或換圖時 `clear()`(useTheme.ts `useBackground`)。
 */
export class BgBakeCache<Out> {
  private readonly items = new Map<string, { key: string, out: Out, discard: (out: Out) => void }>()

  put (host: string, key: string, out: Out, discard: (out: Out) => void): void {
    const old = this.items.get(host)
    this.items.set(host, { key, out, discard })
    if (old && old.out !== out) old.discard(old.out)
  }

  /** 取出(取出後就不在快取裡,由取出的人負責) */
  take (host: string): { key: string, out: Out, discard: (out: Out) => void } | null {
    const e = this.items.get(host)
    if (!e) return null
    this.items.delete(host)
    return e
  }

  clear (): void {
    const all = [...this.items.values()]
    this.items.clear()
    for (const e of all) e.discard(e.out)
  }

  get size (): number { return this.items.size }
}

/** 全程式共用一份(BgLayerImage.vue 卸載時放、掛載時取;useTheme.ts 背景關閉 / 換圖時清) */
export const bgBakeCache = new BgBakeCache<unknown>()

// ---------------- B9:來源圖保留、設定頁預覽圖(2026-10-14) ----------------
//
// 量測(docs/perf/changes-round6.md):有背景圖時開設定,大宗是「來源圖重新載入 + 解碼」(BgLayerImage 卸載時 dispose 釋放原圖,
// 設定視窗大小 / 主題 / dpr 一變就要整張重抓重解碼)與一般分頁的縮圖 / 兩個位置預覽框各自用原圖(4K 原圖即時縮放 + CSS blur)。
// 修正:來源圖解碼一次留在 `bgSourceCache`(換圖 / 背景關閉時清);設定頁縮圖與預覽框共用一張 ≤ 480 px 的縮小預覽圖。

/** 解碼後的來源圖:能直接 drawImage 的影像 + 原始寬高(落點一律用原始寬高算,縮小保存不影響構圖) */
export interface BgSource {
  image: CanvasImageSource
  width: number
  height: number
}

/**
 * 一次只留一張來源圖(目前的背景圖網址):同一張只載一次,載入中的 Promise 共用;換圖 / `clear()` 釋放舊的。
 * 載入失敗不快取(下次重試);清掉之後才載好的直接釋放(呼叫端拿到的影像可能已釋放 → 繪製失敗走 CSS,與原本的失敗路徑相同)。
 */
export class BgSourceCache<Img> {
  private entry: { url: string, p: Promise<Img> } | null = null
  private value: Img | null = null
  private gen = 0

  constructor (private readonly release: (img: Img) => void, private readonly onClear?: () => void) {}

  get (url: string, load: (url: string) => Promise<Img>): Promise<Img> {
    if (this.entry?.url === url) return this.entry.p
    this.clear()
    const gen = this.gen
    const p = load(url).then((img) => {
      if (gen !== this.gen) { this.release(img); return img }
      this.value = img
      return img
    }, (e: unknown) => {
      if (gen === this.gen) this.entry = null
      throw e
    })
    this.entry = { url, p }
    return p
  }

  clear (): void {
    this.gen++
    this.onClear?.()
    this.entry = null
    const v = this.value
    this.value = null
    if (v != null) this.release(v)
  }

  get size (): number { return this.value != null ? 1 : 0 }
}

function releaseBgSource (s: BgSource): void {
  const img = s.image as { removeAttribute?: (n: string) => void }
  img.removeAttribute?.('src')
}

/** 全程式共用一份(BgLayerImage 與設定頁預覽圖都從這裡拿;useTheme.ts 背景關閉 / 換圖時清) */
export const bgSourceCache = new BgSourceCache<BgSource>(releaseBgSource)

/** 載入並解碼來源圖(CORS:要畫進可輸出的 canvas,main 的 app://bg 回應帶 ACAO);解碼後的 <img> 由 `bgSourceCache` 保管 */
export async function loadBgSource (url: string): Promise<BgSource> {
  const t0 = performance.now()
  const done = (src: BgSource): BgSource => {
    const ms = Math.round((performance.now() - t0) * 10) / 10
    console.log(`[bg] 載入來源圖 ${src.width}×${src.height}:${ms} ms`)
    perfHooks.bg?.({ kind: 'load', ms })
    return src
  }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = url
  await img.decode()
  // 刻意不轉 ImageBitmap:從 ImageBitmap 縮放與從 <img> 縮放的重取樣不同,霧面 0 時差到 14/255(超過第 10 步門檻)
  return done({ image: img, width: img.naturalWidth, height: img.naturalHeight })
}

/**
 * 留著的 <img> 可能已被 Blink 丟掉解碼後的像素:畫之前先非同步 `decode()`,drawImage 才不會在主執行緒同步解碼整張原圖
 * (實測 dpr 1.5 開設定多一個約 55 ms 的 longtask)。已解碼時幾乎不花時間;失敗照畫(由繪製本身決定成敗)。
 */
export async function redecode (src: BgSource): Promise<void> {
  const img = src.image as { decode?: () => Promise<void> }
  if (typeof img.decode === 'function') await img.decode().catch(() => {})
}

/** 設定頁預覽圖的最大寬度(px;一般分頁縮圖 120 px、位置預覽框最寬 15em) */
export const BG_PREVIEW_MAX_W = 480

/** 預覽圖大小:長邊不超過 `BG_PREVIEW_MAX_W`,保持比例,小圖不放大 */
export function bgPreviewSize (w: number, h: number): { w: number, h: number } {
  const k = Math.min(1, BG_PREVIEW_MAX_W / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** 一張預覽圖:blob URL(JPEG)+ 原圖原始寬高(「縮放」預覽換算百分比用) */
export interface BgPreview { url: string, src: string, width: number, height: number }

/** 預覽圖快取(同一個背景圖網址只做一次;useTheme.ts 換圖 / 關閉時清) */
export const bgPreviewCache = new BgSourceCache<BgPreview>((p) => { URL.revokeObjectURL(p.src) }, () => { bgPreviewGeneration.value++ })

/** 預覽快取被清掉(blob 已 revoke)的世代:`useBgPreview` 監看它,清了就重做 */
export const bgPreviewGeneration = shallowRef(0)

/** 目前顯示中的背景網址(useTheme.ts 注入;bg-bake 不能 import useTheme = 循環)。只有這張才走共用的 `bgSourceCache` */
let bgShownProbe: () => string | null = () => null
export function setBgShownProbe (fn: () => string | null): void { bgShownProbe = fn }

export interface BgPreviewDeps {
  shownUrl?: () => string | null
  load?: (url: string) => Promise<BgSource>
  cache?: BgSourceCache<BgSource>
}

/** 做預覽圖(匯出供測試)。背景沒在顯示這張時用一次性載入、做完立刻釋放,不讓 4K 解碼圖留在 `bgSourceCache` */
export async function makeBgPreview (url: string, deps: BgPreviewDeps = {}): Promise<BgPreview> {
  const load = deps.load ?? loadBgSource
  const shared = (deps.shownUrl ?? bgShownProbe)() === url
  const src = shared ? await (deps.cache ?? bgSourceCache).get(url, load) : await load(url)
  try {
    return await drawBgPreview(url, src)
  } finally {
    if (!shared) releaseBgSource(src)
  }
}

async function drawBgPreview (url: string, src: BgSource): Promise<BgPreview> {
  await redecode(src)
  const size = bgPreviewSize(src.width, src.height)
  const c = document.createElement('canvas')
  c.width = size.w
  c.height = size.h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src.image, 0, 0, size.w, size.h)
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.9))
  c.width = 0
  c.height = 0
  return { url, src: URL.createObjectURL(blob), width: src.width, height: src.height }
}

/** 預覽圖狀態:做好 = preview;做不出來(CORS / 解碼失敗)= failed(呼叫端退回原圖、不套模糊) */
export interface BgPreviewState { preview: BgPreview | null, failed: boolean }

/**
 * 設定頁(一般分頁縮圖、位置預覽框)用的縮小預覽圖:網址變了才重做。
 * 與 BgLayerImage 共用同一份解碼後的來源圖(`bgSourceCache`),不另外解碼原圖。
 */
export function useBgPreview (url: () => string | null): ShallowRef<BgPreviewState> {
  const out = shallowRef<BgPreviewState>({ preview: null, failed: false })
  let lastGen = bgPreviewGeneration.value
  watch([url, bgPreviewGeneration], ([u, g]) => {
    // 快取被清掉 → 舊預覽的 blob 已 revoke,丟掉重做
    const regen = g !== lastGen
    lastGen = g
    if (!u) { out.value = { preview: null, failed: false }; return }
    if (regen || out.value.preview?.url !== u) out.value = { preview: null, failed: false }
    bgPreviewCache.get(u, (x) => makeBgPreview(x))
      .then((p) => { if (url() === u) out.value = { preview: p, failed: false } })
      .catch(() => { if (url() === u) out.value = { preview: null, failed: true } })
  }, { immediate: true })
  return out
}

/** CSS `url("…")`(跳脫引號 / 反斜線) */
export const cssUrl = (u: string) => `url("${u.replace(/["\\]/g, '\\$&')}")`

/** 縮圖畫布大小(CSS px;= General.vue `.bg-thumb`) */
export const BG_THUMB_CSS = { w: 120, h: 68 } as const

/**
 * 一般分頁的縮圖:從預覽圖畫 cover 置中 + 亮度 + 模糊(與原本 CSS `filter: brightness() blur(霧面 / 100 × 4 px)` 同參數)→ data URL。
 * 預覽圖只有 ≤ 480 px,每次調亮度 / 霧面重畫一張 120 × 68 × dpr 的小圖,不再對原圖即時套 CSS blur。
 */
export function bgThumbDataUrl (preview: BgPreview, img: CanvasImageSource, bright: number, blur: number, dpr: number, color: string): string | null {
  const w = Math.round(BG_THUMB_CSS.w * dpr)
  const h = Math.round(BG_THUMB_CSS.h * dpr)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const work = document.createElement('canvas')
  work.width = w
  work.height = h
  const wc = work.getContext('2d')
  if (!wc) return null
  wc.fillStyle = color
  wc.fillRect(0, 0, w, h)
  const r = bgLayoutRect(preview.width, preview.height, w, h)
  wc.imageSmoothingQuality = 'high'
  wc.drawImage(img, r.x, r.y, r.w, r.h)
  ctx.filter = bgBakeFilter(bright / 100, (blur / 100) * 4, dpr)
  ctx.drawImage(work, 0, 0)
  const out = c.toDataURL('image/png')
  c.width = 0
  work.width = 0
  return out
}

/**
 * 一般分頁縮圖的 CSS 背景值:預覽圖好了 → 預先畫好亮度 + 模糊的小圖(`bgThumbDataUrl`);還沒好 → null(空白);
 * 預覽圖做不出來 → `fallback()`(原圖網址,不套任何 filter)。
 */
export function useBgThumb (
  state: ShallowRef<BgPreviewState>,
  look: () => { bright: number, blur: number },
  fallback: () => string | null
): ComputedRef<string | null> {
  const img = shallowRef<{ src: string, el: HTMLImageElement } | null>(null)
  const failed = shallowRef(false)
  watch(() => state.value.preview, (p) => {
    img.value = null
    failed.value = false
    if (!p) return
    const el = new Image()
    el.decoding = 'async'
    el.src = p.src
    el.decode().then(() => { if (state.value.preview?.src === p.src) img.value = { src: p.src, el } }).catch(() => { failed.value = true })
  }, { immediate: true })
  return computed(() => {
    const p = state.value.preview
    const i = img.value
    if (p && i && i.src === p.src) {
      const { bright, blur } = look()
      const color = getComputedStyle(document.documentElement).getPropertyValue('--surface-0-c').trim() || '#000'
      const data = bgThumbDataUrl(p, i.el, bright, blur, window.devicePixelRatio || 1, color)
      if (data) return cssUrl(data)
    }
    if (state.value.failed || failed.value) {
      const f = fallback()
      return f ? cssUrl(f) : null
    }
    return null
  })
}
