<script lang="ts">
    import { authStore } from "$lib/stores/authStore.svelte";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import { safeInvoke } from "$lib/api";

    let { onLogin } = $props<{ onLogin: () => Promise<void> }>();

    // Standard Gmail system labels with icons and Japanese display names
    const LABEL_ICONS: Record<string, { icon: string; name: string }> = {
        INBOX: { icon: '📥', name: '受信トレイ' },
        SENT: { icon: '📤', name: '送信トレイ' },
        DRAFT: { icon: '📝', name: '下書き' },
        STARRED: { icon: '⭐', name: 'スター付き' },
        IMPORTANT: { icon: '🏆', name: '重要' },
        SPAM: { icon: '⚠️', name: 'スパム' },
        TRASH: { icon: '🗑️', name: 'ゴミ箱' },
        CATEGORY_PERSONAL: { icon: '🏠', name: 'プライベート' },
        CATEGORY_SOCIAL: { icon: '👥', name: 'ソーシャル' },
        CATEGORY_PROMOTIONS: { icon: '🎉', name: 'プロモーション' },
        CATEGORY_UPDATES: { icon: '📢', name: 'アップデート' },
        CATEGORY_FORUMS: { icon: '💬', name: 'フォーラム' },
    };

    function getLabelInfo(labelName: string): { icon: string; name: string } {
        return LABEL_ICONS[labelName] ?? { icon: '📂', name: labelName };
    }

    // Labels that Gmail hides from the sidebar
    const HIDDEN_LABELS = new Set(['CHAT', 'YELLOW_STAR', 'UNREAD']);

    async function handleAddAccount() {
        await onLogin();
    }

    async function handleRemoveAccount(id: string) {
        if (confirm(`Are you sure you want to remove account ${id}?`)) {
            await authStore.removeAccount(id);
        }
    }

    async function handleLabelClick(labelId: string | null) {
        await emailStore.selectLabel(labelId);
    }
</script>

<aside class="sidebar">
    <div class="sidebar-header">
        <h3>Accounts</h3>
    </div>

    <nav class="account-list">
        {#if authStore.accounts.length === 0}
            <div class="no-accounts">
                No accounts found
            </div>
        {:else}
            {#each authStore.accounts as account}
                <div class="account-group">
                    <button
                        class="account-item"
                        class:active={authStore.activeAccountId === account.id}
                        onclick={() => authStore.setActiveAccount(account.id)}
                    >
                        {account.name}
                    </button>
                    <button class="remove-account-btn" onclick={() => handleRemoveAccount(account.id)}>
                        ×
                    </button>
                </div>
            {/each}
        {/if}
    </nav>

    <!-- Labels Section -->
    {#if authStore.activeAccountId}
        <div class="labels-section">
            <div class="labels-header">Labels</div>
            <nav class="label-list">
                {#each emailStore.labels as label}
                    {#if label.labelType === 'system' && !HIDDEN_LABELS.has(label.name)}
                        {@const info = getLabelInfo(label.name)}
                        <button
                            class="label-item"
                            class:active={emailStore.currentLabelId === label.id}
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
                    {/if}
                {/each}
            </nav>
        </div>
    {/if}

    <div class="sidebar-footer">
        <button class="add-account-btn" onclick={handleAddAccount}>
            + Add Account
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

    .remove-account-btn {
        background: none;
        border: none;
        color: #ef4444;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
    }

    .remove-account-btn:hover {
        background-color: rgba(255, 0, 0, 0.15);
        border-radius: 4px;
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
        color: #9ca3af;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.5rem 0;
        border-top: 1px solid #374151;
        margin-top: 0.5rem;
    }

    .label-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .label-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
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

    .label-item.active {
        background-color: rgba(66, 133, 244, 0.2);
        color: #93c5fd;
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

    .add-account-btn {
        width: 100%;
        padding: 0.75rem;
        background-color: #16a34a;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-family: inherit;
    }

    .add-account-btn:hover {
        background-color: #15803d;
    }
</style>
