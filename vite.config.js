import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error Node.js global
const process = global.process;
const host = process.env.TAURI_DEV_HOST;
const port = parseInt(process.env.PORT || '1420', 10);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  // SSR: prevent Vite from externalizing Svelte and testing-library so they are bundled
  ssr: {
    noExternal: ['svelte', '@testing-library/svelte'],
  },

  // Test environment for Vitest
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
  },

  // Disable SSR for Svelte 5 runes compatibility in tests
  ssr: {
    noExternal: ['svelte', '@testing-library/svelte'],
  },

  // Svelte 5 compiler options for client-side SSR compatibility
  sveltekit: {
    compilerOptions: {
      // Svelte 5 runes are enabled by default; immutable mode aligns with runev reactivity model
      immutable: true,
      // Accessors allow component props to be read from outside (needed for SSR hydration)
      accessors: true,
      dev: false,
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: port + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
