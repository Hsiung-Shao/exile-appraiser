// 建置 main process 與 preload(esbuild)。`--prod` 只建一次;否則 watch 並自動重啟 Electron。
import child_process from 'node:child_process'
import electron from 'electron'
import esbuild from 'esbuild'

const isDev = !process.argv.includes('--prod')
// 其餘參數轉給 Electron(例:`npm run dev:main -- --window` 用備援視窗模式)
const electronArgs = process.argv.slice(2).filter(a => a !== '--prod')

// ⚠ 編輯器(VSCode / Cursor)會把 ELECTRON_RUN_AS_NODE=1 傳給子行程,Electron 會被當成純 Node 跑,
//   `require('electron')` 回字串、app 是 undefined、視窗永遠不出現。啟動前一律移除。
//   (agent-data error_electron_run_as_node_inherited)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronRunner = (() => {
  let handle = null
  return {
    restart () {
      if (handle) handle.kill()
      handle = child_process.spawn(electron, ['.', ...electronArgs], { stdio: 'inherit', env })
    }
  }
})()

const common = {
  bundle: true,
  minify: !isDev,
  platform: 'node',
  target: 'node20',
  external: ['electron', 'uiohook-napi', 'electron-overlay-window'],
  define: {
    'process.env.VITE_DEV_SERVER_URL': isDev ? '"http://localhost:5173"' : 'null'
  }
}

const preload = await esbuild.context({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js', format: 'cjs' })
const main = await esbuild.context({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  format: 'cjs',
  plugins: isDev
    ? [{
        name: 'electron-runner',
        setup (build) {
          build.onEnd((result) => { if (!result.errors.length) electronRunner.restart() })
        }
      }]
    : []
})

if (isDev) {
  await preload.watch()
  await main.watch()
} else {
  await preload.rebuild(); preload.dispose()
  await main.rebuild(); main.dispose()
}
