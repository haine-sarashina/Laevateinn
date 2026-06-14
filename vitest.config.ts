import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
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
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.{ts,svelte}'],
      exclude: [
        'src/tests/**',
        'src/lib/windowState.svelte.ts',
      ],
    },
  },
});
