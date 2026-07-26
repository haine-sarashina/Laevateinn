import { describe, it, expect } from 'vitest';
import {
    computeVariableVirtualScroll,
    rowOffsets,
    scrollTopToReveal,
} from '$lib/utils/virtualScroll';

describe('rowOffsets', () => {
    it('returns a prefix sum with the total as the last entry', () => {
        expect(rowOffsets([30, 76, 76])).toEqual([0, 30, 106, 182]);
    });

    it('handles an empty list', () => {
        expect(rowOffsets([])).toEqual([0]);
    });
});

describe('computeVariableVirtualScroll', () => {
    const heights = (n: number, h = 76) => new Array(n).fill(h);

    it('returns an empty state for no rows', () => {
        const state = computeVariableVirtualScroll(400, 0, { itemHeights: [] });
        expect(state.visibleItems).toEqual([]);
        expect(state.totalHeight).toBe(0);
        expect(state.offsetTop).toBe(0);
        expect(state.offsetBottom).toBe(0);
    });

    it('computes total height from mixed row heights', () => {
        const state = computeVariableVirtualScroll(400, 0, { itemHeights: [30, 76, 76, 30, 76] });
        expect(state.totalHeight).toBe(288);
    });

    it('positions rows at their prefix-sum offsets', () => {
        const state = computeVariableVirtualScroll(200, 0, { itemHeights: [30, 76, 76], buffer: 0 });
        expect(state.visibleItems.map(i => i.top)).toEqual([0, 30, 106]);
    });

    it('spacers plus rendered rows always add up to the total height', () => {
        const itemHeights = [30, ...heights(40), 30, ...heights(40)];
        const state = computeVariableVirtualScroll(400, 900, { itemHeights });
        const renderedSpan =
            state.visibleItems[state.visibleItems.length - 1].top +
            itemHeights[state.endIndex] -
            state.offsetTop;
        expect(state.offsetTop + renderedSpan + state.offsetBottom).toBe(state.totalHeight);
    });

    it('skips rows scrolled past above the viewport', () => {
        const state = computeVariableVirtualScroll(200, 500, { itemHeights: heights(30), buffer: 0 });
        expect(state.startIndex).toBe(6); // floor(500 / 76) = 6
        expect(state.visibleItems[0].index).toBe(6);
    });

    it('renders buffer rows around the viewport', () => {
        const noBuffer = computeVariableVirtualScroll(200, 500, { itemHeights: heights(30), buffer: 0 });
        const buffered = computeVariableVirtualScroll(200, 500, { itemHeights: heights(30), buffer: 3 });
        expect(buffered.startIndex).toBe(noBuffer.startIndex - 3);
        expect(buffered.endIndex).toBe(noBuffer.endIndex + 3);
    });

    it('clamps to the list bounds at the end of the list', () => {
        const state = computeVariableVirtualScroll(400, 100_000, { itemHeights: heights(10) });
        expect(state.endIndex).toBe(9);
        expect(state.offsetBottom).toBe(0);
    });
});

describe('scrollTopToReveal', () => {
    const heights = [76, 76, 76, 76, 76, 76, 76, 76, 76, 76];

    it('returns null when the row is already fully visible', () => {
        // Rows 0-2 are visible in a 300px viewport at scrollTop 0
        expect(scrollTopToReveal(0, heights, 0, 300)).toBeNull();
        expect(scrollTopToReveal(2, heights, 0, 300)).toBeNull();
    });

    it('scrolls up by the minimum amount for a row above the viewport', () => {
        expect(scrollTopToReveal(1, heights, 300, 300)).toBe(76);
    });

    it('scrolls down by the minimum amount for a row below the viewport', () => {
        // Row 4 ends at 380; viewport is 0-300, so scrollTop becomes 80
        expect(scrollTopToReveal(4, heights, 0, 300)).toBe(80);
    });

    it('never returns a negative scroll position', () => {
        expect(scrollTopToReveal(0, [500], 0, 100)).toBe(0);
    });

    it('returns null for an out-of-range index', () => {
        expect(scrollTopToReveal(-1, heights, 0, 300)).toBeNull();
        expect(scrollTopToReveal(99, heights, 0, 300)).toBeNull();
    });

    it('accounts for short header rows when computing positions', () => {
        const mixed = [30, 76, 30, 76];
        // Row 3 spans 136-212; a 100px viewport at 0 must scroll to 112
        expect(scrollTopToReveal(3, mixed, 0, 100)).toBe(112);
    });
});
