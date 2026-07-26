<script lang="ts">
    import { authStore } from "$lib/stores/authStore.svelte";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import { settingsStore } from "$lib/stores/settingsStore.svelte";
    import { POLL_INTERVAL_CHOICES, UNDO_SEND_CHOICES } from "$lib/settings";
    import { getLabelInfo, selectableLabels } from "$lib/labels";

    let { onAddAccount } = $props<{ onAddAccount: () => Promise<void> }>();

    const accounts = $derived(settingsStore.orderedAccounts(authStore.accounts));

    // The account being configured on the per-account tab. Falls back to the
    // active account when nothing was picked explicitly.
    const editingId = $derived(
        settingsStore.editingAccountId && accounts.some(a => a.id === settingsStore.editingAccountId)
            ? settingsStore.editingAccountId
            : authStore.activeAccountId,
    );

    // Labels can only be listed for the account currently signed in to the
    // Gmail API — emailStore holds labels for the active account only.
    const editableLabels = $derived(
        editingId === authStore.activeAccountId
            ? settingsStore.orderedLabels(editingId ?? '', selectableLabels(emailStore.labels))
            : [],
    );

    async function handleRemove(id: string) {
        if (!confirm(`アカウント ${id} を削除しますか？`)) return;
        await authStore.removeAccount(id);
        settingsStore.pruneAccounts(authStore.accounts.map(a => a.id));
    }

    function handlePollChange(value: string) {
        const sec = Number(value);
        settingsStore.setPollIntervalSec(sec);
        emailStore.startPolling(sec * 1000);
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="settings-overlay" onclick={() => settingsStore.close()}>
    <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="設定" tabindex="-1" onclick={(e) => e.stopPropagation()}>
        <div class="settings-header">
            <h2>設定</h2>
            <button class="close-btn" onclick={() => settingsStore.close()} aria-label="閉じる">×</button>
        </div>

        <div class="settings-tabs">
            <button class="tab" class:active={settingsStore.tab === 'app'} onclick={() => settingsStore.tab = 'app'}>
                アプリ全体
            </button>
            <button class="tab" class:active={settingsStore.tab === 'account'} onclick={() => settingsStore.tab = 'account'}>
                アカウント別
            </button>
        </div>

        <div class="settings-body">
            {#if settingsStore.tab === 'app'}
                <section class="settings-section">
                    <h3>新着メールの確認</h3>
                    <label class="field">
                        <span class="field-label">確認間隔</span>
                        <select
                            value={String(settingsStore.pollIntervalSec)}
                            onchange={(e) => handlePollChange((e.currentTarget as HTMLSelectElement).value)}
                        >
                            {#each POLL_INTERVAL_CHOICES as choice}
                                <option value={String(choice.value)}>{choice.label}</option>
                            {/each}
                        </select>
                    </label>
                </section>

                <section class="settings-section">
                    <h3>送信の取り消し</h3>
                    <label class="field">
                        <span class="field-label">猶予期間</span>
                        <select
                            value={String(settingsStore.undoSendSec)}
                            onchange={(e) => settingsStore.setUndoSendSec(Number((e.currentTarget as HTMLSelectElement).value))}
                        >
                            {#each UNDO_SEND_CHOICES as choice}
                                <option value={String(choice.value)}>{choice.label}</option>
                            {/each}
                        </select>
                    </label>
                    <p class="field-note">
                        送信後この時間だけ取り消せます。何もしなければ送信は確定します。
                    </p>
                </section>

                <section class="settings-section">
                    <h3>アカウント</h3>
                    {#if accounts.length === 0}
                        <p class="empty-note">アカウントがありません</p>
                    {:else}
                        <ul class="settings-list">
                            {#each accounts as account, i (account.id)}
                                <li class="settings-row">
                                    <span class="row-title">{account.name}</span>
                                    <div class="row-actions">
                                        <button
                                            class="icon-btn"
                                            title="上へ"
                                            disabled={i === 0}
                                            onclick={() => settingsStore.moveAccount(authStore.accounts, account.id, -1)}
                                        >↑</button>
                                        <button
                                            class="icon-btn"
                                            title="下へ"
                                            disabled={i === accounts.length - 1}
                                            onclick={() => settingsStore.moveAccount(authStore.accounts, account.id, 1)}
                                        >↓</button>
                                        <button
                                            class="icon-btn danger"
                                            title="削除"
                                            onclick={() => handleRemove(account.id)}
                                        >削除</button>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    <button class="primary-btn" onclick={onAddAccount}>＋ アカウントを追加</button>
                </section>
            {:else}
                <section class="settings-section">
                    <h3>対象アカウント</h3>
                    {#if accounts.length === 0}
                        <p class="empty-note">アカウントがありません</p>
                    {:else}
                        <label class="field">
                            <span class="field-label">アカウント</span>
                            <select
                                value={editingId ?? ''}
                                onchange={(e) => settingsStore.editingAccountId = (e.currentTarget as HTMLSelectElement).value}
                            >
                                {#each accounts as account (account.id)}
                                    <option value={account.id}>{account.name}</option>
                                {/each}
                            </select>
                        </label>
                    {/if}
                </section>

                <section class="settings-section">
                    <h3>ラベルの表示・並び順</h3>
                    {#if editingId !== authStore.activeAccountId}
                        <p class="empty-note">
                            ラベルを編集するには、このアカウントに切り替えてください。
                        </p>
                    {:else if editableLabels.length === 0}
                        <p class="empty-note">ラベルがありません</p>
                    {:else}
                        <ul class="settings-list">
                            {#each editableLabels as label, i (label.id)}
                                {@const info = getLabelInfo(label.name)}
                                <li class="settings-row">
                                    <label class="row-toggle">
                                        <input
                                            type="checkbox"
                                            checked={!settingsStore.isLabelHidden(editingId ?? '', label.id)}
                                            onchange={() => settingsStore.toggleLabelHidden(editingId ?? '', label.id)}
                                        />
                                        <span class="row-icon">{info.icon}</span>
                                        <span class="row-title">{info.name}</span>
                                    </label>
                                    <div class="row-actions">
                                        <button
                                            class="icon-btn"
                                            title="上へ"
                                            disabled={i === 0}
                                            onclick={() => settingsStore.moveLabel(editingId ?? '', selectableLabels(emailStore.labels), label.id, -1)}
                                        >↑</button>
                                        <button
                                            class="icon-btn"
                                            title="下へ"
                                            disabled={i === editableLabels.length - 1}
                                            onclick={() => settingsStore.moveLabel(editingId ?? '', selectableLabels(emailStore.labels), label.id, 1)}
                                        >↓</button>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </section>
            {/if}
        </div>
    </div>
</div>

<style>
    .settings-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }

    .settings-dialog {
        width: min(560px, 90vw);
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary, #1f2937);
        border: 1px solid var(--border-color, #374151);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
        overflow: hidden;
    }

    .settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid var(--border-color, #374151);
        background: var(--bg-secondary, #111827);
    }

    .settings-header h2 {
        font-size: 1rem;
        color: var(--text-primary, #e5e7eb);
        margin: 0;
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--text-secondary, #d1d5db);
        font-size: 1.25rem;
        line-height: 1;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
    }

    .close-btn:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .settings-tabs {
        display: flex;
        gap: 0.25rem;
        padding: 0.5rem 1rem 0;
        border-bottom: 1px solid var(--border-color, #374151);
        background: var(--bg-secondary, #111827);
    }

    .tab {
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--text-secondary, #d1d5db);
        font-family: inherit;
        font-size: 0.8125rem;
        padding: 0.5rem 0.875rem;
        cursor: pointer;
    }

    .tab:hover {
        color: var(--text-primary, #e5e7eb);
    }

    .tab.active {
        color: #93c5fd;
        border-bottom-color: #4285f4;
    }

    .settings-body {
        padding: 1rem 1.25rem 1.25rem;
        overflow-y: auto;
    }

    .settings-body::-webkit-scrollbar {
        width: 6px;
    }

    .settings-body::-webkit-scrollbar-track {
        background: transparent;
    }

    .settings-body::-webkit-scrollbar-thumb {
        background-color: #4b5563;
        border-radius: 3px;
    }

    .settings-section {
        margin-bottom: 1.5rem;
    }

    .settings-section h3 {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #9ca3af;
        margin: 0 0 0.625rem 0;
    }

    .field {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .field-label {
        font-size: 0.8125rem;
        color: var(--text-secondary, #d1d5db);
        min-width: 6em;
    }

    select {
        flex: 1;
        padding: 0.375rem 0.5rem;
        background: var(--bg-secondary, #111827);
        border: 1px solid var(--border-color, #374151);
        border-radius: 6px;
        color: var(--text-primary, #e5e7eb);
        font-family: inherit;
        font-size: 0.8125rem;
    }

    .settings-list {
        list-style: none;
        margin: 0 0 0.75rem 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.5rem 0.625rem;
        background: var(--bg-secondary, #111827);
        border: 1px solid var(--border-color, #374151);
        border-radius: 6px;
    }

    .row-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
        cursor: pointer;
    }

    .row-icon {
        flex-shrink: 0;
    }

    .row-title {
        font-size: 0.8125rem;
        color: var(--text-primary, #e5e7eb);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .row-actions {
        display: flex;
        gap: 0.25rem;
        flex-shrink: 0;
    }

    .icon-btn {
        background: none;
        border: 1px solid var(--border-color, #374151);
        border-radius: 4px;
        color: var(--text-secondary, #d1d5db);
        font-family: inherit;
        font-size: 0.75rem;
        padding: 0.1875rem 0.5rem;
        cursor: pointer;
    }

    .icon-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
    }

    .icon-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }

    .icon-btn.danger {
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.4);
    }

    .icon-btn.danger:hover {
        background: rgba(239, 68, 68, 0.15);
    }

    .primary-btn {
        width: 100%;
        padding: 0.5rem;
        background: #16a34a;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.8125rem;
        font-weight: 600;
    }

    .primary-btn:hover {
        background: #15803d;
    }

    .field-note {
        font-size: 0.75rem;
        color: #9ca3af;
        margin: 0.5rem 0 0 0;
        line-height: 1.5;
    }

    .empty-note {
        font-size: 0.8125rem;
        color: #9ca3af;
        font-style: italic;
        margin: 0 0 0.625rem 0;
    }
</style>
