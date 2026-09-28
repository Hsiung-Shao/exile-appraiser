import { TranslationDict } from "./data/interfaces";
// exile-appraiser: 上游用 `import(import.meta.env.BASE_URL + 'data/<lang>/client_strings.js')`;改走注入的 DataSource
import { source } from "./data/source";

export async function loadClientStrings(
  lang: string,
): Promise<TranslationDict> {
  // exile-appraiser: DataSource.module() 已回傳 default export
  return (await source().module(`${lang}/client_strings.js`)) as TranslationDict;
}
