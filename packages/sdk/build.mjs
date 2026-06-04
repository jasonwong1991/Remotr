import { build } from 'esbuild';

// 将 SDK 打包为单个 IIFE 文件，可直接 <script> 注入任意页面。
// rrweb 一并打入（页面镜像所需），无需目标页面有任何依赖。
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'REMOTR',
  outfile: 'dist/remotr.js',
  target: ['es2019'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('[sdk] built dist/remotr.js');
