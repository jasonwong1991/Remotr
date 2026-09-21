/** 构建期由 build.mjs 从 package.json 注入；vitest 等未注入场景回退为 'dev' */
declare const __SDK_VERSION__: string | undefined;

export const SDK_VERSION: string =
  typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'dev';
