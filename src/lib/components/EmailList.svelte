<script lang="ts">
    import { emailStore } from "$lib/stores/emailStore.svelte";

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
</script>

<div class="email-list-view">
    <div class="message-list">
        {#each emailStore.messages as message (message.id)}
            <div class="message-row">
                <button
                    class="message-item"
                    class:read={message.read}
                    class:active={emailStore.selectedMessage?.id === message.id}
                    onclick={() => emailStore.loadMessageDetail(message.id)}
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
        {/each}
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
        margin-bottom: 4px;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        font-size: 0.875rem;
        color: #e5e7eb;
    }

    .message-item:hover {
        background-color: #1f2937;
        border-color: #374151;
    }

    .message-item.active {
        background-color: rgba(66, 133, 244, 0.15);
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
