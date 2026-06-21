/**
 * Virtual scroll state returned by createVirtualScroll.
 *
 * Contains the derived values needed to render only the visible items
 * inside a scrollable container of known height with fixed row height.
 */
export interface VirtualScrollState {
    /** Index of the first visible item in the list. */
    startIndex: number;
    /** Index of the last visible item (inclusive) in the list. */
    endIndex: number;
    /** Top padding in pixels to push visible items down to correct scroll position. */
    offsetTop: number;
    /** Bottom padding in pixels to fill remaining space after last visible item. */
    offsetBottom: number;
    /** Total height of the virtual list in pixels (itemCount * rowHeight). */
    totalHeight: number;
    /** Array of { index, top } for each visible item. */
    visibleItems: VisibleItem[];
}

export interface VisibleItem {
    /** Original index in the full item array. */
    index: number;
    /** Absolute Y position (top offset) of this item in pixels. */
    top: number;
}

export interface VirtualScrollOptions {
    /** Number of items in the list. */
    itemCount: number;
    /** Height of a single row in pixels. Default 76. */
    rowHeight?: number;
    /** Extra rows to render above/below viewport as a buffer. Default 5. */
    buffer?: number;
}

/**
 * Compute the virtual scroll state for a given container height and scroll position.
 *
 * This is a pure function — no DOM access, no side effects — making it fully
 * unit-testable. The component calls it on every scroll / resize event.
 */
export function computeVirtualScroll(
    containerHeight: number,
    scrollTop: number,
    options: VirtualScrollOptions,
): VirtualScrollState {
    const { itemCount, rowHeight = 76, buffer = 5 } = options;
    const totalHeight = itemCount * rowHeight;

    if (itemCount === 0) {
        return {
            startIndex: 0,
            endIndex: 0,
            offsetTop: 0,
            offsetBottom: 0,
            totalHeight: 0,
            visibleItems: [],
        };
    }

    // Calculate which items are visible in the current viewport
    const rawStart = Math.floor(scrollTop / rowHeight);
    const visibleCount = Math.ceil(containerHeight / rowHeight);

    const startIndex = Math.max(0, rawStart - buffer);
    const endIndex = Math.min(itemCount - 1, rawStart + visibleCount + buffer - 1);

    const offsetTop = startIndex * rowHeight;
    const offsetBottom = totalHeight - (endIndex + 1) * rowHeight;

    const visibleItems: VisibleItem[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
        visibleItems.push({ index: i, top: offsetTop + (i - startIndex) * rowHeight });
    }

    return {
        startIndex,
        endIndex,
        offsetTop,
        offsetBottom,
        totalHeight,
        visibleItems,
    };
}

/**
 * Create a virtual scroll controller bound to a DOM element.
 *
 * Returns an object with reactive-compatible properties and a cleanup function.
 * Call the returned `update()` method whenever itemCount changes or after scroll.
 *
 * Usage in Svelte 5:
 * ```svelte
 * <script>
 *   const container = $state<HTMLDivElement | null>(null);
 *   let scrollTop = $state(0);
 *   const vs = createVirtualScroll({ getItemCount: () => messages.length });
 *
 *   function onScroll() { scrollTop = (event.target as HTMLDivElement).scrollTop; }
 *
 *   $effect(() => { vs.attach(container); });
 *   $effect(() => { vs.detach(); }, container); // cleanup on unmount
 *
 *   const state = $derived(vs.update(scrollTop));
 * </script>
 * ```
 */
export function createVirtualScroll(config: {
    getItemCount: () => number;
    rowHeight?: number;
    buffer?: number;
}): {
    /** Attach to a scrollable container element. Returns nothing. Call after element is in DOM. */
    attach: (el: HTMLElement | null) => void;
    /** Detach observers and clean up. Call on component destroy. */
    detach: () => void;
    /** Recompute state with current scroll position. Call from $derived or on scroll. */
    update: (scrollTop: number) => VirtualScrollState;
    /** Scroll so that item at the given index is visible. */
    scrollToIndex: (index: number) => void;
} {
    const rowHeight = config.rowHeight ?? 76;
    const buffer = config.buffer ?? 5;

    let container: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let containerHeight = 0;

    const attach = (el: HTMLElement | null): void => {
        detach();
        container = el;
        if (!el) return;

        // Initialize container height from element
        containerHeight = el.clientHeight;

        // Listen to scroll events on the container
        el.addEventListener('scroll', onScroll, { passive: true });

        // Watch for container size changes
        resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                containerHeight = entry.contentRect.height;
            }
        });
        resizeObserver.observe(el);
    };

    const detach = (): void => {
        if (container) {
            container.removeEventListener('scroll', onScroll);
            container = null;
        }
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
    };

    // Scroll handler — read scrollTop and trigger parent re-render via callback mechanism.
    // In Svelte 5, the component reads scroll position from a $state variable it manages.
    const onScroll = (): void => {
        // This is handled by the component reading scrollTop directly;
        // we just expose the container for external reading.
    };

    const update = (scrollTop: number): VirtualScrollState => {
        const height = containerHeight || 400; // fallback to 400px if not measured yet
        const count = config.getItemCount();
        return computeVirtualScroll(height, scrollTop, { itemCount: count, rowHeight, buffer });
    };

    const scrollToIndex = (index: number): void => {
        if (!container) return;
        const targetTop = index * rowHeight;
        // Scroll to make the item visible at the top of the viewport
        container.scrollTop = targetTop;
    };

    return { attach, detach, update, scrollToIndex };
}
