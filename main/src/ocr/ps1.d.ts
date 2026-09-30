// exile-appraiser(WP-S):esbuild text loader 匯入的 PowerShell 腳本(見 main/build/script.mjs)。
declare module '*.ps1' {
  const content: string
  export default content
}
