import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'desktop-lottery-global',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]shared[\\/]js[\\/]lottery-core\.js$/.test(id)) return null;
      return code.replace(
        "  if (typeof module !== 'undefined' && module.exports) module.exports = Lottery;\n  else root.Lottery = Lottery;",
        '  root.Lottery = Lottery;',
      );
    },
  }],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: {
      allow: [projectRoot],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
