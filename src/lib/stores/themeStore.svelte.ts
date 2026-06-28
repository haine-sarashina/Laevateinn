import { log } from '../api';

const STORAGE_KEY = 'laevateinn-theme';

export class ThemeStore {
    #currentTheme: 'dark' | 'light' = $state('dark');

    get currentTheme(): 'dark' | 'light' {
        return this.#currentTheme;
    }

    setTheme(theme: 'dark' | 'light') {
        const previous = this.#currentTheme;
        if (previous === theme) return;
        this.#currentTheme = theme;
        this.#apply();
        log('info', `Theme changed: ${previous} -> ${theme}`)
            .catch(e => console.error("Failed to log theme change:", e));
    }

    toggle() {
        this.setTheme(this.#currentTheme === 'dark' ? 'light' : 'dark');
    }

    #apply() {
        try {
            localStorage.setItem(STORAGE_KEY, this.#currentTheme);
        } catch (e) {
            console.error("Failed to save theme to localStorage:", e);
        }
        document.documentElement.setAttribute('data-theme', this.#currentTheme);
    }

    init() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored === 'dark' || stored === 'light') {
                this.#currentTheme = stored;
            } else {
                localStorage.setItem(STORAGE_KEY, this.#currentTheme);
            }
        } catch (e) {
            console.error("Failed to read theme from localStorage:", e);
        }
        document.documentElement.setAttribute('data-theme', this.#currentTheme);
    }
}

export const themeStore = new ThemeStore();