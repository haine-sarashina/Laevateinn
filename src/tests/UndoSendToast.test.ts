import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import UndoSendToast from '../components/UndoSendToast.svelte';

describe('UndoSendToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders with default message', () => {
        const onUndo = vi.fn();
        render(UndoSendToast, { onUndo });
        expect(screen.getByText('Message sent')).toBeTruthy();
        expect(screen.getByRole('button', { name: /undo/i })).toBeTruthy();
    });

    it('renders with custom message', () => {
        const onUndo = vi.fn();
        render(UndoSendToast, { message: 'Draft saved successfully', onUndo });
        expect(screen.getByText('Draft saved successfully')).toBeTruthy();
    });

    it('calls onUndo when undo button is clicked', async () => {
        const onUndo = vi.fn();
        const onTimeout = vi.fn();
        const { container } = render(UndoSendToast, {
            message: 'Message sent',
            onUndo,
            onTimeout,
            duration: 5000,
        });

        const undoButton = screen.getByRole('button', { name: /undo/i });
        undoButton.click();

        // Advance past the 300ms dismiss transition
        await vi.advanceTimersByTimeAsync(350);

        expect(onUndo).toHaveBeenCalledTimes(1);
        // onTimeout should NOT be called when undo is clicked
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('calls onTimeout when duration expires', async () => {
        const onUndo = vi.fn();
        const onTimeout = vi.fn();
        render(UndoSendToast, {
            message: 'Message sent',
            onUndo,
            onTimeout,
            duration: 5000,
        });

        // Advance past the full duration plus the 300ms transition
        await vi.advanceTimersByTimeAsync(5400);

        expect(onTimeout).toHaveBeenCalledTimes(1);
        expect(onUndo).not.toHaveBeenCalled();
    });

    it('does not call onTimeout if undo is clicked before timeout', async () => {
        const onUndo = vi.fn();
        const onTimeout = vi.fn();
        render(UndoSendToast, {
            message: 'Message sent',
            onUndo,
            onTimeout,
            duration: 5000,
        });

        // Click undo well before the timeout
        await vi.advanceTimersByTimeAsync(2000);
        const undoButton = screen.getByRole('button', { name: /undo/i });
        undoButton.click();
        await vi.advanceTimersByTimeAsync(350);

        // Advance past original timeout time
        await vi.advanceTimersByTimeAsync(3000);

        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('shows progress bar that fills over duration', async () => {
        const onUndo = vi.fn();
        render(UndoSendToast, {
            message: 'Message sent',
            onUndo,
            duration: 5000,
        });

        const progressBar = document.querySelector('.progress-fill');
        expect(progressBar).toBeTruthy();

        // Initially progress is near 0%
        const initialWidth = (progressBar as HTMLElement).style.width;
        expect(initialWidth).toBe('0%');

        // Advance halfway through. Svelte 5 applies state changes to the DOM on
        // the next tick, so the timers must be advanced asynchronously.
        await vi.advanceTimersByTimeAsync(2500);
        await tick();

        // Progress should be around 50% (may vary slightly due to interval ticks)
        const midWidth = (progressBar as HTMLElement).style.width;
        expect(parseFloat(midWidth)).toBeCloseTo(50, 0);
    });

    it('has dismiss animation class when timing out', async () => {
        const onUndo = vi.fn();
        const onTimeout = vi.fn();
        render(UndoSendToast, {
            message: 'Message sent',
            onUndo,
            onTimeout,
            duration: 5000,
        });

        const toastEl = document.querySelector('.toast');
        expect(toastEl).toBeTruthy();
        expect(toastEl?.classList.contains('dismissing')).toBe(false);

        // Advance to the timeout
        await vi.advanceTimersByTimeAsync(5000);
        await tick();
        // The dismiss class should be added immediately
        expect(toastEl?.classList.contains('dismissing')).toBe(true);

        // After transition, the callback fires
        await vi.advanceTimersByTimeAsync(350);
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('has alert role for accessibility', () => {
        const onUndo = vi.fn();
        render(UndoSendToast, { onUndo });
        const toastEl = document.querySelector('[role="alert"]');
        expect(toastEl).toBeTruthy();
    });

    it('respects custom duration value', async () => {
        const onUndo = vi.fn();
        const onTimeout = vi.fn();
        render(UndoSendToast, {
            message: 'Message sent',
            onUndo,
            onTimeout,
            duration: 2000,
        });

        // Should NOT have timed out at 3 seconds with a 5s default
        await vi.advanceTimersByTimeAsync(2300);

        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('does not call onUndo or onTimeout before any interaction', async () => {
        const onUndo = vi.fn();
        const onTimeout = vi.fn();
        render(UndoSendToast, {
            message: 'Message sent',
            onUndo,
            onTimeout,
            duration: 10000,
        });

        // Advance some time but well before the timeout
        await vi.advanceTimersByTimeAsync(5000);

        expect(onUndo).not.toHaveBeenCalled();
        expect(onTimeout).not.toHaveBeenCalled();
    });
});
