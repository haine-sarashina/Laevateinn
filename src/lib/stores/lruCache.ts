import type { EmailMessage } from "./emailStore.svelte";

export interface CacheStats {
    /** Current number of messages in the cache. */
    size: number;
    /** Maximum allowed messages before eviction triggers. */
    capacity: number;
    /** Total number of messages ever added (including evicted). */
    totalAdded: number;
    /** Total number of messages evicted due to capacity limit. */
    totalEvicted: number;
    /** Number of times the cache was reset. */
    resetCount: number;
}

/**
 * LRUMessageCache manages email messages with a configurable capacity limit.
 *
 * Uses an insertion-order counter so that appended (older/paginated) entries
 * are evicted first — matching the "load more" pattern where newest pages
 * arrive first and older pages are loaded later.
 */
export class LRUMessageCache {
    private map = new Map<string, EmailMessage>();
    /** Monotonically increasing counter — lower values = older entries. */
    private lruOrder = new Map<string, number>();
    private _counter = 0;
    private totalAdded = 0;
    private totalEvicted = 0;
    private resetCount = 0;

    constructor(public capacity: number = 500) {}

    /** Returns true if the message with this id exists. */
    has(id: string): boolean {
        return this.map.has(id);
    }

    /** Get a message by ID. Does NOT update LRU order — messages are evicted by insertion age, not access recency. */
    get(id: string): EmailMessage | undefined {
        return this.map.get(id);
    }

    /** Add a single message. Evicts oldest if capacity exceeded. */
    add(msg: EmailMessage): void {
        const isUpdate = this.map.has(msg.id);
        if (!isUpdate) {
            this._counter++;
            this.lruOrder.set(msg.id, this._counter);
            this.totalAdded++;
        }
        this.map.set(msg.id, msg);
        this.evictIfOverCapacity();
    }

    /** Add multiple messages. Evicts oldest if capacity exceeded. */
    addBatch(messages: EmailMessage[]): void {
        for (const msg of messages) {
            const isUpdate = this.map.has(msg.id);
            if (!isUpdate) {
                this._counter++;
                this.lruOrder.set(msg.id, this._counter);
                this.totalAdded++;
            }
            this.map.set(msg.id, msg);
        }
        this.evictIfOverCapacity();
    }

    /** Remove a message by ID. */
    delete(id: string): boolean {
        const removed = this.map.delete(id);
        if (removed) {
            this.lruOrder.delete(id);
        }
        return removed;
    }

    /** Clear all messages and reset insertion counter. */
    clear(): void {
        this.map.clear();
        this.lruOrder.clear();
        this._counter = 0;
        this.resetCount++;
    }

    /** Returns the current number of messages. */
    get size(): number {
        return this.map.size;
    }

    /**
     * Returns all messages as an array, sorted by insertion order descending
     * (newest inserted = index 0). This matches Gmail's expected display order.
     */
    toArray(): EmailMessage[] {
        const entries = Array.from(this.lruOrder.entries());
        entries.sort((a, b) => b[1] - a[1]); // descending by counter
        return entries.map(([id]) => this.map.get(id)!).filter(Boolean);
    }

    /** Returns cache statistics for monitoring. */
    stats(): CacheStats {
        return {
            size: this.size,
            capacity: this.capacity,
            totalAdded: this.totalAdded,
            totalEvicted: this.totalEvicted,
            resetCount: this.resetCount,
        };
    }

    /** Evict oldest messages until size <= capacity. */
    private evictIfOverCapacity(): void {
        while (this.map.size > this.capacity) {
            let oldestId: string | null = null;
            let oldestValue = Infinity;
            for (const [id, order] of this.lruOrder.entries()) {
                if (order < oldestValue) {
                    oldestValue = order;
                    oldestId = id;
                }
            }
            if (oldestId !== null) {
                this.map.delete(oldestId);
                this.lruOrder.delete(oldestId);
                this.totalEvicted++;
            } else {
                break;
            }
        }
    }
}
