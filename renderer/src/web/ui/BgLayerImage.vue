<!--
  exile-appraiser(2026-10-01):自訂背景圖層的本體。第 30.6 步起由 BgLayer.vue(閘門)在「背景開著且容器顯示中」才掛載;
  以下說明沿用(原本就是 BgLayer.vue)。放在 `.bg-host` 容器(查價面板 #price-window、設定視窗)的第一個子元素;
  沒有背景(<html> 沒有 data-bg)時 display: none。樣式在 theme/pobtools.css(.bgimg 圖 + 亮度 / 霧面、.bgtint 面板底色 × 面板不透明度),
  兩層都是 position: absolute; inset: 0; z-index: -1,容器以 isolation: isolate 自成堆疊,所以只畫在容器裡、內容永遠在圖上面;
  overlay 的其他區域(透明全螢幕視窗)不受影響。
  效能修正第 10 步(2026-10-01):霧面 > 0 時不再用 CSS filter 即時模糊,改由 ../bg-bake.ts 在設定 / 大小 / dpr / 主題底色變了時
  用 canvas 照同一串 filter 畫一次、輸出 PNG blob URL,寫進 .bgimg 的 `--bg-baked` + `data-baked`(pobtools.css 拿掉即時的背景與 filter,
  改用這張圖;scale(1.04) 照舊)。圖還沒好、載入或繪製失敗時就是原本的 CSS 呈現(第 30.6 步之前霧面 0 也是)。
  code review 第 B 批:框大小變動(拖曳設定視窗)停止約 200 ms 後才重畫(`createResizeSettle`),期間沿用舊圖(拉伸);
  顯示 / 隱藏、第一張圖、主題 / 霧面 / 圖片變更維持立即。
  第 26 步(2026-10-03):`host`(panel = 查價面板、settings = 設定視窗)決定讀哪一組顯示位置與填滿方式(`bgLayouts`)。
  預先模糊路徑:落點交給 bgBakePlan(鍵含 fit / 倍率 / 焦點);CSS 路徑:在 .bgimg 寫 `--bg-pos` / `--bg-size`
  (pobtools.css 的 .bgimg 以它們取代 center / cover;「縮放」要圖的原始大小換成百分比,另外載入一次量大小)。
  預設(cover、置中)不寫任何變數 = 與改版前相同。另把量到的框大小(CSS px)寫進 `bgHostSize` 給設定頁預覽框當長寬比。
  第 30.6 步(2026-10-03):霧面 0 也走預先處理(只縮放裁切 + 亮度;bg-bake.ts);卸載時把畫好的圖交給 `bgBakeCache`,
  再掛載時第一幀就直接換上(鍵相同不重畫、不閃),背景關閉 / 換圖時 useTheme.ts 清掉。
-->
<template>
  <div ref="imgEl" class="bgimg" aria-hidden="true" data-bg-layer="image" />
  <div class="bgtint" aria-hidden="true" data-bg-layer="tint" />
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { BgBaker, bgBakeCache, bgBakePlan, bgCssLayout, createResizeSettle, type BgBakeInput } from '../bg-bake'
import { bgBake, bgHostSize, bgLayouts, bgShownUrl, type BgHost } from '../useTheme'

/** 畫好的圖:blob URL + 已解碼的 Image(留著參照,換上時不必再解碼、不閃爍) */
interface Baked { url: string, img: HTMLImageElement }

/** 換下 / 不再用的畫好的圖:revoke blob URL、放掉解碼後的記憶體 */
function discardBaked (b: Baked): void {
  URL.revokeObjectURL(b.url)
  b.img.removeAttribute('src')
}

async function decoded (src: string, cors: boolean): Promise<HTMLImageElement> {
  const img = new Image()
  // 來源圖要能畫進「可輸出」的 canvas:跨來源(app://app → app://bg、開發模式的 Vite → app://bg)要 CORS(main 的 app:// 回應帶 ACAO)
  if (cors) img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = src
  await img.decode()
  return img
}

export default defineComponent({
  props: {
    /** 這一層畫在哪個容器:查價面板(#price-window)/ 設定視窗 */
    host: { type: String as PropType<BgHost>, default: 'panel' },
    /** 同一個 host 的第二個容器(BgLayer.vue `instance`):快取鍵用它,且不回寫 bgHostSize */
    instance: { type: String, default: undefined }
  },
  setup (props) {
    const imgEl = ref<HTMLElement | null>(null)
    const layout = computed(() => bgLayouts.value[props.host])
    // 「縮放」模式的 CSS 路徑要圖的原始大小(載入一次;換圖才重量)
    let natural: { url: string, w: number, h: number } | null = null
    let naturalLoading: string | null = null
    // .bgimg 的框(裝置像素,transform 之前);0 = 隱藏中
    let width = 0
    let height = 0
    /**
     * 第 30.6 步:ResizeObserver 第一次回報之前框大小未知(不是「隱藏」)。掛載當幀的 rAF 比 ResizeObserver 早跑,
     * 若照 0 × 0 呼叫 update 會把剛 adopt 的圖當成隱藏丟掉(實測每次再顯示都重畫);量到之前不呼叫。
     */
    let measured = false
    let raf = 0
    let ro: ResizeObserver | null = null
    let mo: MutationObserver | null = null

    const baker = new BgBaker<HTMLImageElement, Baked>({
      load: async (url) => await decoded(url, true),
      render: async (img, i) => {
        // 中間畫布:不加濾鏡畫「底色 + 圖(cover、置中)」= CSS .bgimg 套 filter 之前的樣子(解析度 = 框 × dpr × 1.04)
        const p = bgBakePlan(i, img.naturalWidth, img.naturalHeight)
        const work = document.createElement('canvas')
        work.width = p.width
        work.height = p.height
        const wc = work.getContext('2d')
        const out = document.createElement('canvas')
        out.width = p.width
        out.height = p.height
        const oc = out.getContext('2d')
        if (!wc || !oc) throw new Error('canvas 2d unavailable')
        wc.fillStyle = i.color
        wc.fillRect(0, 0, p.width, p.height)
        wc.imageSmoothingQuality = 'high'
        wc.drawImage(img, p.rect.x, p.rect.y, p.rect.w, p.rect.h)
        // 整張套同一串 filter(框外當透明,邊緣淡出與 CSS 相同)
        oc.filter = p.filter
        oc.drawImage(work, 0, 0)
        work.width = 0
        work.height = 0
        const blob = await new Promise<Blob>((resolve, reject) => out.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'))
        out.width = 0
        out.height = 0
        const url = URL.createObjectURL(blob)
        try {
          return { url, img: await decoded(url, false) }
        } catch (e) {
          URL.revokeObjectURL(url)
          throw e
        }
      },
      show: (b) => {
        const el = imgEl.value
        if (!el) return
        el.style.setProperty('--bg-baked', `url("${b.url}")`)
        el.dataset.baked = '1'
      },
      discard: discardBaked,
      release: (img) => { img.removeAttribute('src') },
      clear: () => {
        const el = imgEl.value
        if (!el) return
        delete el.dataset.baked
        el.style.removeProperty('--bg-baked')
      }
    })

    function input (): BgBakeInput | null {
      const spec = bgBake.value
      const el = imgEl.value
      if (!spec || !el) return null
      // 底色 = CSS .bgimg 的 background-color(--surface-0-c 的計算值;主題切換後自動是新值)
      const color = getComputedStyle(el).getPropertyValue('--surface-0-c').trim() || '#000'
      return { ...spec, width, height, dpr: window.devicePixelRatio || 1, color, layout: layout.value }
    }
    /** CSS 路徑的位置 / 大小(預先模糊時被 .bgimg[data-baked] 的規則蓋過,寫著也無妨);預設 → 移除 = 樣式表的 center / cover */
    function applyCss (): void {
      const el = imgEl.value
      if (!el) return
      const l = layout.value
      const url = bgShownUrl.value
      if (l.fit === 'zoom' && l.zoom !== 100 && url && natural?.url !== url && naturalLoading !== url) {
        naturalLoading = url
        void decoded(url, false).then((img) => {
          if (naturalLoading === url) natural = { url, w: img.naturalWidth, h: img.naturalHeight }
          img.removeAttribute('src')
        }).catch(() => {
          if (naturalLoading === url) natural = { url, w: 0, h: 0 } // 量不到:當 cover(倍率 100),不重試
        }).finally(() => {
          if (naturalLoading === url) naturalLoading = null
          applyCss()
        })
      }
      const css = bgCssLayout(l, natural && natural.url === url ? natural : null, { w: width, h: height })
      if (css) {
        el.style.setProperty('--bg-pos', css.pos)
        el.style.setProperty('--bg-size', css.size)
      } else {
        el.style.removeProperty('--bg-pos')
        el.style.removeProperty('--bg-size')
      }
    }
    function recordSize (): void {
      if (!(width > 0 && height > 0) || props.instance) return
      const dpr = window.devicePixelRatio || 1
      const next = { w: Math.round(width / dpr), h: Math.round(height / dpr) }
      const cur = bgHostSize.value[props.host]
      if (cur?.w !== next.w || cur?.h !== next.h) bgHostSize.value = { ...bgHostSize.value, [props.host]: next }
    }
    function flush (): void {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      baker.update(input())
    }
    function schedule (): void {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (measured) baker.update(input()) })
    }
    // 框大小變動去抖:拖曳中不每幀重畫 PNG(停 200 ms 才畫;顯示 / 隱藏 / 還沒有圖時立即)
    const settle = createResizeSettle(flush)

    watch(bgBake, schedule)
    watch([layout, bgShownUrl], () => { applyCss(); schedule() })
    onMounted(() => {
      const el = imgEl.value
      if (!el) return
      // 第 30.6 步:上次隱藏前畫好的圖 → 第一幀就用它(ResizeObserver 量到大小後鍵相同就不重畫)
      const cached = bgBakeCache.take(props.instance ?? props.host)
      if (cached && !baker.adopt(cached.key, cached.out as Baked)) cached.discard(cached.out)
      ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1]
        const dp = e.devicePixelContentBoxSize?.[0]
        const dpr = window.devicePixelRatio || 1
        const prev = { w: width, h: height }
        measured = true
        width = dp ? dp.inlineSize : Math.round(e.contentRect.width * dpr)
        height = dp ? dp.blockSize : Math.round(e.contentRect.height * dpr)
        settle.resized(prev, { w: width, h: height }, baker.key != null)
        recordSize()
        if (layout.value.fit === 'zoom') applyCss() // 只有縮放的百分比跟框的長寬比有關
      })
      try { ro.observe(el, { box: 'device-pixel-content-box' }) } catch { ro.observe(el) }
      // 主題 / 強調色寫在 <html>(data-theme、style):底色可能變 → 下一幀重算(鍵沒變就不重畫)
      mo = new MutationObserver(schedule)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
      applyCss()
      schedule()
    })
    onBeforeUnmount(() => {
      settle.cancel()
      ro?.disconnect()
      mo?.disconnect()
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      naturalLoading = null
      // 第 30.6 步:背景還開著(只是容器隱藏)→ 畫好的圖留給下次顯示;背景關閉時 bgShownUrl 已是 null,直接丟掉
      const kept = bgShownUrl.value != null ? baker.detach() : null
      if (kept) bgBakeCache.put(props.instance ?? props.host, kept.key, kept.out, b => { discardBaked(b as Baked) })
      baker.dispose()
    })
    return { imgEl }
  }
})
</script>
