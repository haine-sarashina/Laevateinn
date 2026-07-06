<script lang="ts">
    import { authStore } from "$lib/stores/authStore.svelte";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import EmailList from "$lib/components/EmailList.svelte";
    import EmailDetail from "$lib/components/EmailDetail.svelte";
    import ComposeEmail from "$lib/components/ComposeEmail.svelte";
    import { safeInvoke, startOAuthFlow } from "$lib/api";
    import { openUrl } from "@tauri-apps/plugin-opener";
    import { buildSearchQuery } from "$lib/searchOperators";

    // --- Advanced search panel state ---
    let showAdvancedSearch = $state(false);
    let advFrom = $state('');
    let advTo = $state('');
    let advSubject = $state('');
    let advHasAttachment = $state(false);
    let advStarred = $state(false);
    let advAfterDate = $state('');
    let advBeforeDate = $state('');

    // Initialization is handled by +layout.svelte onMount.
    // This component only renders the mail UI; no duplicate API calls needed.

    let showContent = $derived(authStore.accounts.length > 0);

    // Handle OAuth flow with proper error handling
    async function handleAddAccount() {
        try {
            console.log("Starting OAuth flow...");
            const result = await startOAuthFlow();
            console.log("OAuth URL received:", result.auth_url);
            await openUrl(result.auth_url);
        } catch (e) {
            console.error("Auth error:", e);
            emailStore.error = "認証エラー: " + (e.message || e);
        }
    }
</script>

<div class="main-content">
    {#if !showContent}
        <div class="empty-inbox">
            <h2>No Accounts</h2>
            <p>Add an email account to get started.</p>
            <button class="add-account-btn" onclick={handleAddAccount}>
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
                        oninput={() => emailStore.updateSuggestions(emailStore.searchQuery)}
                        onkeydown={(e) => {
                            if (emailStore.showSuggestions) {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    emailStore.moveSuggestionCursor(1);
                                    return;
                                }
                                if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    emailStore.moveSuggestionCursor(-1);
                                    return;
                                }
                                if (e.key === 'Escape') {
                                    emailStore.clearSuggestions();
                                    return;
                                }
                            }
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (emailStore.showSuggestions) {
                                    const selected = emailStore.acceptSuggestion();
                                    if (selected) {
                                        emailStore.searchQuery = selected;
                                        emailStore.clearSuggestions();
                                    }
                                }
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
                    <button
                        class="search-advanced-btn"
                        class:active={showAdvancedSearch}
                        onclick={() => showAdvancedSearch = !showAdvancedSearch}
                        aria-label="Toggle advanced search"
                        title="Advanced search"
                    >⚙</button>
                </div>

                {#if showAdvancedSearch}
                <div class="advanced-search-panel">
                    <div class="adv-row">
                        <label for="adv-from">From</label>
                        <input id="adv-from" type="text" bind:value={advFrom} placeholder="Sender" />
                    </div>
                    <div class="adv-row">
                        <label for="adv-to">To</label>
                        <input id="adv-to" type="text" bind:value={advTo} placeholder="Recipient" />
                    </div>
                    <div class="adv-row">
                        <label for="adv-subject">Subject</label>
                        <input id="adv-subject" type="text" bind:value={advSubject} placeholder="Keywords" />
                    </div>
                    <div class="adv-row">
                        <label for="adv-after">After</label>
                        <input id="adv-after" type="date" bind:value={advAfterDate} />
                    </div>
                    <div class="adv-row">
                        <label for="adv-before">Before</label>
                        <input id="adv-before" type="date" bind:value={advBeforeDate} />
                    </div>
                    <div class="adv-row adv-checkboxes">
                        <label><input type="checkbox" bind:checked={advHasAttachment} /> Attachments</label>
                        <label><input type="checkbox" bind:checked={advStarred} /> Starred</label>
                    </div>
                    <div class="adv-actions">
                        <button class="adv-search-btn" onclick={() => {
                            const q = buildSearchQuery({
                                from: advFrom,
                                to: advTo,
                                subject: advSubject,
                                hasAttachment: advHasAttachment,
                                starred: advStarred,
                                afterDate: advAfterDate,
                                beforeDate: advBeforeDate,
                            });
                            emailStore.searchMessages(q);
                            showAdvancedSearch = false;
                        }}>Search</button>
                        <button class="adv-clear-btn" onclick={() => {
                            advFrom = '';
                            advTo = '';
                            advSubject = '';
                            advHasAttachment = false;
                            advStarred = false;
                            advAfterDate = '';
                            advBeforeDate = '';
                            showAdvancedSearch = false;
                        }}>Clear</button>
                    </div>
                </div>
                {/if}

                <!-- Search suggestions dropdown -->
                {#if emailStore.showSuggestions && emailStore.suggestions.length > 0}
                <ul class="suggestions-dropdown" role="listbox">
                    {#each emailStore.suggestions as suggestion, i}
                        <li
                            class="suggestion-item"
                            class:active={i === emailStore.suggestionCursorIndex}
                            role="option"
                            aria-selected={i === emailStore.suggestionCursorIndex}
                            onclick={() => emailStore.selectSuggestion(i)}
                            onmouseenter={() => emailStore.suggestionCursorIndex = i}
                            onkeydown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    emailStore.selectSuggestion(i);
                                }
                            }}
                        >
                            <span class="suggestion-text">{suggestion.text}</span>
                            {#if suggestion.kind === 'operator'}
                                <span class="suggestion-description">{suggestion.description}</span>
                            {/if}
                        </li>
                    {/each}
                </ul>
                {/if}

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

    /* --- Search bar --- */
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

    .search-advanced-btn {
        margin-left: 0.375rem;
        padding: 0.375rem 0.5rem;
        background: #374151;
        border: none;
        border-radius: 4px;
        color: #9ca3af;
        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
        transition: background-color 0.15s, color 0.15s;
    }

    .search-advanced-btn:hover {
        background: #4b5563;
        color: #f3f4f6;
    }

    .search-advanced-btn.active {
        background: #4285f4;
        color: white;
    }

    /* --- Advanced search panel --- */
    .advanced-search-panel {
        padding: 0.75rem;
        background: #111827;
        border-bottom: 1px solid #374151;
        flex-shrink: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    .adv-row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        flex: 1 1 auto;
        min-width: 180px;
    }

    .adv-row label {
        font-size: 0.75rem;
        color: #9ca3af;
        min-width: 4em;
        text-align: right;
    }

    .adv-row input[type="text"],
    .adv-row input[type="date"] {
        flex: 1;
        padding: 0.3rem 0.5rem;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 4px;
        color: #f3f4f6;
        font-size: 0.8125rem;
        font-family: inherit;
        outline: none;
    }

    .adv-row input:focus {
        border-color: #4285f4;
    }

    .adv-checkboxes {
        flex: 1 1 100%;
        justify-content: flex-start;
        gap: 1.25rem;
    }

    .adv-checkboxes label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        min-width: auto;
        text-align: left;
        font-size: 0.8125rem;
        color: #d1d5db;
        cursor: pointer;
    }

    .adv-actions {
        flex-basis: 100%;
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 0.25rem;
    }

    .adv-search-btn {
        padding: 0.375rem 1rem;
        background: #4285f4;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8125rem;
        font-family: inherit;
        font-weight: 500;
    }

    .adv-search-btn:hover {
        background: #357ae8;
    }

    .adv-clear-btn {
        padding: 0.375rem 1rem;
        background: #374151;
        color: #d1d5db;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8125rem;
        font-family: inherit;
    }

    .adv-clear-btn:hover {
        background: #4b5563;
    }

    /* --- Search suggestions dropdown --- */
    .suggestions-dropdown {
        list-style: none;
        margin: 0;
        padding: 0.25rem 0;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 6px;
        max-height: 240px;
        overflow-y: auto;
        position: absolute;
        top: 100%;
        left: 0.5rem;
        right: 0.5rem;
        z-index: 50;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .suggestion-item {
        padding: 0.5rem 0.75rem;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        transition: background-color 0.1s;
    }

    .suggestion-item:hover,
    .suggestion-item.active {
        background: #374151;
    }

    .suggestion-text {
        color: #f3f4f6;
        font-size: 0.875rem;
        font-family: inherit;
    }

    .suggestion-description {
        color: #6b7280;
        font-size: 0.75rem;
    }

    /* Scrollbar styling for dropdown */
    .suggestions-dropdown::-webkit-scrollbar {
        width: 6px;
    }

    .suggestions-dropdown::-webkit-scrollbar-track {
        background: transparent;
    }

    .suggestions-dropdown::-webkit-scrollbar-thumb {
        background-color: #4b5563;
        border-radius: 3px;
    }

    /* Make list-panel relative for absolute positioning of dropdown */
    .list-panel {
        position: relative;
    }
</style>
