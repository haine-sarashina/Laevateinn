<script lang="ts">
    import { authStore } from "$lib/stores/authStore.svelte";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import EmailList from "$lib/components/EmailList.svelte";
    import EmailDetail from "$lib/components/EmailDetail.svelte";
    import ComposeEmail from "$lib/components/ComposeEmail.svelte";
    import { safeInvoke } from "$lib/api";
    import { openUrl } from "@tauri-apps/plugin-opener";

    // Initialization is handled by +layout.svelte onMount.
    // This component only renders the mail UI; no duplicate API calls needed.

    let showContent = $derived(authStore.accounts.length > 0);
</script>

<div class="main-content">
    {#if !showContent}
        <div class="empty-inbox">
            <h2>No Accounts</h2>
            <p>Add an email account to get started.</p>
            <button class="add-account-btn" onclick={async () => {
                try {
                    const result = await safeInvoke<{ auth_url: string; state: string }>("start_auth_flow");
                    await openUrl(result.auth_url);
                } catch (e) {
                    emailStore.error = "Auth error: " + e;
                }
            }}>
                Add Google Account
            </button>
        </div>
    {:else if emailStore.isComposing && authStore.activeAccountId}
        <ComposeEmail accountId={authStore.activeAccountId} />
    {:else}
        <div class="email-container">
            <div class="list-panel">
                <div class="search-bar">
                    <input
                        id="email-search-input"
                        type="text"
                        placeholder="Search emails..."
                        bind:value={emailStore.searchQuery}
                        onkeydown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                emailStore.searchMessages(emailStore.searchQuery);
                            }
                        }}
                    />
                    {#if emailStore.isSearching || emailStore.searchQuery}
                        <button
                            class="search-clear-btn"
                            onclick={() => emailStore.clearSearch()}
                            aria-label="Clear search"
                        >&times;</button>
                    {/if}
                </div>

                {#if emailStore.error && !emailStore.isAuthErrorFlag}
                    <div class="error-banner">
                        <span class="error-message">{emailStore.error}</span>
                        <button class="retry-btn" onclick={() => emailStore.refresh()}>Retry</button>
                    </div>
                {/if}

                {#if emailStore.isLoading && emailStore.messages.length === 0}
                    <div class="loading-container">
                        <div class="spinner"></div>
                        <span>Loading emails...</span>
                    </div>
                {:else}
                    <EmailList />
                {/if}
            </div>

            <div class="detail-panel">
                {#if emailStore.isAuthErrorFlag}
                    <div class="detail-error">
                        <div class="detail-error-icon">⚠</div>
                        <p class="detail-error-message">{emailStore.error}</p>
                        <button class="detail-error-btn" onclick={async () => {
                            if (emailStore.reloginCallback) {
                                emailStore.clearError();
                                await emailStore.reloginCallback();
                            }
                        }}>再ログイン</button>
                    </div>
                {:else if emailStore.selectedMessage}
                    <EmailDetail />
                {:else}
                    <div class="detail-welcome">
                        <p>Select a message to read</p>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .main-content {
        flex-grow: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .empty-inbox {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        color: #9ca3af;
    }

    .empty-inbox h2 {
        font-size: 1.5rem;
        color: #f9fafb;
    }

    .add-account-btn {
        padding: 0.75rem 1.5rem;
        background-color: #4285f4;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.875rem;
        font-weight: 500;
    }

    .add-account-btn:hover {
        background-color: #357ae8;
    }

    .email-container {
        flex: 1;
        display: flex;
        overflow: hidden;
        min-height: 0;
    }

    .list-panel {
        width: 420px;
        min-width: 320px;
        max-width: 50%;
        border-right: 1px solid #374151;
        background: #1f2937;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .detail-panel {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        background: #1f2937;
    }

    .error-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        background-color: rgba(185, 28, 28, 0.3);
        color: #fca5a5;
        border-radius: 6px;
        margin: 0.5rem;
        font-size: 0.8125rem;
        flex-shrink: 0;
    }

    .retry-btn {
        background: #b91c1c;
        color: white;
        border: none;
        padding: 0.25rem 0.625rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.75rem;
    }

    .error-message {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        flex: 1;
    }

    .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
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

    .detail-welcome {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: #6b7280;
        font-size: 1rem;
    }

    .detail-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        gap: 1rem;
        color: #fca5a5;
        padding: 2rem;
    }

    .detail-error-icon {
        font-size: 3rem;
        line-height: 1;
    }

    .detail-error-message {
        font-size: 0.9375rem;
        text-align: center;
        max-width: 500px;
        line-height: 1.6;
        word-wrap: break-word;
        margin: 0;
    }

    .detail-error-btn {
        background: #2563eb;
        color: white;
        border: none;
        padding: 0.5rem 1.5rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.875rem;
        font-weight: 500;
        font-family: inherit;
    }

    .detail-error-btn:hover {
        background: #1d4ed8;
    }

    // --- Search bar ---
    .search-bar {
        display: flex;
        align-items: center;
        padding: 0.5rem;
        border-bottom: 1px solid #374151;
        flex-shrink: 0;
        background: #111827;
    }

    .search-bar input {
        flex: 1;
        padding: 0.5rem 0.75rem;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 6px;
        color: #f3f4f6;
        font-size: 0.875rem;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
    }

    .search-bar input:focus {
        border-color: #4285f4;
        box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
    }

    .search-bar input::placeholder {
        color: #6b7280;
    }

    .search-clear-btn {
        margin-left: 0.375rem;
        padding: 0.375rem 0.5rem;
        background: #374151;
        border: none;
        border-radius: 4px;
        color: #9ca3af;
        font-size: 1.125rem;
        line-height: 1;
        cursor: pointer;
        transition: background-color 0.15s;
    }

    .search-clear-btn:hover {
        background: #4b5563;
        color: #f3f4f6;
    }
</style>
