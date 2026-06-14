import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ErrorStore', () => {
  let ErrorStore: typeof import('$lib/stores/errorStore.svelte').ErrorStore;
  let logCalls: Array<[string, string]> = [];

  beforeEach(async () => {
    // Reset the invoke mock to succeed for log_message calls
    const tauriCore = await import('@tauri-apps/api/core');
    (tauriCore.invoke as any).mockResolvedValue(undefined);

    // Clear module cache to get fresh imports
    vi.resetModules();

    // Import ErrorStore - it will use the mocked invoke from setup.ts
    const storeModule = await import('$lib/stores/errorStore.svelte');
    ErrorStore = storeModule.ErrorStore;
    logCalls = [];
  });

  it('starts with null error', () => {
    const store = new ErrorStore();
    expect(store.current).toBeNull();
  });

  it('sets error from string input', () => {
    const store = new ErrorStore();
    store.set('Something went wrong');
    expect(store.current).toEqual({
      type: 'Unknown',
      message: 'Something went wrong',
    });
  });

  it('sets error from object with type and message', () => {
    const store = new ErrorStore();
    store.set({ type: 'NetworkError', message: 'Connection failed' });
    expect(store.current).toEqual({
      type: 'NetworkError',
      message: 'Connection failed',
    });
  });

  it('clears the error state', () => {
    const store = new ErrorStore();
    store.set({ type: 'ApiError', message: '404' });
    expect(store.current).not.toBeNull();
    store.clear();
    expect(store.current).toBeNull();
  });

  it('overwrites previous error on subsequent set', () => {
    const store = new ErrorStore();
    store.set({ type: 'FirstError', message: 'First' });
    expect(store.current?.type).toBe('FirstError');
    store.set({ type: 'SecondError', message: 'Second' });
    expect(store.current?.type).toBe('SecondError');
    expect(store.current?.message).toBe('Second');
  });

  it('clear does not affect null state', () => {
    const store = new ErrorStore();
    store.clear(); // clearing when already null
    expect(store.current).toBeNull();
  });

  it('preserves custom object properties', () => {
    const store = new ErrorStore();
    store.set({ type: 'CustomError', message: 'Custom message', code: 500 });
    expect(store.current?.type).toBe('CustomError');
    expect(store.current?.message).toBe('Custom message');
  });

  it('sets error and still functions after clear', () => {
    const store = new ErrorStore();
    store.set({ type: 'E1', message: 'M1' });
    store.clear();
    store.set({ type: 'E2', message: 'M2' });
    expect(store.current).toEqual({ type: 'E2', message: 'M2' });
  });

  it('stores numeric input as-is without crashing', () => {
    const store = new ErrorStore();
    // typeof 42 !== 'string' so errorObj = 42; 42.type returns undefined (not a throw)
    // log() gets called with template that produces "Frontend Error: [undefined] undefined"
    store.set(42 as any);
    expect(store.current).toBe(42);
  });
});
