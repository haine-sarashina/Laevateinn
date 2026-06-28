import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeStore } from '$lib/stores/themeStore.svelte';

const STORAGE_KEY = 'laevateinn-theme';

// In-memory localStorage stub for jsdom 29 (which requires --localstorage-file)
const makeLocalStorageStub = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key) => store.get(key) ?? null),
    setItem: vi.fn((key, value) => store.set(key, value)),
    removeItem: vi.fn((key) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() { return store.size; },
    key: vi.fn((i) => [...store.keys()][i] ?? null),
  };
};

describe('ThemeStore', () => {
  let lsStub;

  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    Object.defineProperty(globalThis, 'localStorage', {
      value: lsStub,
      writable: true,
      configurable: true,
    });
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark theme', () => {
    const store = new ThemeStore();
    expect(store.currentTheme).toBe('dark');
  });

  it('toggle flips dark to light', () => {
    const store = new ThemeStore();
    store.toggle();
    expect(store.currentTheme).toBe('light');
  });

  it('toggle flips light to dark', () => {
    const store = new ThemeStore();
    store.setTheme('light');
    store.toggle();
    expect(store.currentTheme).toBe('dark');
  });

  it('writes theme to localStorage on setTheme', () => {
    const store = new ThemeStore();
    store.setTheme('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('reads theme from localStorage on init', () => {
    lsStub.setItem(STORAGE_KEY, 'light');
    const store = new ThemeStore();
    store.init();
    expect(store.currentTheme).toBe('light');
  });

  it('sets data-theme attribute on documentElement', () => {
    const store = new ThemeStore();
    store.setTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('initial load from localStorage overrides default', () => {
    lsStub.setItem(STORAGE_KEY, 'light');
    const store = new ThemeStore();
    store.init();
    expect(store.currentTheme).toBe('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('does not change theme when setTheme called with same value', () => {
    const store = new ThemeStore();
    // current is already 'dark', calling setTheme('dark') should be a no-op for #apply
    store.setTheme('dark');
    expect(store.currentTheme).toBe('dark');
    // #apply should not have been called since theme didn't change
    expect(lsStub.setItem).not.toHaveBeenCalled();
  });

  it('sets data-theme attribute during init', () => {
    const store = new ThemeStore();
    store.init();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('CSS variable --bg-primary differs between dark and light themes', () => {
    // Inject theme CSS matching +layout.svelte values.
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      [data-theme="dark"] { --bg-primary: #1f2937; }
      [data-theme="light"] { --bg-primary: #f9fafb; }
    `;
    document.head.appendChild(styleEl);

    const store = new ThemeStore();
    // set data-theme attribute so CSS rules match (default is 'dark' but attr not set yet)
    document.documentElement.setAttribute('data-theme', 'dark');
    const darkBg = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary').trim();

    store.setTheme('light'); // sets data-theme="light" on documentElement
    const lightBg = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary').trim();

    expect(darkBg).not.toBe(lightBg);
  });

  it('dark theme --bg-primary is #1f2937', () => {
    const styleEl = document.createElement('style');
    styleEl.textContent = `[data-theme="dark"] { --bg-primary: #1f2937; }`;
    document.head.appendChild(styleEl);

    // Default store theme is 'dark' but data-theme attr not set; set it manually.
    document.documentElement.setAttribute('data-theme', 'dark');
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary').trim();
    expect(bg).toBe('#1f2937');
  });

  it('light theme --bg-primary is #f9fafb', () => {
    const styleEl = document.createElement('style');
    styleEl.textContent = `[data-theme="light"] { --bg-primary: #f9fafb; }`;
    document.head.appendChild(styleEl);

    // Force a toggle to set data-theme attr (default is 'dark' -> toggle makes it 'light')
    const store = new ThemeStore();
    store.toggle(); // sets data-theme="light" on documentElement
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary').trim();
    expect(bg).toBe('#f9fafb');
  });

  it('init ignores invalid localStorage values', () => {
    lsStub.setItem(STORAGE_KEY, 'invalid-theme');
    const store = new ThemeStore();
    store.init();
    expect(store.currentTheme).toBe('dark');
  });

  it('init writes default theme to localStorage when none stored', () => {
    const store = new ThemeStore();
    store.init();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('consecutive toggles alternate correctly', () => {
    const store = new ThemeStore();
    expect(store.currentTheme).toBe('dark');
    store.toggle();
    expect(store.currentTheme).toBe('light');
    store.toggle();
    expect(store.currentTheme).toBe('dark');
    store.toggle();
    expect(store.currentTheme).toBe('light');
  });
});
