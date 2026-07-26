/**
 * Pure helpers behind the settings screens.
 *
 * Settings are user preferences only — never credentials or mail content — so
 * they live in localStorage rather than the OS keychain.
 */

/** Per-account display preferences. */
export interface AccountSettings {
    /** Label IDs hidden from the sidebar. */
    hiddenLabels: string[];
    /** Label IDs in display order. Labels not listed keep their server order, after these. */
    labelOrder: string[];
}

/** Whole-application preferences. */
export interface AppSettings {
    /** Account IDs in sidebar order. Accounts not listed are appended. */
    accountOrder: string[];
    /** How often to check for new mail, in seconds. 0 disables polling. */
    pollIntervalSec: number;
    /** Grace period for undoing a send, in seconds (Gmail allows up to 30). */
    undoSendSec: number;
    /** Per-account settings keyed by account ID. */
    accounts: Record<string, AccountSettings>;
}

export const DEFAULT_POLL_INTERVAL_SEC = 60;
export const DEFAULT_UNDO_SEND_SEC = 5;
/** Gmail caps the undo-send window at 30 seconds; mirror that. */
export const MAX_UNDO_SEND_SEC = 30;

/** Selectable undo-send grace periods (seconds). */
export const UNDO_SEND_CHOICES: Array<{ value: number; label: string }> = [
    { value: 5, label: '5秒' },
    { value: 10, label: '10秒' },
    { value: 20, label: '20秒' },
    { value: 30, label: '30秒' },
];

/** Selectable new-mail check intervals (seconds). 0 = off. */
export const POLL_INTERVAL_CHOICES: Array<{ value: number; label: string }> = [
    { value: 0, label: '確認しない' },
    { value: 30, label: '30秒ごと' },
    { value: 60, label: '1分ごと' },
    { value: 300, label: '5分ごと' },
    { value: 900, label: '15分ごと' },
];

export function defaultSettings(): AppSettings {
    return {
        accountOrder: [],
        pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
        undoSendSec: DEFAULT_UNDO_SEND_SEC,
        accounts: {},
    };
}

export function defaultAccountSettings(): AccountSettings {
    return { hiddenLabels: [], labelOrder: [] };
}

/**
 * Normalizes anything read back from storage into a valid AppSettings.
 * Storage can hold values written by an older version, so every field is
 * validated rather than trusted.
 */
export function normalizeSettings(raw: unknown): AppSettings {
    const base = defaultSettings();
    if (typeof raw !== 'object' || raw === null) return base;
    const obj = raw as Record<string, unknown>;

    if (Array.isArray(obj.accountOrder)) {
        base.accountOrder = obj.accountOrder.filter((v): v is string => typeof v === 'string');
    }
    if (typeof obj.pollIntervalSec === 'number' && Number.isFinite(obj.pollIntervalSec) && obj.pollIntervalSec >= 0) {
        base.pollIntervalSec = obj.pollIntervalSec;
    }
    if (
        typeof obj.undoSendSec === 'number' &&
        Number.isFinite(obj.undoSendSec) &&
        obj.undoSendSec > 0 &&
        obj.undoSendSec <= MAX_UNDO_SEND_SEC
    ) {
        base.undoSendSec = obj.undoSendSec;
    }
    if (typeof obj.accounts === 'object' && obj.accounts !== null) {
        for (const [id, value] of Object.entries(obj.accounts as Record<string, unknown>)) {
            const acc = defaultAccountSettings();
            if (typeof value === 'object' && value !== null) {
                const v = value as Record<string, unknown>;
                if (Array.isArray(v.hiddenLabels)) {
                    acc.hiddenLabels = v.hiddenLabels.filter((x): x is string => typeof x === 'string');
                }
                if (Array.isArray(v.labelOrder)) {
                    acc.labelOrder = v.labelOrder.filter((x): x is string => typeof x === 'string');
                }
            }
            base.accounts[id] = acc;
        }
    }
    return base;
}

/**
 * Sorts items by an explicit ID order. Items missing from `order` keep their
 * original relative position and are appended after the ordered ones.
 */
export function applyOrder<T>(items: T[], order: string[], idOf: (item: T) => string): T[] {
    const rank = new Map(order.map((id, i) => [id, i]));
    const ordered: T[] = [];
    const rest: T[] = [];
    for (const item of items) {
        (rank.has(idOf(item)) ? ordered : rest).push(item);
    }
    ordered.sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
    return [...ordered, ...rest];
}

/**
 * Returns a new ID list with `id` moved by `delta` positions.
 * Out-of-range moves return the list unchanged.
 */
export function moveInOrder(ids: string[], id: string, delta: number): string[] {
    const from = ids.indexOf(id);
    if (from < 0) return ids;
    const to = from + delta;
    if (to < 0 || to >= ids.length) return ids;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    return next;
}

/** Labels visible in the sidebar for an account: hidden removed, order applied. */
export function visibleLabels<T extends { id: string }>(labels: T[], settings: AccountSettings): T[] {
    const hidden = new Set(settings.hiddenLabels);
    return applyOrder(labels.filter(l => !hidden.has(l.id)), settings.labelOrder, l => l.id);
}
