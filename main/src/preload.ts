import { contextBridge, ipcRenderer } from 'electron'
import type { HostApi, HostFetchInit, HostConfigForMain, ItemTextEvent, FocusChangeEvent, TrackAreaOpts, WindowMode, GameId, UpdaterInfo, SettingsTabId } from '@ipc/types'

function subscribe<T> (channel: string, cb: (e: T) => void): () => void {
  const listener = (_: unknown, e: T) => cb(e)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

const api: HostApi = {
  isElectron: true,
  version: process.env.npm_package_version ?? ipcRenderer.sendSync('app-version') as string,
  windowMode: ipcRenderer.sendSync('window-mode') as WindowMode,
  fetch: (url: string, init?: HostFetchInit) => ipcRenderer.invoke('http-fetch', url, init),
  loadConfig: () => ipcRenderer.invoke('config-load'),
  saveConfig: (contents: string) => ipcRenderer.invoke('config-save', contents),
  regexStateLoad: () => ipcRenderer.invoke('regex-state-load'),
  regexStateSave: (contents: string) => ipcRenderer.invoke('regex-state-save', contents),
  updateHostConfig: (cfg: HostConfigForMain) => ipcRenderer.invoke('host-config', cfg),
  onItemText: (cb: (e: ItemTextEvent) => void) => subscribe('item-text', cb),
  onFocusChange: (cb: (e: FocusChangeEvent) => void) => subscribe('focus-change', cb),
  onVisibility: (cb: (e: { isVisible: boolean }) => void) => subscribe('visibility', cb),
  onHideWidget: (cb: () => void) => subscribe('hide-exclusive-widget', () => cb()),
  onSwitchGame: (cb: (game: GameId) => void) => subscribe('switch-game', cb),
  onOpenSettings: (cb: (e: { tab: SettingsTabId }) => void) => subscribe('open-settings', cb),
  trackArea: (opts: TrackAreaOpts) => { ipcRenderer.send('track-area', opts) },
  focusGame: () => { ipcRenderer.send('focus-game') },
  usedRecently: (isOverlay: boolean) => { ipcRenderer.send('used-recently', isOverlay) },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openCaptcha: (url: string) => ipcRenderer.invoke('open-captcha', url),
  hideWindow: () => ipcRenderer.invoke('window-hide'),
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke('window-resize', width, height),
  getUpdaterInfo: () => ipcRenderer.invoke('updater-info'),
  checkForUpdate: () => ipcRenderer.invoke('updater-check'),
  downloadUpdate: () => ipcRenderer.invoke('updater-download'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterState: (cb: (info: UpdaterInfo) => void) => subscribe('updater-state', cb)
}

contextBridge.exposeInMainWorld('host', api)
