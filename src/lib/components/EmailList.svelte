<script lang="ts">
    import { untrack } from "svelte";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import { computeVariableVirtualScroll, scrollTopToReveal } from "$lib/utils/virtualScroll";
    import { rowHeights, rowIndexForMessage } from "$lib/messageSections";

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

    // ── Virtual scrolling (variable row heights: headers are shorter) ──
    let container = $state<HTMLElement | null>(null);
    let scrollTop = $state(0);
    let viewportHeight = $state(400);

    const rows = $derived(emailStore.listRows);
    const heights = $derived(rowHeights(rows));
    const vsState = $derived(computeVariableVirtualScroll(viewportHeight, scrollTop, { itemHeights: heights }));

    // Keep the keyboard cursor visible. Only scrolls when the row is actually
    // off-screen, so selecting a visible message never moves the list.
    // Only the cursor is tracked — mail arriving from the poller reshapes
    // `rows`, and that must not scroll the list under the user.
    $effect(() => {
        const cursor = emailStore.listCursorIndex;
        if (cursor < 0) return;
        untrack(() => {
            if (!container) return;
            const rowIndex = rowIndexForMessage(rows, cursor);
            if (rowIndex < 0) return;
            const next = scrollTopToReveal(rowIndex, heights, container.scrollTop, container.clientHeight);
            if (next !== null) {
                container.scrollTop = next;
                scrollTop = next;
            }
        });
    });
</script>

<div class="email-list-view">
    {#if emailStore.hasSelection}
        <div class="bulk-bar">
            <span class="bulk-count">{emailStore.selectedIds.size}件選択中</span>
            <div class="bulk-actions">
                <button title="既読にする" disabled={emailStore.isBulkRunning} onclick={() => emailStore.bulkMarkRead()}>既読</button>
                <button title="未読にする" disabled={emailStore.isBulkRunning} onclick={() => emailStore.bulkMarkUnread()}>未読</button>
                <button title="スターを付ける" disabled={emailStore.isBulkRunning} onclick={() => emailStore.bulkStar()}>★</button>
                <button title="アーカイブ" disabled={emailStore.isBulkRunning} onclick={() => emailStore.bulkArchive()}>📦</button>
                <button class="danger" title="ゴミ箱へ" disabled={emailStore.isBulkRunning} onclick={() => emailStore.bulkTrash()}>🗑</button>
                <button title="選択を解除" disabled={emailStore.isBulkRunning} onclick={() => emailStore.clearSelection()}>×</button>
            </div>
        </div>
    {/if}

    <div
        class="message-list"
        bind:this={container}
        bind:clientHeight={viewportHeight}
        onscroll={(e) => { scrollTop = (e.target as HTMLDivElement).scrollTop; }}
    >
        <!-- Top spacer to push visible items down -->
        <div style="height: {vsState.offsetTop}px"></div>

        <!-- Only render visible rows with absolute positioning -->
        {#each vsState.visibleItems as item (item.index)}
            {@const row = rows[item.index]}
            {#if row?.kind === 'header'}
                <div class="section-header" style="top: {item.top}px">
                    <span class="section-label">{row.label}</span>
                    <span class="section-count">{row.count}</span>
                    {#if row.id === 'section-unread'}
                        <button class="select-all-btn" onclick={() => emailStore.toggleSelectAll()}>
                            すべて選択
                        </button>
                    {/if}
                </div>
            {:else if row?.kind === 'message'}
                {@const message = row.message}
                <div class="message-row" style="top: {item.top}px">
                    <label class="select-box" title="選択">
                        <input
                            type="checkbox"
                            checked={emailStore.isSelected(message.id)}
                            onchange={() => emailStore.toggleSelected(message.id)}
                        />
                    </label>
                    <button
                        class="message-item"
                        class:read={message.read}
                        class:active={emailStore.selectedMessage?.id === message.id}
                        class:cursor={row.messageIndex === emailStore.listCursorIndex}
                        onclick={() => { emailStore.listCursorIndex = row.messageIndex; emailStore.loadMessageDetail(message.id); }}
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
        /* No vertical padding: absolutely positioned rows are offset from the
           padding box, so padding here would desync them from the spacers. */
        padding: 0;
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
        position: absolute;
        left: 0.5rem;
        right: 0.5rem;
    }

    /* Unread / read section headers — heights must match HEADER_ROW_HEIGHT. */
    .section-header {
        position: absolute;
        left: 0.5rem;
        right: 0.5rem;
        height: 30px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0 0.25rem;
        box-sizing: border-box;
    }

    .section-label {
        color: #9ca3af;
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.08em;
    }

    .section-count {
        color: #6b7280;
        font-size: 0.6875rem;
    }

    .select-all-btn {
        margin-left: auto;
        background: none;
        border: none;
        color: #6b7280;
        font-family: inherit;
        font-size: 0.6875rem;
        cursor: pointer;
        padding: 0.125rem 0.25rem;
        border-radius: 4px;
    }

    .select-all-btn:hover {
        color: #93c5fd;
        background: rgba(255, 255, 255, 0.06);
    }

    /* Bulk selection */
    .select-box {
        display: flex;
        align-items: center;
        padding: 0 0.5rem 0 0.25rem;
        cursor: pointer;
        flex-shrink: 0;
    }

    .bulk-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.375rem 0.625rem;
        background: rgba(66, 133, 244, 0.15);
        border-bottom: 1px solid #4285f4;
        flex-shrink: 0;
    }

    .bulk-count {
        font-size: 0.75rem;
        color: #93c5fd;
        font-weight: 600;
    }

    .bulk-actions {
        display: flex;
        gap: 0.25rem;
    }

    .bulk-actions button {
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 4px;
        color: #d1d5db;
        font-family: inherit;
        font-size: 0.75rem;
        padding: 0.1875rem 0.5rem;
        cursor: pointer;
    }

    .bulk-actions button:hover:not(:disabled) {
        background: #374151;
    }

    .bulk-actions button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .bulk-actions button.danger:hover:not(:disabled) {
        color: #f87171;
        border-color: #ef4444;
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
