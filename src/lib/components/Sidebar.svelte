<script lang="ts">
    import { authStore } from "$lib/stores/authStore.svelte";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import { settingsStore } from "$lib/stores/settingsStore.svelte";
    import { getLabelInfo, selectableLabels } from "$lib/labels";

    // Accounts and labels honour the order / visibility chosen in the settings screen.
    const accounts = $derived(settingsStore.orderedAccounts(authStore.accounts));
    const labels = $derived(
        settingsStore.sidebarLabels(authStore.activeAccountId, selectableLabels(emailStore.labels)),
    );

    async function handleLabelClick(labelId: string | null) {
        await emailStore.selectLabel(labelId);
    }
</script>

<aside class="sidebar">
    <div class="sidebar-header">
        <h3>Accounts</h3>
    </div>

    <nav class="account-list">
        {#if accounts.length === 0}
            <div class="no-accounts">
                No accounts found
            </div>
        {:else}
            {#each accounts as account (account.id)}
                <div class="account-group">
                    <button
                        class="account-item"
                        class:active={authStore.activeAccountId === account.id}
                        onclick={() => authStore.setActiveAccount(account.id)}
                    >
                        {account.name}
                    </button>
                </div>
            {/each}
        {/if}
    </nav>

    <!-- Labels Section -->
    {#if authStore.activeAccountId}
        <div class="labels-section">
            <div class="labels-header">
                <span>Labels</span>
                <button
                    class="labels-settings-btn"
                    title="ラベルの表示・並び順を設定"
                    onclick={() => settingsStore.open('account', authStore.activeAccountId)}
                >⚙</button>
            </div>
            <nav class="label-list">
                {#each labels as label (label.id)}
                    {@const info = getLabelInfo(label.name)}
                    <button
                        class="label-item"
                        class:active={emailStore.currentLabelId === label.id}
                        aria-current={emailStore.currentLabelId === label.id ? 'true' : undefined}
                        onclick={() => handleLabelClick(label.id)}
                    >
                        <span class="label-icon">{info.icon}</span>
                        <span class="label-name" class:truncated={info.name.length > 18}>
                            {info.name}
                        </span>
                        {#if label.messagesUnread > 0}
                            <span class="unread-badge">{label.messagesUnread}</span>
                        {/if}
                    </button>
                {/each}
            </nav>
        </div>
    {/if}

    <div class="sidebar-footer">
        {#if authStore.activeAccountId}
            <button class="compose-btn" onclick={() => emailStore.startComposing()}>
                Compose New Message
            </button>
        {/if}
        <button class="settings-btn" onclick={() => settingsStore.open('app')}>
            ⚙ 設定
        </button>
    </div>
</aside>

<style>
    .sidebar {
        width: 280px;
        height: 100%;
        border-right: 1px solid #374151;
        display: flex;
        flex-direction: column;
        background-color: #111827;
        padding: 1rem;
        box-sizing: border-box;
    }

    .sidebar-header {
        margin-bottom: 1rem;
        text-align: left;
    }

    .sidebar-header h3 {
        color: #e5e7eb;
        font-size: 1.125rem;
    }

    .account-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .account-group {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .account-item {
        flex-grow: 1;
        padding: 0.75rem;
        text-align: left;
        background: none;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: background-color 0.2s;
        color: #d1d5db;
        font-family: inherit;
        font-size: 0.875rem;
    }

    .account-item:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .account-item.active {
        background-color: #4285f4;
        color: white;
    }

    .no-accounts {
        padding: 1rem;
        font-size: 0.875rem;
        color: #9ca3af;
        font-style: italic;
        text-align: center;
    }

    /* Labels Section */
    .labels-section {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        margin-bottom: 0.5rem;
        overflow: hidden;
    }

    .labels-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #9ca3af;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.5rem 0;
        border-top: 1px solid #374151;
        margin-top: 0.5rem;
    }

    .labels-settings-btn {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 0.875rem;
        line-height: 1;
        cursor: pointer;
        padding: 0.125rem 0.25rem;
        border-radius: 4px;
    }

    .labels-settings-btn:hover {
        background-color: rgba(255, 255, 255, 0.08);
        color: #e5e7eb;
    }

    .label-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    /* Scrollbar matches the message list's (6px, same thumb colours) */
    .label-list::-webkit-scrollbar {
        width: 6px;
    }

    .label-list::-webkit-scrollbar-track {
        background: transparent;
    }

    .label-list::-webkit-scrollbar-thumb {
        background-color: #4b5563;
        border-radius: 3px;
    }

    .label-list::-webkit-scrollbar-thumb:hover {
        background-color: #6b7280;
    }

    .label-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
        border-left: 3px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        transition: background-color 0.15s;
        color: #d1d5db;
        font-family: inherit;
        font-size: 0.8125rem;
        text-align: left;
        width: 100%;
    }

    .label-item:hover {
        background-color: rgba(255, 255, 255, 0.08);
    }

    /* Selected label: accent bar + filled background + bold text */
    .label-item.active {
        background-color: rgba(66, 133, 244, 0.28);
        border-left-color: #4285f4;
        border-radius: 0 8px 8px 0;
        color: #ffffff;
        font-weight: 700;
    }

    .label-item.active .label-icon {
        filter: drop-shadow(0 0 2px rgba(66, 133, 244, 0.9));
    }

    .label-icon {
        font-size: 1rem;
        flex-shrink: 0;
    }

    .label-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .label-name.truncated {
        max-width: 140px;
    }

    .unread-badge {
        background-color: #ef4444;
        color: white;
        font-size: 0.6875rem;
        font-weight: 700;
        padding: 0.125rem 0.375rem;
        border-radius: 999px;
        min-width: 1.25rem;
        text-align: center;
        flex-shrink: 0;
    }

    .sidebar-footer {
        padding-top: 1rem;
        border-top: 1px solid #374151;
        flex-shrink: 0;
    }

    .settings-btn {
        width: 100%;
        padding: 0.75rem;
        background-color: #374151;
        color: #e5e7eb;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-family: inherit;
    }

    .settings-btn:hover {
        background-color: #4b5563;
    }

    .compose-btn {
        width: 100%;
        padding: 0.75rem;
        background-color: #4285f4;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-family: inherit;
        margin-bottom: 0.5rem;
    }

    .compose-btn:hover {
        background-color: #357ae8;
    }
</style>
