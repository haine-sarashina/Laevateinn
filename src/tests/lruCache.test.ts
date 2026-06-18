import { describe, it, expect } from 'vitest';
import { LRUMessageCache } from '$lib/stores/lruCache';
import type { EmailMessage } from '$lib/stores/emailStore.svelte';

function createMsg(overrides: Partial<EmailMessage> = {}): EmailMessage {
    return {
        id: 'msg-1',
        threadId: 'thread-1',
        snippet: 'snippet',
        subject: 'subject',
        from: 'from@example.com',
        date: '2026-01-01T00:00:00Z',
        body: '',
        read: false,
        ...overrides,
    };
}

describe('LRUMessageCache', () => {
    describe('basic operations', () => {
        it('adds and retrieves messages', () => {
            const cache = new LRUMessageCache(10);
            const msg = createMsg({ id: 'a' });
            cache.add(msg);
            expect(cache.size).toBe(1);
            expect(cache.get('a')).toBe(msg);
            expect(cache.has('a')).toBe(true);
        });

        it('overwrites existing message on add without changing order', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'a' }));
            cache.add(createMsg({ id: 'a', snippet: 'updated' }));
            expect(cache.size).toBe(1);
            expect(cache.get('a')!.snippet).toBe('updated');
        });

        it('deletes a message', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'a' }));
            expect(cache.delete('a')).toBe(true);
            expect(cache.size).toBe(0);
            expect(cache.has('a')).toBe(false);
        });

        it('delete returns false for non-existent id', () => {
            const cache = new LRUMessageCache(10);
            expect(cache.delete('nonexistent')).toBe(false);
        });

        it('handles empty cache gracefully', () => {
            const cache = new LRUMessageCache(5);
            expect(cache.toArray()).toEqual([]);
            expect(cache.get('x')).toBeUndefined();
            expect(cache.has('x')).toBe(false);
        });
    });

    describe('batch operations', () => {
        it('addBatch inserts multiple messages', () => {
            const cache = new LRUMessageCache(10);
            cache.addBatch([
                createMsg({ id: 'a' }),
                createMsg({ id: 'b' }),
                createMsg({ id: 'c' }),
            ]);
            expect(cache.size).toBe(3);
        });

        it('addBatch deduplicates against existing entries', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'existing' }));
            cache.addBatch([
                createMsg({ id: 'existing', snippet: 'updated' }),
                createMsg({ id: 'new' }),
            ]);
            expect(cache.size).toBe(2);
            expect(cache.get('existing')!.snippet).toBe('updated');
        });

        it('evicts multiple when adding batch exceeds capacity', () => {
            const cache = new LRUMessageCache(3);
            cache.addBatch([
                createMsg({ id: '1' }),
                createMsg({ id: '2' }),
                createMsg({ id: '3' }),
                createMsg({ id: '4' }),
                createMsg({ id: '5' }),
            ]);

            expect(cache.size).toBe(3);
            // Oldest ('1', '2') should be evicted; newest 3 remain ('3', '4', '5')
            expect(cache.has('1')).toBe(false);
            expect(cache.has('2')).toBe(false);
            expect(cache.has('3')).toBe(true);
            expect(cache.has('4')).toBe(true);
            expect(cache.has('5')).toBe(true);
        });
    });

    describe('eviction', () => {
        it('evicts oldest when over capacity', () => {
            const cache = new LRUMessageCache(3);
            cache.add(createMsg({ id: '1' }));
            cache.add(createMsg({ id: '2' }));
            cache.add(createMsg({ id: '3' }));
            cache.add(createMsg({ id: '4' }));

            expect(cache.size).toBe(3);
            expect(cache.has('1')).toBe(false);
            expect(cache.has('2')).toBe(true);
            expect(cache.has('3')).toBe(true);
            expect(cache.has('4')).toBe(true);
        });

        it('evicts in FIFO order — oldest inserted goes first', () => {
            const cache = new LRUMessageCache(2);
            cache.add(createMsg({ id: 'first' }));
            cache.add(createMsg({ id: 'second' }));
            cache.add(createMsg({ id: 'third' }));
            cache.add(createMsg({ id: 'fourth' }));

            expect(cache.has('first')).toBe(false);
            expect(cache.has('second')).toBe(false);
            expect(cache.has('third')).toBe(true);
            expect(cache.has('fourth')).toBe(true);
        });

        it('preserves correct eviction order with updates interleaved', () => {
            const cache = new LRUMessageCache(3);
            cache.add(createMsg({ id: 'A' }));
            cache.add(createMsg({ id: 'B' }));
            cache.add(createMsg({ id: 'C' }));

            // Update A — should NOT change its insertion order
            cache.add(createMsg({ id: 'A', snippet: 'updated A' }));

            // Add D — A has the lowest counter, so it gets evicted
            cache.add(createMsg({ id: 'D' }));

            expect(cache.size).toBe(3);
            expect(cache.has('A')).toBe(false);
            expect(cache.has('B')).toBe(true);
            expect(cache.has('C')).toBe(true);
            expect(cache.has('D')).toBe(true);
        });

        it('evicts many when capacity is 1', () => {
            const cache = new LRUMessageCache(1);
            for (let i = 0; i < 100; i++) {
                cache.add(createMsg({ id: String(i) }));
            }
            expect(cache.size).toBe(1);
            expect(cache.has('99')).toBe(true);
            expect(cache.has('98')).toBe(false);
        });
    });

    describe('toArray ordering', () => {
        it('returns messages sorted newest-first by insertion order', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'oldest' }));
            cache.add(createMsg({ id: 'middle' }));
            cache.add(createMsg({ id: 'newest' }));

            const arr = cache.toArray();
            expect(arr.map(m => m.id)).toEqual(['newest', 'middle', 'oldest']);
        });

        it('toArray excludes evicted messages', () => {
            const cache = new LRUMessageCache(2);
            cache.add(createMsg({ id: '1' }));
            cache.add(createMsg({ id: '2' }));
            cache.add(createMsg({ id: '3' }));

            expect(cache.toArray().map(m => m.id)).toEqual(['3', '2']);
        });

        it('toArray excludes deleted messages', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'a' }));
            cache.add(createMsg({ id: 'b' }));
            cache.add(createMsg({ id: 'c' }));
            cache.delete('b');

            expect(cache.toArray().map(m => m.id)).toEqual(['c', 'a']);
        });
    });

    describe('clear', () => {
        it('removes all messages', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'a' }));
            cache.add(createMsg({ id: 'b' }));
            cache.clear();
            expect(cache.size).toBe(0);
            expect(cache.toArray()).toEqual([]);
        });

        it('resets insertion counter after clear', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'old' }));
            cache.clear();
            cache.add(createMsg({ id: 'new' }));
            cache.add(createMsg({ id: 'newer' }));

            expect(cache.toArray().map(m => m.id)).toEqual(['newer', 'new']);
        });

        it('clear does not reset totalAdded stat', () => {
            const cache = new LRUMessageCache(10);
            cache.add(createMsg({ id: 'a' }));
            cache.add(createMsg({ id: 'b' }));
            cache.clear();
            expect(cache.stats().totalAdded).toBe(2);
        });
    });

    describe('stats', () => {
        it('reports accurate statistics', () => {
            const cache = new LRUMessageCache(2);
            cache.add(createMsg({ id: '1' }));
            cache.add(createMsg({ id: '2' }));
            cache.add(createMsg({ id: '3' })); // evicts '1'
            cache.clear();
            cache.add(createMsg({ id: '4' }));

            const stats = cache.stats();
            expect(stats.size).toBe(1);
            expect(stats.capacity).toBe(2);
            expect(stats.totalAdded).toBe(4);
            expect(stats.totalEvicted).toBe(1);
            expect(stats.resetCount).toBe(1);
        });

        it('stats start at zero', () => {
            const cache = new LRUMessageCache(100);
            const stats = cache.stats();
            expect(stats.size).toBe(0);
            expect(stats.capacity).toBe(100);
            expect(stats.totalAdded).toBe(0);
            expect(stats.totalEvicted).toBe(0);
            expect(stats.resetCount).toBe(0);
        });
    });

    describe('default capacity', () => {
        it('uses 500 as default capacity', () => {
            const cache = new LRUMessageCache();
            expect(cache.capacity).toBe(500);
        });
    });
});
