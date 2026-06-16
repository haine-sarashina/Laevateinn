<script lang="ts">
    import { emailStore } from "$lib/stores/emailStore.svelte";

    let scrollContainer: HTMLElement | null = $state.raw(null);

    $effect(() => {
        if (emailStore.selectedMessage && scrollContainer) {
            scrollContainer.scrollTop = 0;
        }
    });

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function formatSender(from: string): { name: string; email: string } {
        const nameMatch = from.match(/^[^<]*/);
        const emailMatch = from.match(/<([^>]+)>/);
        return {
            name: nameMatch?.[0]?.trim() || '',
            email: emailMatch?.[1] || from,
        };
    }
</script>

{#if emailStore.selectedMessage}
    <div class="email-detail">
        <div class="detail-header">
            <button class="back-btn" onclick={() => emailStore.clearSelectedMessage()}>
                ← Back to List
            </button>
        </div>

        <div class="detail-content" bind:this={scrollContainer}>
            <h1 class="detail-subject">{emailStore.selectedMessage.subject}</h1>

            <div class="detail-meta">
                <div class="meta-sender">
                    {#if emailStore.selectedMessage}
                        {@const sender = formatSender(emailStore.selectedMessage.from)}
                        {#if sender.name}
                            <span class="sender-name">{sender.name}</span>
                            <span class="sender-email">&lt;{sender.email}&gt;</span>
                        {:else}
                            <span class="sender-email">&lt;{sender.email}&gt;</span>
                        {/if}
                    {/if}
                </div>
                <div class="meta-date">{formatDate(emailStore.selectedMessage.date)}</div>
            </div>

            <div class="detail-snippet">
                <strong>Snippet:</strong> {emailStore.selectedMessage.snippet}
            </div>

            <div class="detail-body">
                {#if emailStore.selectedMessage.body}
                    <div class="body-content">
                        {@html emailStore.selectedMessage.body}
                    </div>
                {:else}
                    <p class="no-body">No body content available.</p>
                {/if}
            </div>
        </div>
    </div>
{:else if emailStore.isDetailsLoading}
    <div class="email-detail">
        <div class="detail-header">
            <button class="back-btn" onclick={() => emailStore.clearSelectedMessage()}>
                ← Back to List
            </button>
        </div>
        <div class="loading-container">
            <div class="spinner"></div>
            <span>Loading message...</span>
        </div>
    </div>
{/if}

<style>
    .email-detail {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .detail-header {
        padding: 1rem 2rem;
        border-bottom: 1px solid #374151;
        background: #111827;
        flex-shrink: 0;
    }

    .back-btn {
        background: none;
        border: none;
        color: #60a5fa;
        cursor: pointer;
        font-size: 0.875rem;
        font-family: inherit;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
    }

    .back-btn:hover {
        background-color: rgba(66, 133, 244, 0.15);
    }

    .detail-content {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 1.5rem 2rem;
        background: #1f2937;
    }

    .detail-content::-webkit-scrollbar {
        width: 8px;
    }

    .detail-content::-webkit-scrollbar-track {
        background: transparent;
    }

    .detail-content::-webkit-scrollbar-thumb {
        background-color: #4b5563;
        border-radius: 4px;
    }

    .detail-content::-webkit-scrollbar-thumb:hover {
        background-color: #6b7280;
    }

    .detail-subject {
        font-size: 1.375rem;
        font-weight: 600;
        margin: 0 0 1rem 0;
        color: #f9fafb;
    }

    .detail-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #374151;
    }

    .meta-sender {
        font-size: 0.875rem;
    }

    .sender-name {
        font-weight: 600;
        color: #f9fafb;
    }

    .sender-email {
        color: #9ca3af;
    }

    .meta-date {
        color: #9ca3af;
        font-size: 0.8125rem;
    }

    .detail-snippet {
        padding: 0.75rem 1rem;
        background-color: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        margin-bottom: 1.5rem;
        font-size: 0.8125rem;
        color: #d1d5db;
    }

    .detail-body {
        font-size: 0.875rem;
        line-height: 1.6;
    }

    :global(.body-content) {
        word-break: break-word;
        font-family: inherit;
        font-size: 0.875rem;
        line-height: 1.6;
        max-width: 100%;
        min-height: 0;
        background: #ffffff;
        color: #000000;
    }

    :global(.body-content img) {
        max-width: 100%;
        height: auto;
    }

    :global(.body-content table) {
        max-width: 100%;
    }

    :global(.body-content div),
    :global(.body-content body),
    :global(.body-content *) {
        max-width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
        overflow-x: visible !important;
        overflow-y: visible !important;
    }

    .no-body {
        color: #9ca3af;
        font-style: italic;
    }

    .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem;
        gap: 1rem;
        color: #9ca3af;
    }

    .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid #374151;
        border-top: 3px solid #4285f4;
        border-radius: 50%;
        animation: spin 0.75s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
