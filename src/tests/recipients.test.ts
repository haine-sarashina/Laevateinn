import { describe, it, expect } from 'vitest';
import {
    buildReplyAllRecipients,
    dedupeRecipients,
    formatAddressList,
    parseAddress,
    parseAddressList,
    splitAddressList,
} from '$lib/recipients';

describe('splitAddressList', () => {
    it('splits a plain comma-separated list', () => {
        expect(splitAddressList('a@x.com, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
    });

    it('keeps commas inside quoted display names together', () => {
        expect(splitAddressList('"Doe, John" <j@x.com>, b@y.com')).toEqual([
            '"Doe, John" <j@x.com>',
            'b@y.com',
        ]);
    });

    it('keeps commas inside angle brackets together', () => {
        expect(splitAddressList('Group <a@x.com>, b@y.com')).toEqual(['Group <a@x.com>', 'b@y.com']);
    });

    it('drops empty segments from trailing or doubled commas', () => {
        expect(splitAddressList('a@x.com,, b@y.com,')).toEqual(['a@x.com', 'b@y.com']);
    });

    it('returns an empty array for an empty header', () => {
        expect(splitAddressList('')).toEqual([]);
    });
});

describe('parseAddress', () => {
    it('splits name and address', () => {
        expect(parseAddress('Jane Doe <jane@x.com>')).toEqual({
            name: 'Jane Doe',
            email: 'jane@x.com',
            raw: 'Jane Doe <jane@x.com>',
        });
    });

    it('strips surrounding quotes from the display name', () => {
        expect(parseAddress('"Doe, John" <j@x.com>').name).toBe('Doe, John');
    });

    it('handles a bare address', () => {
        expect(parseAddress('bare@x.com')).toEqual({
            name: '',
            email: 'bare@x.com',
            raw: 'bare@x.com',
        });
    });
});

describe('parseAddressList', () => {
    it('returns an empty array for null / undefined / empty', () => {
        expect(parseAddressList(undefined)).toEqual([]);
        expect(parseAddressList(null)).toEqual([]);
        expect(parseAddressList('')).toEqual([]);
    });

    it('parses a mixed list', () => {
        const list = parseAddressList('A <a@x.com>, b@y.com');
        expect(list.map(r => r.email)).toEqual(['a@x.com', 'b@y.com']);
    });
});

describe('dedupeRecipients', () => {
    it('removes duplicates case-insensitively', () => {
        const list = parseAddressList('a@x.com, A@X.com, b@y.com');
        expect(dedupeRecipients(list, new Set()).map(r => r.email)).toEqual(['a@x.com', 'b@y.com']);
    });

    it('removes excluded addresses', () => {
        const list = parseAddressList('me@x.com, other@y.com');
        expect(dedupeRecipients(list, new Set(['me@x.com'])).map(r => r.email)).toEqual([
            'other@y.com',
        ]);
    });

    it('shares the seen set across calls', () => {
        const seen = new Set<string>();
        dedupeRecipients(parseAddressList('a@x.com'), new Set(), seen);
        expect(dedupeRecipients(parseAddressList('a@x.com, b@y.com'), new Set(), seen)).toHaveLength(1);
    });
});

describe('formatAddressList', () => {
    it('round-trips the original formatting', () => {
        const header = 'Jane Doe <jane@x.com>, bare@y.com';
        expect(formatAddressList(parseAddressList(header))).toBe(header);
    });
});

describe('buildReplyAllRecipients', () => {
    it('puts the sender and the other To recipients in To', () => {
        const result = buildReplyAllRecipients(
            { from: 'Sender <sender@x.com>', to: 'me@x.com, colleague@x.com', cc: '' },
            'me@x.com',
        );
        expect(result.to).toBe('Sender <sender@x.com>, colleague@x.com');
        expect(result.cc).toBe('');
    });

    it('keeps the original Cc recipients in Cc', () => {
        const result = buildReplyAllRecipients(
            { from: 'sender@x.com', to: 'me@x.com', cc: 'watcher@y.com, boss@y.com' },
            'me@x.com',
        );
        expect(result.to).toBe('sender@x.com');
        expect(result.cc).toBe('watcher@y.com, boss@y.com');
    });

    it('excludes the signed-in account from every field', () => {
        const result = buildReplyAllRecipients(
            { from: 'sender@x.com', to: 'ME@X.com, other@x.com', cc: 'me@x.com' },
            'me@x.com',
        );
        expect(result.to).toBe('sender@x.com, other@x.com');
        expect(result.cc).toBe('');
    });

    it('never repeats an address that is already in To', () => {
        const result = buildReplyAllRecipients(
            { from: 'sender@x.com', to: 'a@x.com', cc: 'sender@x.com, a@x.com, b@x.com' },
            'me@x.com',
        );
        expect(result.to).toBe('sender@x.com, a@x.com');
        expect(result.cc).toBe('b@x.com');
    });

    it('falls back to the sender when excluding self would empty To', () => {
        // A mail addressed only to me: without the fallback there is nobody to reply to.
        const result = buildReplyAllRecipients(
            { from: 'me@x.com', to: 'me@x.com', cc: '' },
            'me@x.com',
        );
        expect(result.to).toBe('me@x.com');
    });

    it('handles a missing To / Cc header', () => {
        const result = buildReplyAllRecipients({ from: 'sender@x.com' }, 'me@x.com');
        expect(result.to).toBe('sender@x.com');
        expect(result.cc).toBe('');
    });

    it('works when no account is signed in', () => {
        const result = buildReplyAllRecipients(
            { from: 'sender@x.com', to: 'a@x.com', cc: 'b@x.com' },
            null,
        );
        expect(result.to).toBe('sender@x.com, a@x.com');
        expect(result.cc).toBe('b@x.com');
    });

    it('preserves display names with commas', () => {
        const result = buildReplyAllRecipients(
            { from: '"Doe, John" <j@x.com>', to: 'me@x.com', cc: '' },
            'me@x.com',
        );
        expect(result.to).toBe('"Doe, John" <j@x.com>');
    });
});
