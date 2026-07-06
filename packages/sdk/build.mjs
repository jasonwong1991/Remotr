import { build } from 'esbuild';

// 将 SDK 打包为单个 IIFE 文件，可直接 <script> 注入任意页面。
// rrweb 一并打入（页面镜像所需），无需目标页面有任何依赖。
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'REMOTR',
  outfile: 'dist/remotr.js',
  // Android 8 出厂 WebView ≈ Chrome 58~61：不支持 ES2019 的 catch{}（需 66）
  // 和 globalThis（需 71）。target 降到 es2017（Chrome 58 已支持 async/await），
  // 并用 banner 注入 globalThis polyfill（rrweb 依赖）。
  target: ['es2017'],
  banner: {
    js: 'window.globalThis||(window.globalThis=window);',
  },
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('[sdk] built dist/remotr.js');
