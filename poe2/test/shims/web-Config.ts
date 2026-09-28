// exile-appraiser: 移植來的測試只拿上游 `@/web/Config` 的 `Config` 型別(例如 `Config["language"]`);
// src 端已不依賴 @/web/Config,所以只在測試的 tsconfig paths / vitest alias 把它指到這裡。
import type { TestConfigOverrides } from "../vitest.setup";

export type Config = Required<TestConfigOverrides>;
