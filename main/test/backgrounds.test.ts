// exile-appraiser(2026-10-01):自訂背景圖的檔名正規化、路徑防穿越(app://bg/ 與預覽 /bg/ 共用)、存檔檔名、預覽伺服器 /bg/ 路由(要 token)。
// 純 Node;不啟動 Electron、不開檔案對話框。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { bgContentType, bgCorsHeaders, bgFileFromPath, normBgFile, resolveBgPath, storedBgName } from '../src/backgrounds'
import { startPreviewServer, type PreviewServer } from '../src/preview-server'

describe('bgCorsHeaders(app://bg/ 回應;效能修正第 10 步)', () => {
  const allowed = ['app://app', 'http://localhost:5173/']
  it('Origin 是 app 自己的頁面 → 回該 origin + Vary: Origin(不是 *)', () => {
    expect(bgCorsHeaders('app://app', allowed)).toEqual({ 'Access-Control-Allow-Origin': 'app://app', Vary: 'Origin' })
    expect(bgCorsHeaders('http://localhost:5173', allowed)).toEqual({ 'Access-Control-Allow-Origin': 'http://localhost:5173', Vary: 'Origin' })
  })
  it('其他 origin / 沒有 Origin / 格式不對 → 不加任何標頭', () => {
    for (const o of [null, undefined, '', 'null', 'https://www.pathofexile.com', 'app://bg', 'app://app.evil', 'http://localhost:5174',
      'http://127.0.0.1:5173', 'app://app/x', '*']) expect(bgCorsHeaders(o, allowed)).toEqual({})
    expect(bgCorsHeaders('app://app', [])).toEqual({})
  })
  it('main.ts 只在 app://bg/ 回應套用(其他路由沒有)', () => {
    const main = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8')
    expect(main.match(/bgCorsHeaders\(/g)).toHaveLength(1)
    expect(main).toMatch(/if \(url\.host === 'bg'\) \{[\s\S]{0,600}?bgCorsHeaders\(request\.headers\.get\('origin'\), APP_ORIGINS\)[\s\S]{0,200}?\n {4}\}/)
    expect(main).not.toMatch(/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/)
  })
})

describe('normBgFile:只准 png / jpg / jpeg / webp、只有檔名', () => {
  it('合法', () => {
    for (const f of ['a.png', 'My Wallpaper-1a2b3c4d.JPG', '風景.jpeg', 'x.webp', '背景 (1).png']) expect(normBgFile(f)).toBe(f)
  })
  it('不合法 → 空字串', () => {
    for (const f of [
      '', 'a.gif', 'a.mp4', 'a.svg', 'a.png.exe', '.hidden.png', '../a.png', '..\\a.png', 'dir/a.png', 'dir\\a.png',
      'C:\\x\\a.png', 'C:a.png', 'a..png', 'a\u0000.png', 'a?.png', 'a*.png', 'a"b.png', 'a<b>.png', 'a|b.png',
      'x'.repeat(201) + '.png', 123, null, undefined, { f: 'a.png' }
    ]) expect(normBgFile(f)).toBe('')
  })
})

describe('resolveBgPath:解析後必須正好在 backgrounds 資料夾裡', () => {
  const dir = path.resolve(os.tmpdir(), 'ea-bg-test', 'backgrounds')
  it('合法檔名 → 資料夾內的絕對路徑', () => {
    expect(resolveBgPath(dir, 'a.png')).toBe(path.join(dir, 'a.png'))
    expect(resolveBgPath(dir + path.sep, 'a.png')).toBe(path.join(dir, 'a.png'))
  })
  it('穿越 / 絕對路徑 / 子資料夾 / 非圖片 → null', () => {
    for (const f of ['../a.png', '..\\a.png', '/etc/a.png', 'C:\\Windows\\a.png', 'sub/a.png', '..', '.', 'a.txt', 'config.json', '']) {
      expect(resolveBgPath(dir, f)).toBeNull()
    }
  })
})

describe('bgFileFromPath(app://bg/<檔名> 的 pathname)', () => {
  it('解碼單一段;多段 / 空 / 壞編碼 → null', () => {
    expect(bgFileFromPath('/a.png')).toBe('a.png')
    expect(bgFileFromPath('/%E9%A2%A8%E6%99%AF.png')).toBe('風景.png')
    expect(bgFileFromPath('/a%20b.png')).toBe('a b.png')
    expect(bgFileFromPath('/sub/a.png')).toBeNull()
    expect(bgFileFromPath('/')).toBeNull()
    expect(bgFileFromPath('/%E0%A4%A.png')).toBeNull()
  })
  it('編碼過的穿越解碼後由 resolveBgPath 擋掉', () => {
    const dir = path.resolve(os.tmpdir(), 'bgdir')
    for (const p of ['/..%2Fconfig.png', '/..%5Cconfig.png', '/%2E%2E%2Fa.png', '/C%3A%5Ca.png']) {
      const name = bgFileFromPath(p)
      expect(name == null || resolveBgPath(dir, name) == null).toBe(true)
    }
  })
  it('Content-Type', () => {
    expect(bgContentType('a.PNG')).toBe('image/png')
    expect(bgContentType('a.webp')).toBe('image/webp')
    expect(bgContentType('a.jpg')).toBe('image/jpeg')
    expect(bgContentType('a.jpeg')).toBe('image/jpeg')
  })
})

describe('storedBgName:複製進資料夾的檔名', () => {
  const data = new Uint8Array([1, 2, 3])
  it('原檔名清理 + 內容雜湊 8 碼 + 小寫副檔名;同內容同名', () => {
    const a = storedBgName('C:\\Users\\me\\Pictures\\My Wall.PNG', data)!
    expect(a).toMatch(/^My Wall-[0-9a-f]{8}\.png$/)
    expect(storedBgName('D:\\other\\My Wall.PNG', data)).toBe(a)
    expect(normBgFile(a)).toBe(a)
  })
  it('不允許的副檔名 → null;奇怪的原檔名也產生合法檔名', () => {
    expect(storedBgName('a.gif', data)).toBeNull()
    expect(storedBgName('a.png.exe', data)).toBeNull()
    for (const src of ['/tmp/...png', '/tmp/.hidden.jpg', '/tmp/a..b.webp', '/tmp/ .png']) {
      const n = storedBgName(src, data)!
      expect(n).not.toBeNull()
      expect(normBgFile(n)).toBe(n)
    }
  })
})

describe('預覽伺服器 /bg/ 路由(token 保護、同一套防穿越)', () => {
  let tmp: string
  let root: string
  let bgDir: string
  let srv: PreviewServer
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-bg-'))
    root = path.join(tmp, 'dist')
    bgDir = path.join(tmp, 'backgrounds')
    fs.mkdirSync(root)
    fs.mkdirSync(bgDir)
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head><body></body></html>')
    fs.writeFileSync(path.join(bgDir, '風景-1a2b3c4d.png'), PNG)
    fs.writeFileSync(path.join(bgDir, 'notes.txt'), 'x')
    fs.writeFileSync(path.join(tmp, 'secret.png'), 'secret')
    srv = await startPreviewServer({ staticRoot: root, bgDir, version: 't', idleCheckMs: 0, handlers: {} })
  })
  afterAll(async () => {
    await srv.close('test end')
    fs.rmSync(tmp, { recursive: true, force: true })
  })
  const get = (p: string): Promise<{ status: number, type?: string, body: Buffer }> => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: p, headers: { Host: `127.0.0.1:${srv.port}` } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })

  it('帶 token:回圖檔與正確 Content-Type', async () => {
    const r = await get(`${srv.prefix}bg/${encodeURIComponent('風景-1a2b3c4d.png')}`)
    expect(r.status).toBe(200)
    expect(r.type).toBe('image/png')
    expect(r.body.equals(PNG)).toBe(true)
  })
  it('沒有 / 錯的 token → 404', async () => {
    expect((await get(`/bg/${encodeURIComponent('風景-1a2b3c4d.png')}`)).status).toBe(404)
    expect((await get(`/t/${'0'.repeat(32)}/bg/${encodeURIComponent('風景-1a2b3c4d.png')}`)).status).toBe(404)
  })
  it('非圖片 / 不存在 / 穿越 → 404,不會讀到資料夾外的檔', async () => {
    for (const p of ['bg/notes.txt', 'bg/none.png', 'bg/..%2Fsecret.png', 'bg/..%5Csecret.png', 'bg/%2E%2E%2Fsecret.png', 'bg/sub/x.png', 'bg/']) {
      const r = await get(srv.prefix + p)
      expect(r.status, p).toBe(404)
      expect(r.body.toString()).not.toContain('secret')
    }
  })
  it('沒給 bgDir 的伺服器沒有這條路由', async () => {
    const s2 = await startPreviewServer({ staticRoot: root, version: 't', idleCheckMs: 0, handlers: {} })
    try {
      const r = await new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: s2.port, path: `${s2.prefix}bg/${encodeURIComponent('風景-1a2b3c4d.png')}`, headers: { Host: `127.0.0.1:${s2.port}` } },
          (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) })
        req.on('error', reject)
        req.end()
      })
      expect(r).toBe(404)
    } finally {
      await s2.close('test end')
    }
  })
})
