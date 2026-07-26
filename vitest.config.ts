import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  /**
   * svelteTesting() forces the "browser" export condition so Svelte resolves to
   * its client runtime. Without it, component tests fail with
   * "mount(...) is not available on the server".
   */
  plugins: [sveltekit(), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
    setupFiles: ['./src/tests/setup.ts'],
    exclude: [
      'node_modules',
      '.svelte-kit',
      'src-tauri',
      'dist',
      'build',
    ],
    /**
     * Svelte 5 runes components need client-side runtime.
     * Use jsdom with URL set for proper client-side behavior.
     */
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.{ts,svelte}'],
      exclude: [
        'src/tests/**',
        'src/lib/windowState.svelte.ts',
      ],
    },
  },
  /**
   * Disable SSR for test environment to ensure Svelte 5 runes work.
   */
  ssr: {
    noExternal: ['svelte', '@testing-library/svelte'],
  },
});
