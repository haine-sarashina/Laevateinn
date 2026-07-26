import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsStore } from '$lib/stores/settingsStore.svelte';

const STORAGE_KEY = 'laevateinn-settings';

// In-memory localStorage stub for jsdom 29 (which requires --localstorage-file)
function makeLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => store.set(key, value)),
        removeItem: vi.fn((key: string) => store.delete(key)),
        clear: vi.fn(() => store.clear()),
        get length() { return store.size; },
        key: vi.fn((i: number) => [...store.keys()][i] ?? null),
    };
}

const accounts = [{ id: 'a@x.com' }, { id: 'b@x.com' }, { id: 'c@x.com' }];
const labels = [{ id: 'INBOX' }, { id: 'STARRED' }, { id: 'SPAM' }];

function stored(): any {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

describe('SettingsStore', () => {
    let store: SettingsStore;

    beforeEach(() => {
        Object.defineProperty(globalThis, 'localStorage', {
            value: makeLocalStorageStub(),
            writable: true,
            configurable: true,
        });
        store = new SettingsStore();
        store.init();
    });

    it('starts with defaults when nothing is stored', () => {
        expect(store.pollIntervalSec).toBe(60);
        expect(store.settings.accountOrder).toEqual([]);
    });

    it('loads previously stored settings', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ pollIntervalSec: 300 }));
        const fresh = new SettingsStore();
        fresh.init();
        expect(fresh.pollIntervalSec).toBe(300);
    });

    it('falls back to defaults when stored JSON is corrupt', () => {
        localStorage.setItem(STORAGE_KEY, '{not json');
        const fresh = new SettingsStore();
        fresh.init();
        expect(fresh.pollIntervalSec).toBe(60);
    });

    it('persists the poll interval', () => {
        store.setPollIntervalSec(30);
        expect(store.pollIntervalSec).toBe(30);
        expect(stored().pollIntervalSec).toBe(30);
    });

    it('rejects a negative poll interval', () => {
        store.setPollIntervalSec(-1);
        expect(store.pollIntervalSec).toBe(60);
    });

    it('persists the undo-send window', () => {
        store.setUndoSendSec(30);
        expect(store.undoSendSec).toBe(30);
        expect(stored().undoSendSec).toBe(30);
    });

    it('rejects an undo-send window over the 30 second cap', () => {
        store.setUndoSendSec(60);
        expect(store.undoSendSec).toBe(5);
    });

    it('rejects a zero undo-send window', () => {
        store.setUndoSendSec(0);
        expect(store.undoSendSec).toBe(5);
    });

    it('returns accounts unchanged when no order is stored', () => {
        expect(store.orderedAccounts(accounts).map(a => a.id)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    });

    it('moves an account down and persists the new order', () => {
        store.moveAccount(accounts, 'a@x.com', 1);
        expect(store.orderedAccounts(accounts).map(a => a.id)).toEqual(['b@x.com', 'a@x.com', 'c@x.com']);
        expect(stored().accountOrder).toEqual(['b@x.com', 'a@x.com', 'c@x.com']);
    });

    it('moves an account up', () => {
        store.moveAccount(accounts, 'c@x.com', -1);
        expect(store.orderedAccounts(accounts).map(a => a.id)).toEqual(['a@x.com', 'c@x.com', 'b@x.com']);
    });

    it('ignores a move past the top of the list', () => {
        store.moveAccount(accounts, 'a@x.com', -1);
        expect(store.orderedAccounts(accounts).map(a => a.id)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    });

    it('hides and unhides a label for one account only', () => {
        store.toggleLabelHidden('a@x.com', 'SPAM');
        expect(store.isLabelHidden('a@x.com', 'SPAM')).toBe(true);
        expect(store.isLabelHidden('b@x.com', 'SPAM')).toBe(false);

        store.toggleLabelHidden('a@x.com', 'SPAM');
        expect(store.isLabelHidden('a@x.com', 'SPAM')).toBe(false);
    });

    it('omits hidden labels from the sidebar list', () => {
        store.toggleLabelHidden('a@x.com', 'SPAM');
        expect(store.sidebarLabels('a@x.com', labels).map(l => l.id)).toEqual(['INBOX', 'STARRED']);
    });

    it('keeps hidden labels in the editable list so they can be re-enabled', () => {
        store.toggleLabelHidden('a@x.com', 'SPAM');
        expect(store.orderedLabels('a@x.com', labels).map(l => l.id)).toEqual(['INBOX', 'STARRED', 'SPAM']);
    });

    it('reorders labels per account and persists the order', () => {
        store.moveLabel('a@x.com', labels, 'SPAM', -1);
        expect(store.orderedLabels('a@x.com', labels).map(l => l.id)).toEqual(['INBOX', 'SPAM', 'STARRED']);
        expect(stored().accounts['a@x.com'].labelOrder).toEqual(['INBOX', 'SPAM', 'STARRED']);
    });

    it('returns labels untouched when no account is active', () => {
        expect(store.sidebarLabels(null, labels).map(l => l.id)).toEqual(['INBOX', 'STARRED', 'SPAM']);
    });

    it('drops settings for removed accounts', () => {
        store.toggleLabelHidden('a@x.com', 'SPAM');
        store.moveAccount(accounts, 'a@x.com', 1);

        store.pruneAccounts(['b@x.com', 'c@x.com']);

        expect(store.settings.accounts['a@x.com']).toBeUndefined();
        expect(store.settings.accountOrder).not.toContain('a@x.com');
        expect(stored().accountOrder).toEqual(['b@x.com', 'c@x.com']);
    });

    it('tracks dialog open state and tab', () => {
        expect(store.isOpen).toBe(false);
        store.open('account', 'b@x.com');
        expect(store.isOpen).toBe(true);
        expect(store.tab).toBe('account');
        expect(store.editingAccountId).toBe('b@x.com');
        store.close();
        expect(store.isOpen).toBe(false);
    });
});
