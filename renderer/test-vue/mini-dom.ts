/**
 * 掛載測試用的最小 DOM 渲染器(沒有 jsdom / @vue/test-utils,也不為了測試多裝相依):
 * runtime-core `createRenderer` + 物件樹 nodeOps。走的是用戶端掛載流程(watch immediate、errorCaptured 後重畫、nextTick),
 * 不是 SSR —— 元件出錯時 ErrorBoundary 換成錯誤框這件事只有用戶端流程看得到。
 * 只支援測試要讀的東西:標籤、屬性、文字;`text()` / `find()` 讀結果。
 */
import { createRenderer, type Component, type App } from 'vue'

export interface MiniNode {
  tag: string // '#text' / '#comment' / 元素標籤
  text: string
  attrs: Record<string, unknown>
  children: MiniNode[]
  parent: MiniNode | null
  /** 元件直接改 inline 樣式 / dataset 時用(背景圖層 BgLayerImage.vue 的 --bg-pos / --bg-baked;第 30.6 步) */
  style: { props: Record<string, string>, setProperty: (k: string, v: string) => void, removeProperty: (k: string) => void }
  dataset: Record<string, string>
}

function node (tag: string, text = ''): MiniNode {
  const props: Record<string, string> = {}
  const style = { props, setProperty: (k: string, v: string) => { props[k] = v }, removeProperty: (k: string) => { delete props[k] } }
  return { tag, text, attrs: {}, children: [], parent: null, style, dataset: {} }
}

function detach (child: MiniNode) {
  const p = child.parent
  if (!p) return
  const i = p.children.indexOf(child)
  if (i >= 0) p.children.splice(i, 1)
  child.parent = null
}

const { createApp: createMiniApp } = createRenderer<MiniNode, MiniNode>({
  createElement: (tag) => node(tag),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (n, text) => { n.text = text },
  setElementText: (el, text) => {
    for (const c of el.children) c.parent = null
    el.children = []
    if (text) { const t = node('#text', text); t.parent = el; el.children.push(t) }
  },
  insert: (child, parent, anchor) => {
    detach(child)
    const i = anchor ? parent.children.indexOf(anchor) : -1
    if (i >= 0) parent.children.splice(i, 0, child)
    else parent.children.push(child)
    child.parent = parent
  },
  remove: detach,
  parentNode: (n) => n.parent,
  nextSibling: (n) => {
    const p = n.parent
    if (!p) return null
    return p.children[p.children.indexOf(n) + 1] ?? null
  },
  patchProp: (el, key, _prev, next) => {
    if (/^on[A-Z]/.test(key)) { el.attrs[key] = next; return }
    if (next == null || next === false) delete el.attrs[key]
    else el.attrs[key] = next
  },
  querySelector: () => null,
  setScopeId: (el, id) => { el.attrs[id] = '' },
  insertStaticContent: () => { throw new Error('mini-dom: 不支援 static content') }
})

export function mount (root: Component, plugins: Array<{ install: (app: App) => void }> = [], configure?: (app: App) => void) {
  const container = node('#root')
  const app = createMiniApp(root)
  configure?.(app)
  for (const p of plugins) app.use(p)
  app.mount(container)
  return { app, container }
}

export function text (n: MiniNode): string {
  if (n.tag === '#text') return n.text
  if (n.tag === '#comment') return ''
  return n.children.map(text).join(n.tag === '#root' ? '' : ' ').replace(/\s+/g, ' ').trim()
}

export function findAll (n: MiniNode, pred: (n: MiniNode) => boolean, out: MiniNode[] = []): MiniNode[] {
  if (pred(n)) out.push(n)
  for (const c of n.children) findAll(c, pred, out)
  return out
}

export const byAttr = (name: string, value?: string) => (n: MiniNode) =>
  name in n.attrs && (value === undefined || n.attrs[name] === value)

export const byClass = (cls: string) => (n: MiniNode) =>
  typeof n.attrs.class === 'string' && n.attrs.class.split(/\s+/).includes(cls)
