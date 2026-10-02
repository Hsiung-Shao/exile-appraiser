<!--
  exile-appraiser(2026-10-01):自訂背景圖層。放在 `.bg-host` 容器(查價面板 #price-window、設定視窗)的第一個子元素;
  沒有背景(<html> 沒有 data-bg)時 display: none。樣式在 theme/pobtools.css(.bgimg 圖 + 亮度 / 霧面、.bgtint 面板底色 × 面板不透明度),
  兩層都是 position: absolute; inset: 0; z-index: -1,容器以 isolation: isolate 自成堆疊,所以只畫在容器裡、內容永遠在圖上面;
  overlay 的其他區域(透明全螢幕視窗)不受影響。
  效能修正第 10 步(2026-10-01):霧面 > 0 時不再用 CSS filter 即時模糊,改由 ../bg-bake.ts 在設定 / 大小 / dpr / 主題底色變了時
  用 canvas 照同一串 filter 畫一次、輸出 PNG blob URL,寫進 .bgimg 的 `--bg-baked` + `data-baked`(pobtools.css 拿掉即時的背景與 filter,
  改用這張圖;scale(1.04) 照舊)。霧面 0、圖還沒好、載入或繪製失敗時就是原本的 CSS 呈現。
  code review 第 B 批:框大小變動(拖曳設定視窗)停止約 200 ms 後才重畫(`createResizeSettle`),期間沿用舊圖(拉伸);
  顯示 / 隱藏、第一張圖、主題 / 霧面 / 圖片變更維持立即。
-->
<template>
  <div ref="imgEl" class="bgimg" aria-hidden="true" data-bg-layer="image" />
  <div class="bgtint" aria-hidden="true" data-bg-layer="tint" />
</template>

<script lang="ts">
import { defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BgBaker, bgBakePlan, createResizeSettle, type BgBakeInput } from '../bg-bake'
import { bgBake } from '../useTheme'

/** 畫好的圖:blob URL + 已解碼的 Image(留著參照,換上時不必再解碼、不閃爍) */
interface Baked { url: string, img: HTMLImageElement }

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
  setup () {
    const imgEl = ref<HTMLElement | null>(null)
    // .bgimg 的框(裝置像素,transform 之前);0 = 隱藏中
    let width = 0
    let height = 0
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
      discard: (b) => {
        URL.revokeObjectURL(b.url)
        b.img.removeAttribute('src')
      },
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
      return { ...spec, width, height, dpr: window.devicePixelRatio || 1, color }
    }
    function flush (): void {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      baker.update(input())
    }
    function schedule (): void {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; baker.update(input()) })
    }
    // 框大小變動去抖:拖曳中不每幀重畫 PNG(停 200 ms 才畫;顯示 / 隱藏 / 還沒有圖時立即)
    const settle = createResizeSettle(flush)

    watch(bgBake, schedule)
    onMounted(() => {
      const el = imgEl.value
      if (!el) return
      ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1]
        const dp = e.devicePixelContentBoxSize?.[0]
        const dpr = window.devicePixelRatio || 1
        const prev = { w: width, h: height }
        width = dp ? dp.inlineSize : Math.round(e.contentRect.width * dpr)
        height = dp ? dp.blockSize : Math.round(e.contentRect.height * dpr)
        settle.resized(prev, { w: width, h: height }, baker.key != null)
      })
      try { ro.observe(el, { box: 'device-pixel-content-box' }) } catch { ro.observe(el) }
      // 主題 / 強調色寫在 <html>(data-theme、style):底色可能變 → 下一幀重算(鍵沒變就不重畫)
      mo = new MutationObserver(schedule)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
      schedule()
    })
    onBeforeUnmount(() => {
      settle.cancel()
      ro?.disconnect()
      mo?.disconnect()
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      baker.dispose()
    })
    return { imgEl }
  }
})
</script>
