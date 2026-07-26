import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';

const mockedInvoke = (tauriCore.invoke as any) as ReturnType<typeof vi.fn>;

function serverMessage(id: string, date: string, unread = false) {
    return {
        id,
        threadId: `t-${id}`,
        snippet: `snippet ${id}`,
        subject: `subject ${id}`,
        from: `${id}@example.com`,
        date,
        unread,
        starred: false,
        important: false,
    };
}

/** Loads three read messages, newest first: m3, m2, m1. */
async function loadThreeMessages() {
    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({
        messages: [
            serverMessage('m3', '2026-07-08T00:00:00Z'),
            serverMessage('m2', '2026-07-07T00:00:00Z'),
            serverMessage('m1', '2026-07-06T00:00:00Z'),
        ],
        nextPageToken: null,
    });
    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();
    return emailStore;
}

describe('emailStore message actions', () => {
    beforeEach(async () => {
        mockedInvoke.mockReset();
        mockedInvoke.mockResolvedValue(undefined);
        const { authStore } = await import('$lib/stores/authStore.svelte');
        authStore.activeAccountId = 'test@test.com';
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.stopPolling();
        emailStore.reset();
    });

    it('advances the selection to the next message after archiving', async () => {
        const emailStore = await loadThreeMessages();
        emailStore.selectedMessage = { id: 'm3', snippet: '', subject: '', from: '', date: '', body: '' };

        // modify_labels, then get_message_details for the next selection
        mockedInvoke.mockResolvedValueOnce({ success: true, messageId: 'm3' });
        // The detail response overwrites the cached copy, so it must carry the
        // same date the list had — otherwise the row would move.
        mockedInvoke.mockResolvedValueOnce({ id: 'm2', snippet: '', subject: 's2', from: 'f', date: '2026-07-07T00:00:00Z', body: '' });
        mockedInvoke.mockResolvedValue({ success: true, messageId: 'm2' });

        await emailStore.archiveMessage('m3');

        expect(emailStore.messages.map(m => m.id)).toEqual(['m2', 'm1']);
        expect(emailStore.selectedMessage?.id).toBe('m2');
    });

    it('falls back to the previous message when the last one is deleted', async () => {
        const emailStore = await loadThreeMessages();
        emailStore.selectedMessage = { id: 'm1', snippet: '', subject: '', from: '', date: '', body: '' };

        mockedInvoke.mockResolvedValueOnce({ success: true, messageId: 'm1' });
        // The detail response overwrites the cached copy, so it must carry the
        // same date the list had — otherwise the row would move.
        mockedInvoke.mockResolvedValueOnce({ id: 'm2', snippet: '', subject: 's2', from: 'f', date: '2026-07-07T00:00:00Z', body: '' });
        mockedInvoke.mockResolvedValue({ success: true, messageId: 'm2' });

        await emailStore.trashMessage('m1');

        expect(emailStore.selectedMessage?.id).toBe('m2');
    });

    it('clears the selection when the last remaining message is removed', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('only', '2026-07-08T00:00:00Z')],
            nextPageToken: null,
        });
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();
        emailStore.selectedMessage = { id: 'only', snippet: '', subject: '', from: '', date: '', body: '' };

        mockedInvoke.mockResolvedValue({ success: true, messageId: 'only' });
        await emailStore.spamMessage('only');

        expect(emailStore.messages).toHaveLength(0);
        expect(emailStore.selectedMessage).toBeNull();
        expect(emailStore.listCursorIndex).toBe(-1);
    });

    it('leaves the selection alone when a different message is removed', async () => {
        const emailStore = await loadThreeMessages();
        emailStore.selectedMessage = { id: 'm1', snippet: '', subject: '', from: '', date: '', body: '' };

        mockedInvoke.mockResolvedValue({ success: true, messageId: 'm3' });
        await emailStore.archiveMessage('m3');

        expect(emailStore.selectedMessage?.id).toBe('m1');
        expect(emailStore.messages.map(m => m.id)).toEqual(['m2', 'm1']);
    });

    it('toggles the IMPORTANT marker on and off', async () => {
        const emailStore = await loadThreeMessages();

        mockedInvoke.mockResolvedValue({ success: true, messageId: 'm2' });
        await emailStore.toggleImportant('m2');
        expect(emailStore.getMessage('m2')?.important).toBe(true);

        await emailStore.toggleImportant('m2');
        expect(emailStore.getMessage('m2')?.important).toBe(false);
    });

    it('sends IMPORTANT as an add label the first time', async () => {
        const emailStore = await loadThreeMessages();
        mockedInvoke.mockResolvedValue({ success: true, messageId: 'm2' });

        await emailStore.toggleImportant('m2');

        expect(mockedInvoke).toHaveBeenLastCalledWith(
            'modify_labels',
            expect.objectContaining({ addLabelIds: ['IMPORTANT'], removeLabelIds: [] }),
        );
    });
});

describe('emailStore bulk actions', () => {
    beforeEach(async () => {
        mockedInvoke.mockReset();
        mockedInvoke.mockResolvedValue(undefined);
        const { authStore } = await import('$lib/stores/authStore.svelte');
        authStore.activeAccountId = 'test@test.com';
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.stopPolling();
        emailStore.reset();
    });

    it('toggles individual selections', async () => {
        const emailStore = await loadThreeMessages();
        expect(emailStore.hasSelection).toBe(false);

        emailStore.toggleSelected('m1');
        expect(emailStore.isSelected('m1')).toBe(true);
        expect(emailStore.selectedIds.size).toBe(1);

        emailStore.toggleSelected('m1');
        expect(emailStore.hasSelection).toBe(false);
    });

    it('selects all and then clears with the same toggle', async () => {
        const emailStore = await loadThreeMessages();

        emailStore.toggleSelectAll();
        expect(emailStore.selectedIds.size).toBe(3);

        emailStore.toggleSelectAll();
        expect(emailStore.selectedIds.size).toBe(0);
    });

    it('removes archived messages from the list and clears the selection', async () => {
        const emailStore = await loadThreeMessages();
        emailStore.toggleSelected('m1');
        emailStore.toggleSelected('m3');

        mockedInvoke.mockResolvedValue({ success: true, messageId: 'x' });
        const count = await emailStore.bulkArchive();

        expect(count).toBe(2);
        expect(emailStore.messages.map(m => m.id)).toEqual(['m2']);
        expect(emailStore.hasSelection).toBe(false);
    });

    it('keeps messages in the list when only marking them read', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [
                serverMessage('u1', '2026-07-08T00:00:00Z', true),
                serverMessage('u2', '2026-07-07T00:00:00Z', true),
            ],
            nextPageToken: null,
        });
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();

        emailStore.toggleSelectAll();
        mockedInvoke.mockResolvedValue({ success: true, messageId: 'x' });
        await emailStore.bulkMarkRead();

        expect(emailStore.messages).toHaveLength(2);
        expect(emailStore.messages.every(m => m.read)).toBe(true);
    });

    it('stars every selected message', async () => {
        const emailStore = await loadThreeMessages();
        emailStore.toggleSelectAll();

        mockedInvoke.mockResolvedValue({ success: true, messageId: 'x' });
        await emailStore.bulkStar();

        expect(emailStore.messages.every(m => m.starred)).toBe(true);
    });

    it('does nothing when nothing is selected', async () => {
        const emailStore = await loadThreeMessages();
        const before = mockedInvoke.mock.calls.length;

        expect(await emailStore.bulkTrash()).toBe(0);
        expect(mockedInvoke.mock.calls.length).toBe(before);
    });

    it('reports partial failures but still applies the successes', async () => {
        const emailStore = await loadThreeMessages();
        emailStore.toggleSelected('m1');
        emailStore.toggleSelected('m2');

        // First message succeeds, second fails on every retry
        mockedInvoke.mockResolvedValueOnce({ success: true, messageId: 'm1' });
        mockedInvoke.mockRejectedValue(new Error('server said no'));

        const count = await emailStore.bulkArchive();

        expect(count).toBe(1);
        expect(emailStore.error).toContain('1件の操作に失敗しました');
        expect(emailStore.isBulkRunning).toBe(false);
    });
});
