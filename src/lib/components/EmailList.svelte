<script lang="ts">
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import { createVirtualScroll } from "$lib/utils/virtualScroll";

    const VIRTUAL_ROW_HEIGHT = 76;

    async function loadMore() {
        await emailStore.loadMoreMessages();
    }

    function formatDate(dateStr: string): string {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (isNaN(diffMs)) {
            return '';
        }

        if (diffDays === 0) {
            return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return date.toLocaleDateString('ja-JP', { weekday: 'short' });
        } else {
            return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
        }
    }

    function formatSender(from: string): string {
        const match = from.match(/^[^<]+/);
        return match ? match[0].trim() : from;
    }

    function truncate(text: string, maxLen: number): string {
        return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
    }

    // ── Virtual scrolling ──────────────────────────────────────
    let container = $state<HTMLElement | null>(null);
    let scrollTop = $state(0);

    const vs = createVirtualScroll({
        getItemCount: () => emailStore.messages.length,
        rowHeight: VIRTUAL_ROW_HEIGHT,
    });

    // Attach when container mounts, cleanup on unmount
    $effect(() => {
        if (container) {
            vs.attach(container);
            return () => vs.detach();
        }
    });

    // Recompute virtual scroll state on every scrollTop or message-count change
    const vsState = $derived(vs.update(scrollTop));

    // Scroll to cursor when it changes (keyboard navigation)
    $effect(() => {
        if (container && emailStore.listCursorIndex >= 0) {
            vs.scrollToIndex(emailStore.listCursorIndex);
        }
    });
</script>

<div class="email-list-view">
    <div
        class="message-list"
        bind:this={container}
        onscroll={(e) => { scrollTop = (e.target as HTMLDivElement).scrollTop; }}
    >
        <!-- Top spacer to push visible items down -->
        <div style="height: {vsState.offsetTop}px"></div>

        <!-- Only render visible items with absolute positioning -->
        {#each vsState.visibleItems as item (item.index)}
            {@const message = emailStore.messages[item.index]}
            {#if message}
                <div
                    class="message-row"
                    style="position: absolute; top: {item.top}px; left: 0; right: 0;"
                >
                    <button
                        class="message-item"
                        class:read={message.read}
                        class:active={emailStore.selectedMessage?.id === message.id}
                        class:cursor={item.index === emailStore.listCursorIndex}
                        onclick={() => { emailStore.listCursorIndex = item.index; emailStore.loadMessageDetail(message.id); }}
                    >
                        <div class="message-header">
                            <span class="sender">{truncate(formatSender(message.from), 25)}</span>
                            <span class="date">{formatDate(message.date)}</span>
                        </div>
                        <div class="message-subject">{message.subject || 'No Subject'}</div>
                        <div class="message-snippet">
                            {message.snippet ? truncate(message.snippet, 80) : 'No preview available'}
                        </div>
                    </button>
                    <button
                        class="star-btn"
                        class:starred={message.starred}
                        title={message.starred ? "Unstar" : "Star"}
                        onclick={(e) => { e.stopPropagation(); emailStore.toggleStar(message.id); }}
                    >
                        {message.starred ? '★' : '☆'}
                    </button>
                </div>
            {/if}
        {/each}

        <!-- Bottom spacer to fill remaining space -->
        <div style="height: {vsState.offsetBottom}px"></div>
    </div>

    {#if emailStore.hasMore}
        <div class="load-more-wrapper">
            <button class="load-more" onclick={loadMore} disabled={emailStore.isMoreLoading || emailStore.isLoading}>
                {#if emailStore.isMoreLoading}
                    <div class="spinner-small"></div>
                    Loading...
                {:else}
                    Load More
                {/if}
            </button>
        </div>
    {/if}
</div>

<style>
    .email-list-view {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .message-list {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0.5rem;
    }

    /* Custom scrollbar styling */
    .message-list::-webkit-scrollbar {
        width: 6px;
    }

    .message-list::-webkit-scrollbar-track {
        background: transparent;
    }

    .message-list::-webkit-scrollbar-thumb {
        background-color: #4b5563;
        border-radius: 3px;
    }

    .message-list::-webkit-scrollbar-thumb:hover {
        background-color: #6b7280;
    }

    .message-item {
        width: 100%;
        text-align: left;
        padding: 0.875rem 1rem;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        font-size: 0.875rem;
        color: #e5e7eb;
        /* Virtual scroll compatibility: fixed height, no margin */
        height: 74px;
        box-sizing: border-box;
    }

    .message-item:hover {
        background-color: #1f2937;
        border-color: #374151;
    }

    .message-item.active {
        background-color: rgba(66, 133, 244, 0.15);
        border-color: #4285f4;
    }

    .message-item.cursor {
        background-color: rgba(66, 133, 244, 0.1);
        border-color: #4285f4;
    }

    .message-item.read {
        opacity: 0.65;
    }

    .message-item:not(.read) {
        font-weight: 600;
    }

    .message-item:not(.read) .sender {
        font-weight: 700;
    }

    .message-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 0.25rem;
    }

    .sender {
        color: #d1d5db;
        font-size: 0.8125rem;
        max-width: 60%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .date {
        color: #6b7280;
        font-size: 0.75rem;
        flex-shrink: 0;
    }

    .message-subject {
        color: #f3f4f6;
        font-size: 0.8125rem;
        margin-bottom: 0.15rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .message-snippet {
        color: #9ca3af;
        font-size: 0.75rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .load-more-wrapper {
        padding: 0.5rem;
        flex-shrink: 0;
    }

    .load-more {
        display: block;
        width: 100%;
        padding: 0.625rem;
        background-color: #374151;
        border: 1px solid #4b5563;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.8125rem;
        color: #d1d5db;
        font-family: inherit;
        transition: background-color 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }

    .load-more:hover:not(:disabled) {
        background-color: #4b5563;
    }

    .load-more:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .spinner-small {
        width: 16px;
        height: 16px;
        border: 2px solid #374151;
        border-top: 2px solid #4285f4;
        border-radius: 50%;
        animation: spin 0.75s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .message-row {
        display: flex;
        align-items: stretch;
    }

    .message-row .message-item {
        flex: 1;
        min-width: 0;
    }

    .star-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 0.75rem;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 1.25rem;
        color: #4b5563;
        transition: all 0.15s ease;
        flex-shrink: 0;
    }

    .star-btn:hover {
        color: #fbbf24;
    }

    .star-btn.starred {
        color: #fbbf24;
    }
</style>
