import { describe, it, expect } from 'vitest';
import {
    applyOrder,
    defaultSettings,
    moveInOrder,
    normalizeSettings,
    visibleLabels,
    DEFAULT_POLL_INTERVAL_SEC,
    DEFAULT_UNDO_SEND_SEC,
} from '$lib/settings';

describe('normalizeSettings', () => {
    it('returns defaults for null / non-object input', () => {
        expect(normalizeSettings(null)).toEqual(defaultSettings());
        expect(normalizeSettings('nonsense')).toEqual(defaultSettings());
        expect(normalizeSettings(42)).toEqual(defaultSettings());
    });

    it('keeps valid values', () => {
        const parsed = normalizeSettings({
            accountOrder: ['b@x.com', 'a@x.com'],
            pollIntervalSec: 300,
            accounts: { 'a@x.com': { hiddenLabels: ['SPAM'], labelOrder: ['INBOX', 'STARRED'] } },
        });
        expect(parsed.accountOrder).toEqual(['b@x.com', 'a@x.com']);
        expect(parsed.pollIntervalSec).toBe(300);
        expect(parsed.accounts['a@x.com'].hiddenLabels).toEqual(['SPAM']);
        expect(parsed.accounts['a@x.com'].labelOrder).toEqual(['INBOX', 'STARRED']);
    });

    it('drops non-string entries from stored arrays', () => {
        const parsed = normalizeSettings({
            accountOrder: ['a', 5, null],
            accounts: { x: { hiddenLabels: ['A', {}], labelOrder: [1, 'B'] } },
        });
        expect(parsed.accountOrder).toEqual(['a']);
        expect(parsed.accounts.x.hiddenLabels).toEqual(['A']);
        expect(parsed.accounts.x.labelOrder).toEqual(['B']);
    });

    it('falls back to the default interval for invalid values', () => {
        expect(normalizeSettings({ pollIntervalSec: -5 }).pollIntervalSec).toBe(DEFAULT_POLL_INTERVAL_SEC);
        expect(normalizeSettings({ pollIntervalSec: 'often' }).pollIntervalSec).toBe(DEFAULT_POLL_INTERVAL_SEC);
        expect(normalizeSettings({ pollIntervalSec: NaN }).pollIntervalSec).toBe(DEFAULT_POLL_INTERVAL_SEC);
    });

    it('accepts 0 as "do not poll"', () => {
        expect(normalizeSettings({ pollIntervalSec: 0 }).pollIntervalSec).toBe(0);
    });

    it('keeps a valid undo-send window', () => {
        expect(normalizeSettings({ undoSendSec: 30 }).undoSendSec).toBe(30);
    });

    it('rejects an undo-send window outside 1..30 seconds', () => {
        expect(normalizeSettings({ undoSendSec: 0 }).undoSendSec).toBe(DEFAULT_UNDO_SEND_SEC);
        expect(normalizeSettings({ undoSendSec: 31 }).undoSendSec).toBe(DEFAULT_UNDO_SEND_SEC);
        expect(normalizeSettings({ undoSendSec: -5 }).undoSendSec).toBe(DEFAULT_UNDO_SEND_SEC);
    });

    it('repairs malformed per-account entries instead of throwing', () => {
        const parsed = normalizeSettings({ accounts: { broken: 'oops' } });
        expect(parsed.accounts.broken).toEqual({ hiddenLabels: [], labelOrder: [] });
    });
});

describe('applyOrder', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    it('sorts by the given id order', () => {
        expect(applyOrder(items, ['c', 'a', 'b'], i => i.id).map(i => i.id)).toEqual(['c', 'a', 'b']);
    });

    it('appends unlisted items in their original order', () => {
        expect(applyOrder(items, ['c'], i => i.id).map(i => i.id)).toEqual(['c', 'a', 'b']);
    });

    it('ignores ids that no longer exist', () => {
        expect(applyOrder(items, ['zzz', 'b'], i => i.id).map(i => i.id)).toEqual(['b', 'a', 'c']);
    });

    it('leaves the list untouched when no order is stored', () => {
        expect(applyOrder(items, [], i => i.id).map(i => i.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('moveInOrder', () => {
    it('moves an item up', () => {
        expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    });

    it('moves an item down', () => {
        expect(moveInOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    });

    it('refuses to move past either end', () => {
        expect(moveInOrder(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
        expect(moveInOrder(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    });

    it('returns the list unchanged for an unknown id', () => {
        expect(moveInOrder(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b']);
    });

    it('does not mutate the input', () => {
        const input = ['a', 'b', 'c'];
        moveInOrder(input, 'a', 1);
        expect(input).toEqual(['a', 'b', 'c']);
    });
});

describe('visibleLabels', () => {
    const labels = [{ id: 'INBOX' }, { id: 'SPAM' }, { id: 'TRASH' }];

    it('removes hidden labels', () => {
        const result = visibleLabels(labels, { hiddenLabels: ['SPAM'], labelOrder: [] });
        expect(result.map(l => l.id)).toEqual(['INBOX', 'TRASH']);
    });

    it('applies the stored order to the remaining labels', () => {
        const result = visibleLabels(labels, { hiddenLabels: [], labelOrder: ['TRASH', 'INBOX'] });
        expect(result.map(l => l.id)).toEqual(['TRASH', 'INBOX', 'SPAM']);
    });

    it('returns everything when nothing is configured', () => {
        const result = visibleLabels(labels, { hiddenLabels: [], labelOrder: [] });
        expect(result.map(l => l.id)).toEqual(['INBOX', 'SPAM', 'TRASH']);
    });
});
