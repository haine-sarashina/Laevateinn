import {
    applyOrder,
    defaultAccountSettings,
    defaultSettings,
    moveInOrder,
    normalizeSettings,
    visibleLabels,
    MAX_UNDO_SEND_SEC,
} from "$lib/settings";
import type { AccountSettings, AppSettings } from "$lib/settings";

const STORAGE_KEY = 'laevateinn-settings';

/** Which pane the settings dialog shows. */
export type SettingsTab = 'app' | 'account';

/**
 * User preferences for the sidebar and new-mail polling, persisted to
 * localStorage. Mail data is never stored here.
 */
class SettingsStore {
    #settings = $state<AppSettings>(defaultSettings());

    /** Whether the settings dialog is open. */
    isOpen = $state(false);
    /** Active tab in the settings dialog. */
    tab = $state<SettingsTab>('app');
    /** Account whose per-account settings are being edited. */
    editingAccountId = $state<string | null>(null);

    get settings(): AppSettings {
        return this.#settings;
    }

    get pollIntervalSec(): number {
        return this.#settings.pollIntervalSec;
    }

    get undoSendSec(): number {
        return this.#settings.undoSendSec;
    }

    /** Load persisted settings. Safe to call when localStorage is unavailable. */
    init(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            this.#settings = normalizeSettings(raw ? JSON.parse(raw) : null);
        } catch (e) {
            console.error('[settingsStore] failed to load settings', e);
            this.#settings = defaultSettings();
        }
    }

    #persist(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#settings));
        } catch (e) {
            console.error('[settingsStore] failed to save settings', e);
        }
    }

    /** Replace the settings wholesale (used by tests and reset flows). */
    replace(next: AppSettings): void {
        this.#settings = normalizeSettings(next);
        this.#persist();
    }

    open(tab: SettingsTab = 'app', accountId: string | null = null): void {
        this.tab = tab;
        if (accountId) this.editingAccountId = accountId;
        this.isOpen = true;
    }

    close(): void {
        this.isOpen = false;
    }

    // ── Application-wide settings ──────────────────────────────

    setPollIntervalSec(sec: number): void {
        if (!Number.isFinite(sec) || sec < 0) return;
        this.#settings = { ...this.#settings, pollIntervalSec: sec };
        this.#persist();
    }

    setUndoSendSec(sec: number): void {
        if (!Number.isFinite(sec) || sec <= 0 || sec > MAX_UNDO_SEND_SEC) return;
        this.#settings = { ...this.#settings, undoSendSec: sec };
        this.#persist();
    }

    /** Accounts in user-defined sidebar order. */
    orderedAccounts<T extends { id: string }>(accounts: T[]): T[] {
        return applyOrder(accounts, this.#settings.accountOrder, a => a.id);
    }

    /**
     * Moves an account up (-1) or down (+1) in the sidebar.
     * `accounts` is the currently displayed order, so the stored order stays in
     * sync with what the user sees even before any manual ordering existed.
     */
    moveAccount<T extends { id: string }>(accounts: T[], id: string, delta: number): void {
        const current = this.orderedAccounts(accounts).map(a => a.id);
        this.#settings = { ...this.#settings, accountOrder: moveInOrder(current, id, delta) };
        this.#persist();
    }

    // ── Per-account settings ───────────────────────────────────

    accountSettings(accountId: string): AccountSettings {
        return this.#settings.accounts[accountId] ?? defaultAccountSettings();
    }

    #updateAccount(accountId: string, patch: Partial<AccountSettings>): void {
        const current = this.accountSettings(accountId);
        this.#settings = {
            ...this.#settings,
            accounts: { ...this.#settings.accounts, [accountId]: { ...current, ...patch } },
        };
        this.#persist();
    }

    isLabelHidden(accountId: string, labelId: string): boolean {
        return this.accountSettings(accountId).hiddenLabels.includes(labelId);
    }

    toggleLabelHidden(accountId: string, labelId: string): void {
        const hidden = this.accountSettings(accountId).hiddenLabels;
        const next = hidden.includes(labelId)
            ? hidden.filter(id => id !== labelId)
            : [...hidden, labelId];
        this.#updateAccount(accountId, { hiddenLabels: next });
    }

    /** Moves a label up (-1) or down (+1) within the account's label list. */
    moveLabel<T extends { id: string }>(accountId: string, labels: T[], labelId: string, delta: number): void {
        const current = this.orderedLabels(accountId, labels).map(l => l.id);
        this.#updateAccount(accountId, { labelOrder: moveInOrder(current, labelId, delta) });
    }

    /** All labels for an account in user-defined order (hidden ones included). */
    orderedLabels<T extends { id: string }>(accountId: string, labels: T[]): T[] {
        return applyOrder(labels, this.accountSettings(accountId).labelOrder, l => l.id);
    }

    /** Labels the sidebar should render: ordered, with hidden ones removed. */
    sidebarLabels<T extends { id: string }>(accountId: string | null, labels: T[]): T[] {
        if (!accountId) return labels;
        return visibleLabels(labels, this.accountSettings(accountId));
    }

    /** Drops settings for accounts that no longer exist. */
    pruneAccounts(existingIds: string[]): void {
        const keep = new Set(existingIds);
        const accounts: Record<string, AccountSettings> = {};
        for (const [id, value] of Object.entries(this.#settings.accounts)) {
            if (keep.has(id)) accounts[id] = value;
        }
        this.#settings = {
            ...this.#settings,
            accounts,
            accountOrder: this.#settings.accountOrder.filter(id => keep.has(id)),
        };
        this.#persist();
    }
}

export const settingsStore = new SettingsStore();
export { SettingsStore };
