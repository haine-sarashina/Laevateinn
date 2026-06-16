import { vi, beforeEach } from 'vitest';

/**
 * Mock @tauri-apps/api/core invoke function.
 * All safeInvoke calls ultimately call invoke() from @tauri-apps/api/core.
 * By mocking this, we intercept every backend IPC call.
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
}));

/**
 * Mock @tauri-apps/plugin-opener openUrl function.
 */
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

/**
 * Mock @tauri-apps/api/window getCurrentWindow and related.
 */
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    show: vi.fn(() => Promise.resolve()),
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    setSize: vi.fn(() => Promise.resolve()),
    setPosition: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    innerSize: vi.fn(() => Promise.resolve({ width: 1200, height: 800 })),
    outerSize: vi.fn(() => Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    isMaximized: vi.fn(() => Promise.resolve(false)),
  })),
  PhysicalSize: vi.fn((w, h) => ({ width: w, height: h })),
  PhysicalPosition: vi.fn((x, y) => ({ x, y })),
}));

/**
 * Mock @tauri-apps/api/event listen and emit.
 */
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})), // returns cleanup function
  emit: vi.fn(() => Promise.resolve()),
}));

// Reset mocks between tests to avoid state leakage
beforeEach(() => {
  vi.clearAllMocks();
});
