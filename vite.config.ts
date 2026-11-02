import { defineConfig } from 'vite';

// GitHub Pages (https://tekitouore-ops.github.io/wanwan-Linestamp/) での公開を前提に base を固定する。
// ローカル開発でもこのパス配下で動作確認できるようにする。
export default defineConfig({
  base: '/wanwan-Linestamp/',
});
