import { describe, it, expect } from 'vitest';
import {
    buildListRows,
    messageTimestamp,
    rowHeights,
    rowIndexForMessage,
    sortMessagesForDisplay,
    HEADER_ROW_HEIGHT,
    MESSAGE_ROW_HEIGHT,
} from '$lib/messageSections';
import type { EmailMessage } from '$lib/stores/emailStore.svelte';

function msg(id: string, date: string, read = false): EmailMessage {
    return {
        id,
        threadId: `t-${id}`,
        snippet: `snippet ${id}`,
        subject: `subject ${id}`,
        from: `${id}@example.com`,
        date,
        body: '',
        read,
        starred: false,
        important: false,
    };
}

describe('messageTimestamp', () => {
    it('parses RFC dates', () => {
        expect(messageTimestamp('2026-07-08T10:00:00Z')).toBe(Date.parse('2026-07-08T10:00:00Z'));
    });

    it('returns 0 for unparseable dates so they sort last', () => {
        expect(messageTimestamp('not a date')).toBe(0);
        expect(messageTimestamp('')).toBe(0);
    });
});

describe('sortMessagesForDisplay', () => {
    it('orders newest first when no unread section exists', () => {
        const input = [
            msg('a', '2026-07-01T00:00:00Z'),
            msg('c', '2026-07-05T00:00:00Z'),
            msg('b', '2026-07-03T00:00:00Z'),
        ];
        const sorted = sortMessagesForDisplay(input, new Set());
        expect(sorted.map(m => m.id)).toEqual(['c', 'b', 'a']);
    });

    it('does not mutate the input array', () => {
        const input = [msg('a', '2026-07-01T00:00:00Z'), msg('b', '2026-07-05T00:00:00Z')];
        sortMessagesForDisplay(input, new Set());
        expect(input.map(m => m.id)).toEqual(['a', 'b']);
    });

    it('puts the unread section first, newest first within each section', () => {
        const input = [
            msg('read-old', '2026-07-01T00:00:00Z', true),
            msg('unread-old', '2026-07-02T00:00:00Z'),
            msg('read-new', '2026-07-06T00:00:00Z', true),
            msg('unread-new', '2026-07-04T00:00:00Z'),
        ];
        const sorted = sortMessagesForDisplay(input, new Set(['unread-old', 'unread-new']));
        expect(sorted.map(m => m.id)).toEqual(['unread-new', 'unread-old', 'read-new', 'read-old']);
    });

    it('keeps a message in the unread section after it is marked read', () => {
        // Section membership is a snapshot: opening a mail must not reorder the list.
        const opened = msg('m1', '2026-07-02T00:00:00Z', true);
        const sorted = sortMessagesForDisplay(
            [msg('m2', '2026-07-05T00:00:00Z', true), opened],
            new Set(['m1']),
        );
        expect(sorted.map(m => m.id)).toEqual(['m1', 'm2']);
    });

    it('sorts undated messages to the bottom', () => {
        const sorted = sortMessagesForDisplay(
            [msg('broken', 'garbage'), msg('ok', '2026-07-01T00:00:00Z')],
            new Set(),
        );
        expect(sorted.map(m => m.id)).toEqual(['ok', 'broken']);
    });
});

describe('buildListRows', () => {
    it('omits headers when every message is unread', () => {
        const messages = [msg('a', '2026-07-02T00:00:00Z'), msg('b', '2026-07-01T00:00:00Z')];
        const rows = buildListRows(messages, new Set(['a', 'b']));
        expect(rows.every(r => r.kind === 'message')).toBe(true);
        expect(rows).toHaveLength(2);
    });

    it('omits headers when every message is read', () => {
        const messages = [msg('a', '2026-07-02T00:00:00Z', true)];
        const rows = buildListRows(messages, new Set());
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe('message');
    });

    it('inserts 未読 and 既読 headers with counts when both sections exist', () => {
        const messages = [
            msg('u1', '2026-07-05T00:00:00Z'),
            msg('u2', '2026-07-04T00:00:00Z'),
            msg('r1', '2026-07-03T00:00:00Z', true),
        ];
        const rows = buildListRows(messages, new Set(['u1', 'u2']));
        expect(rows.map(r => (r.kind === 'header' ? `H:${r.label}:${r.count}` : r.id))).toEqual([
            'H:未読:2',
            'u1',
            'u2',
            'H:既読:1',
            'r1',
        ]);
    });

    it('keeps messageIndex pointing at the messages array, not the row array', () => {
        const messages = [msg('u1', '2026-07-05T00:00:00Z'), msg('r1', '2026-07-03T00:00:00Z', true)];
        const rows = buildListRows(messages, new Set(['u1']));
        const messageRows = rows.filter(r => r.kind === 'message');
        expect(messageRows.map(r => (r.kind === 'message' ? r.messageIndex : -1))).toEqual([0, 1]);
    });

    it('returns an empty row list for no messages', () => {
        expect(buildListRows([], new Set())).toEqual([]);
    });
});

describe('rowHeights / rowIndexForMessage', () => {
    it('gives headers and messages their own heights', () => {
        const messages = [msg('u1', '2026-07-05T00:00:00Z'), msg('r1', '2026-07-03T00:00:00Z', true)];
        const rows = buildListRows(messages, new Set(['u1']));
        expect(rowHeights(rows)).toEqual([
            HEADER_ROW_HEIGHT,
            MESSAGE_ROW_HEIGHT,
            HEADER_ROW_HEIGHT,
            MESSAGE_ROW_HEIGHT,
        ]);
    });

    it('maps a message index to its row index across headers', () => {
        const messages = [msg('u1', '2026-07-05T00:00:00Z'), msg('r1', '2026-07-03T00:00:00Z', true)];
        const rows = buildListRows(messages, new Set(['u1']));
        expect(rowIndexForMessage(rows, 0)).toBe(1);
        expect(rowIndexForMessage(rows, 1)).toBe(3);
        expect(rowIndexForMessage(rows, 99)).toBe(-1);
    });
});
