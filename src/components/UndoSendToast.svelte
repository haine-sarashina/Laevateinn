<script lang="ts">
    let {
        message = "Message sent",
        onUndo,
        onTimeout,
        duration = 5000,
    } = $props<{
        message?: string;
        onUndo: () => void;
        onTimeout?: () => void;
        duration?: number;
    }>();

    let isVisible = $state(true);
    let isDismissing = $state(false);
    let elapsed = $state(0);
    let progressWidth = $derived((elapsed / duration) * 100);

    let timerId: ReturnType<typeof setInterval> | undefined;
    let dismissTimerId: ReturnType<typeof setTimeout> | undefined;

    function dismiss(isTimeout: boolean = false) {
        if (isDismissing) return;
        isDismissing = true;
        clearInterval(timerId);
        clearTimeout(dismissTimerId);
        // Wait for transition to finish before notifying parent
        setTimeout(() => {
            isVisible = false;
            if (isTimeout && onTimeout) {
                onTimeout();
            }
        }, 300);
    }

    function handleUndo() {
        dismiss(false);
        onUndo();
    }

    $effect(() => {
        if (!isVisible) return;

        timerId = setInterval(() => {
            elapsed = Math.min(duration, elapsed + 100);
        }, 100);

        dismissTimerId = setTimeout(() => {
            dismiss(true);
        }, duration);

        return () => {
            clearInterval(timerId);
            clearTimeout(dismissTimerId);
        };
    });
</script>

<div class="toast" class:visible={isVisible} class:dismissing={isDismissing} role="alert">
    <div class="toast-body">
        <span class="toast-message">{message}</span>
        <button class="undo-btn" onclick={handleUndo}>Undo</button>
    </div>
    <div class="progress-bar">
        <div class="progress-fill" style="width: {progressWidth}%"></div>
    </div>
</div>

<style>
    .toast {
        position: fixed;
        bottom: 1.5rem;
        left: 50%;
        transform: translateX(-50%) translateY(0);
        background-color: var(--bg-secondary);
        color: var(--text-primary);
        border-radius: 8px;
        padding: 0.75rem 1.25rem 0.5rem;
        min-width: 280px;
        max-width: 400px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        border: 1px solid var(--border-color);
        font-family: inherit;
        z-index: 9999;
        transition: transform 0.3s ease, opacity 0.3s ease;
    }

    .toast.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }

    .toast.dismissing {
        opacity: 0;
        transform: translateX(-50%) translateY(1rem);
    }

    .toast-body {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 0.375rem;
    }

    .toast-message {
        font-size: 0.875rem;
        font-weight: 500;
    }

    .undo-btn {
        background: none;
        border: none;
        color: #60a5fa;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-family: inherit;
        transition: background-color 0.15s, color 0.15s;
    }

    .undo-btn:hover {
        background-color: rgba(96, 165, 250, 0.15);
        color: #93bbfc;
    }

    .progress-bar {
        height: 2px;
        background-color: var(--border-color);
        border-radius: 1px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background-color: #60a5fa;
        transition: width 0.1s linear;
        border-radius: 1px;
    }
</style>
