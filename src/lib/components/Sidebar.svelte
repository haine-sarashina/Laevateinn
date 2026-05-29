<script lang="ts">
    import { authStore } from "$lib/stores/authStore.svelte";
    import { safeInvoke } from "$lib/api";

    let { onLogin } = $props<{ onLogin: () => Promise<void> }>();

    async function handleAddAccount() {
        await onLogin();
    }

    async function handleRemoveAccount(id: string) {
        if (confirm(`Are you sure you want to remove account ${id}?`)) {
            await authStore.removeAccount(id);
        }
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
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        overflow-y: auto;
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

    .sidebar-footer {
        padding-top: 1rem;
        border-top: 1px solid #374151;
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

    .no-accounts {
        padding: 1rem;
        font-size: 0.875rem;
        color: #9ca3af;
        font-style: italic;
        text-align: center;
    }
</style>
