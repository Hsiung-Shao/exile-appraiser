// 瀏覽器預覽伺服器(main/src/preview-server.ts)的路由 / 安全檢查 / RPC / SSE / 自動關閉。
// 純 Node(不需要 Electron):handlers 與靜態根目錄注入;時鐘用注入的假時間(`now`),不等真的 20 秒。
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  startPreviewServer, bootScript, injectBootScript, resolveStatic,
  HOST_METHOD_CHANNELS, HOST_EVENT_METHODS,
  type PreviewServer, type PreviewServerOptions
} from '../src/preview-server'

let root: string
const servers: PreviewServer[] = []

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-root-'))
  fs.writeFileSync(path.join(root, 'index.html'),
    '<!DOCTYPE html><html><head><title>x</title></head><body><div id="app"></div><script>var boot=1</script><script type="module" src="./assets/app.js"></script></body></html>')
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("app")')
  // 根目錄外的檔(防穿越測試)
  fs.writeFileSync(path.join(path.dirname(root), path.basename(root) + '-secret.txt'), 'secret')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(path.join(path.dirname(root), path.basename(root) + '-secret.txt'), { force: true })
})

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close('test end')
})

async function start (extra: Partial<PreviewServerOptions> = {}): Promise<PreviewServer> {
  const srv = await startPreviewServer({
    staticRoot: root,
    version: '3.29.0-test',
    idleCheckMs: 0,
    handlers: {
      'config-load': () => '{"theme":"slate"}',
      'http-fetch': (_ctx, url: string, init?: { method?: string }) => ({ status: 200, url, method: init?.method ?? 'GET' }),
      'config-save': async (ctx, contents: string) => { srvRef.push('config-changed', { contents, source: `preview:${ctx.clientId}` }) },
      'updater-check': () => { throw new Error('boom') }
    },
    ...extra
  })
  const srvRef = srv
  servers.push(srv)
  return srv
}

interface Resp { status: number, headers: http.IncomingHttpHeaders, body: string }

function request (srv: PreviewServer, opts: { path: string, method?: string, host?: string, origin?: string, body?: string }): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = { Host: opts.host ?? `127.0.0.1:${srv.port}` }
    if (opts.origin) headers.Origin = opts.origin
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: opts.path, method: opts.method ?? 'GET', headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

/** 開一條 SSE,收集 `{id, data}`;`waitFor` 等到符合條件的訊息。 */
function openEvents (srv: PreviewServer, cid: string, lastEventId?: number) {
  const messages: Array<{ id: number, data: any }> = []
  const waiters: Array<{ pred: (m: { id: number, data: any }) => boolean, resolve: (m: { id: number, data: any }) => void }> = []
  let buf = ''
  let res: http.IncomingMessage | null = null
  const headers: http.OutgoingHttpHeaders = { Host: `127.0.0.1:${srv.port}`, Accept: 'text/event-stream' }
  if (lastEventId !== undefined) headers['Last-Event-ID'] = String(lastEventId)
  const opened = new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: `${srv.prefix}~events?cid=${cid}`, headers }, (r) => {
      res = r
      r.setEncoding('utf8')
      r.on('data', (c: string) => {
        buf += c
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const id = /^id: (\d+)$/m.exec(block)
          const data = /^data: (.*)$/m.exec(block)
          if (!id || !data) continue
          const m = { id: Number(id[1]), data: JSON.parse(data[1]) }
          messages.push(m)
          for (const w of waiters.splice(0)) {
            if (w.pred(m)) w.resolve(m)
            else waiters.push(w)
          }
        }
      })
      r.on('error', () => {})
      resolve(r.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
  return {
    opened,
    messages,
    waitFor (pred: (m: { id: number, data: any }) => boolean, ms = 3000) {
      const hit = messages.find(pred)
      if (hit) return Promise.resolve(hit)
      return new Promise<{ id: number, data: any }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for SSE message')), ms)
        waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m) } })
      })
    },
    close () { res?.destroy() }
  }
}

const rpc = (srv: PreviewServer, body: unknown) =>
  request(srv, { path: `${srv.prefix}~rpc`, method: 'POST', body: JSON.stringify(body) })

const waitUntil = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitUntil timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('preview-server 路由與安全', () => {
  it('網址是 127.0.0.1 + 32 hex token 前綴', async () => {
    const srv = await start()
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/t\/[0-9a-f]{32}\/$/)
    expect(srv.token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('token 錯 → 404;沒有前綴 → 404', async () => {
    const srv = await start()
    const wrong = srv.prefix.replace(srv.token, 'f'.repeat(32) === srv.token ? 'e'.repeat(32) : 'f'.repeat(32))
    expect((await request(srv, { path: wrong })).status).toBe(404)
    expect((await request(srv, { path: `${wrong}~rpc`, method: 'POST', body: '{}' })).status).toBe(404)
    expect((await request(srv, { path: '/' })).status).toBe(404)
    expect((await request(srv, { path: '/index.html' })).status).toBe(404)
  })

  it('Host 標頭不是 127.0.0.1:<port> → 421(DNS rebinding)', async () => {
    const srv = await start()
    expect((await request(srv, { path: srv.prefix, host: 'evil.example' })).status).toBe(421)
    expect((await request(srv, { path: srv.prefix, host: `localhost:${srv.port}` })).status).toBe(421)
    expect((await request(srv, { path: srv.prefix, host: `evil.example:${srv.port}` })).status).toBe(421)
    expect((await request(srv, { path: srv.prefix })).status).toBe(200)
  })

  it('別的 Origin 發 POST → 403', async () => {
    const srv = await start()
    const r = await request(srv, { path: `${srv.prefix}~rpc`, method: 'POST', origin: 'https://evil.example', body: '{}' })
    expect(r.status).toBe(403)
  })

  it('沒有結尾斜線 → 308 導到前綴', async () => {
    const srv = await start()
    const r = await request(srv, { path: srv.prefix.slice(0, -1) })
    expect(r.status).toBe(308)
    expect(r.headers.location).toBe(srv.prefix)
  })

  it('index.html 在第一個 <script 前注入 boot script(烤入 isPreview / version / 前綴)', async () => {
    const srv = await start()
    const r = await request(srv, { path: srv.prefix })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/text\/html/)
    expect(r.headers['cache-control']).toBe('no-store')
    const firstScript = r.body.indexOf('<script')
    expect(r.body.slice(firstScript)).toMatch(/^<script>\(function\(\)\{var C=/)
    expect(r.body.indexOf('var boot=1')).toBeGreaterThan(firstScript)
    expect(r.body).toContain('isPreview:true')
    expect(r.body).toContain('"V":"3.29.0-test"')
    expect(r.body).toContain(`"P":"${srv.prefix}"`)
  })

  it('靜態檔:子目錄可讀、越界 → 403、不存在 → 404', async () => {
    const srv = await start()
    const js = await request(srv, { path: `${srv.prefix}assets/app.js` })
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toMatch(/text\/javascript/)
    expect(js.body).toBe('console.log("app")')
    const secret = `${srv.prefix}..%2F..%2F${path.basename(root)}-secret.txt`
    const r = await request(srv, { path: secret })
    expect([403, 404]).toContain(r.status)
    expect(r.body).not.toBe('secret')
    expect((await request(srv, { path: `${srv.prefix}nope.js` })).status).toBe(404)
  })

  it('resolveStatic 擋穿越(與 app:// 同規則)', () => {
    expect(resolveStatic(root, '/')).toBe(path.join(root, 'index.html'))
    expect(resolveStatic(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'))
    expect(resolveStatic(root, '/../x')).toBe(null)
    expect(resolveStatic(root, '/%2e%2e/%2e%2e/x')).toBe(null)
    expect(resolveStatic(root, '/a%00b')).toBe(null)
    expect(resolveStatic(root, '/%E0%A4%A')).toBe(null)
  })
})

describe('preview-server RPC 與 SSE', () => {
  it('RPC 往返:202 後結果從 SSE 回給發起的 cid;null 參數轉回 undefined', async () => {
    const srv = await start()
    const ev = openEvents(srv, 'clientA')
    expect(await ev.opened).toBe(200)
    const r = await rpc(srv, { id: 'clientA:1', cid: 'clientA', method: 'fetch', args: ['https://www.pathofexile.com/api/leagues', null] })
    expect(r.status).toBe(202)
    const m = await ev.waitFor(x => x.data.id === 'clientA:1')
    expect(m.data.result).toEqual({ status: 200, url: 'https://www.pathofexile.com/api/leagues', method: 'GET' })
    ev.close()
  })

  it('RPC 錯誤:handler 丟例外 → {error:{message}};未知方法 → error;格式錯 → 400', async () => {
    const srv = await start()
    const ev = openEvents(srv, 'c1')
    await ev.opened
    await rpc(srv, { id: 1, cid: 'c1', method: 'checkForUpdate', args: [] })
    await rpc(srv, { id: 2, cid: 'c1', method: 'hideWindow', args: [] })
    await rpc(srv, { id: 3, cid: 'c1', method: '__proto__', args: [] })
    expect((await ev.waitFor(x => x.data.id === 1)).data.error.message).toBe('boom')
    expect((await ev.waitFor(x => x.data.id === 2)).data.error.message).toMatch(/unknown method/)
    expect((await ev.waitFor(x => x.data.id === 3)).data.error.message).toMatch(/unknown method/)
    expect((await rpc(srv, { id: 4, cid: 'bad cid!', method: 'loadConfig' })).status).toBe(400)
    expect((await request(srv, { path: `${srv.prefix}~rpc`, method: 'POST', body: 'not json' })).status).toBe(400)
    expect((await request(srv, { path: `${srv.prefix}~rpc` })).status).toBe(405)
    ev.close()
  })

  it('回覆只送給發起的 cid;事件廣播給所有連線', async () => {
    const srv = await start()
    const a = openEvents(srv, 'aaa')
    const b = openEvents(srv, 'bbb')
    await Promise.all([a.opened, b.opened])
    await waitUntil(() => srv.streamCount === 2)
    await rpc(srv, { id: 'aaa:1', cid: 'aaa', method: 'loadConfig', args: [] })
    await a.waitFor(x => x.data.id === 'aaa:1')
    srv.push('updater-state', { state: 'checking' })
    await a.waitFor(x => x.data.event === 'updater-state')
    await b.waitFor(x => x.data.event === 'updater-state')
    expect(b.messages.some(x => x.data.id === 'aaa:1')).toBe(false)
    a.close(); b.close()
  })

  it('RPC 比 SSE 先到:新連線會補上給自己的回覆,但不重播連線前的廣播', async () => {
    const srv = await start()
    srv.push('updater-state', { state: 'old' })
    await rpc(srv, { id: 'early:1', cid: 'early', method: 'loadConfig', args: [] })
    await new Promise(r => setTimeout(r, 30))
    const ev = openEvents(srv, 'early')
    await ev.opened
    const m = await ev.waitFor(x => x.data.id === 'early:1')
    expect(m.data.result).toBe('{"theme":"slate"}')
    expect(ev.messages.some(x => x.data.event === 'updater-state')).toBe(false)
    ev.close()
  })

  it('Last-Event-ID 續傳:斷線期間的事件在重連後補上,且不重送已收過的', async () => {
    const srv = await start()
    const first = openEvents(srv, 'resume')
    await first.opened
    srv.push('config-changed', { contents: 'v1', source: 'electron' })
    const got = await first.waitFor(x => x.data.event === 'config-changed')
    first.close()
    await waitUntil(() => srv.streamCount === 0)
    srv.push('config-changed', { contents: 'v2', source: 'electron' })
    srv.push('config-changed', { contents: 'v3', source: 'electron' })
    const second = openEvents(srv, 'resume', got.id)
    await second.opened
    await second.waitFor(x => x.data.data?.contents === 'v3')
    const contents = second.messages.map(x => x.data.data?.contents)
    expect(contents).toEqual(['v2', 'v3'])
    expect(second.messages[0].id).toBe(got.id + 1)
    second.close()
  })

  it('config-save 經 RPC → 廣播 config-changed(帶 source)', async () => {
    const srv = await start()
    const ev = openEvents(srv, 'saver')
    await ev.opened
    await rpc(srv, { id: 's1', cid: 'saver', method: 'saveConfig', args: ['{"theme":"light"}'] })
    const m = await ev.waitFor(x => x.data.event === 'config-changed')
    expect(m.data.data).toEqual({ contents: '{"theme":"light"}', source: 'preview:saver' })
    await ev.waitFor(x => x.data.id === 's1')
    ev.close()
  })

  it('~events 缺 cid → 400', async () => {
    const srv = await start()
    expect((await request(srv, { path: `${srv.prefix}~events` })).status).toBe(400)
  })
})

describe('preview-server 自動關閉(假時鐘)', () => {
  it('曾連線後 20 秒沒有 SSE 連線 → 關閉並呼叫 onClose', async () => {
    let t = 1_000_000
    const closedWith: string[] = []
    const logs: string[] = []
    const srv = await start({ now: () => t, onClose: (r) => closedWith.push(r), log: (m) => logs.push(m) })
    const ev = openEvents(srv, 'tab')
    await ev.opened
    await waitUntil(() => srv.streamCount === 1)
    t += 60_000
    expect(srv.checkIdle()).toBe(false) // 有連線就不關,多久都一樣
    ev.close()
    await waitUntil(() => srv.streamCount === 0)
    t += 19_999
    expect(srv.checkIdle()).toBe(false)
    t += 1
    expect(srv.checkIdle()).toBe(true)
    await waitUntil(() => closedWith.length === 1)
    expect(srv.closed).toBe(true)
    expect(closedWith[0]).toMatch(/20 秒沒有瀏覽器連線/)
    expect(logs.some(l => l.includes('伺服器已關閉'))).toBe(true)
    await expect(request(srv, { path: srv.prefix })).rejects.toThrow()
  })

  it('20 秒內重連就不關', async () => {
    let t = 0
    const srv = await start({ now: () => t })
    const a = openEvents(srv, 'tab')
    await a.opened
    a.close()
    await waitUntil(() => srv.streamCount === 0)
    t += 15_000
    const b = openEvents(srv, 'tab')
    await b.opened
    await waitUntil(() => srv.streamCount === 1)
    t += 15_000
    expect(srv.checkIdle()).toBe(false)
    b.close()
  })

  it('啟動後 180 秒都沒人連 → 關閉', async () => {
    let t = 0
    const closedWith: string[] = []
    const srv = await start({ now: () => t, onClose: (r) => closedWith.push(r) })
    t += 179_999
    expect(srv.checkIdle()).toBe(false)
    t += 1
    expect(srv.checkIdle()).toBe(true)
    await waitUntil(() => closedWith.length === 1)
    expect(closedWith[0]).toMatch(/180 秒/)
  })
})

describe('boot script', () => {
  it('方法表涵蓋所有 RPC 方法與事件;可以被解析成 JS', () => {
    const s = bootScript({ prefix: '/t/' + 'a'.repeat(32) + '/', version: '1.0.0' })
    // 語法檢查(不執行)
    expect(() => new Function(s)).not.toThrow() // eslint-disable-line no-new-func
    for (const m of Object.keys(HOST_METHOD_CHANNELS)) expect(s).toContain(`"${m}"`)
    for (const m of Object.keys(HOST_EVENT_METHODS)) expect(s).toContain(`"${m}"`)
    expect(s).not.toContain('</script')
  })

  it('shim 行為:RPC 呼叫、事件分派、自己存的 config-changed 略過、onOpenSettings 自動開一般分頁', async () => {
    const prefix = '/t/' + 'b'.repeat(32) + '/'
    const posted: any[] = []
    let es: any = null
    const win: any = {}
    const fakeFetch = async (_url: string, init: { body: string }) => { posted.push(JSON.parse(init.body)); return { status: 202 } }
    class FakeEventSource { onmessage: any; onopen: any; onerror: any; constructor (public url: string) { es = this } }
    const run = new Function('window', 'fetch', 'EventSource', 'location', 'navigator', 'document', 'setTimeout', 'clearTimeout', 'CustomEvent',
      bootScript({ prefix, version: '9.9.9' }))
    run(win, fakeFetch, FakeEventSource, { hash: '#tab=regex' }, { language: 'en' }, {}, setTimeout, clearTimeout, class {})
    const host = win.host
    expect(host.isPreview).toBe(true)
    expect(host.isElectron).toBe(true)
    expect(host.windowMode).toBe('window')
    expect(host.version).toBe('9.9.9')
    expect(es.url).toBe(`${prefix}~events?cid=${host.previewClientId}`)
    // no-op
    await expect(host.resizeWindow(1, 2)).resolves.toBeUndefined()
    expect(host.focusGame()).toBeUndefined()
    // RPC
    const p = host.loadConfig()
    await new Promise(r => setTimeout(r, 0))
    expect(posted[0]).toMatchObject({ cid: host.previewClientId, method: 'loadConfig', args: [] })
    es.onmessage({ data: JSON.stringify({ id: posted[0].id, result: 'cfg' }) })
    await expect(p).resolves.toBe('cfg')
    const p2 = host.checkForUpdate()
    await new Promise(r => setTimeout(r, 0))
    es.onmessage({ data: JSON.stringify({ id: posted[1].id, error: { message: 'nope' } }) })
    await expect(p2).rejects.toThrow('nope')
    // 事件
    const seen: any[] = []
    const off = host.onConfigChanged((e: any) => seen.push(e))
    es.onmessage({ data: JSON.stringify({ event: 'config-changed', data: { contents: 'x', source: 'electron' } }) })
    es.onmessage({ data: JSON.stringify({ event: 'config-changed', data: { contents: 'y', source: 'preview:' + host.previewClientId } }) })
    off()
    es.onmessage({ data: JSON.stringify({ event: 'config-changed', data: { contents: 'z', source: 'electron' } }) })
    expect(seen.map(e => e.contents)).toEqual(['x'])
    // 開設定頁
    const tabs: string[] = []
    host.onOpenSettings((e: any) => tabs.push(e.tab))
    await new Promise(r => setTimeout(r, 5))
    expect(tabs).toEqual(['regex'])
  })

  it('injectBootScript:沒有 <script 時插在 </head> 前', () => {
    expect(injectBootScript('<html><head></head><body></body></html>', 'X')).toBe('<html><head><script>X</script></head><body></body></html>')
    expect(injectBootScript('<p>no head</p>', 'X')).toBe('<script>X</script><p>no head</p>')
  })
})
