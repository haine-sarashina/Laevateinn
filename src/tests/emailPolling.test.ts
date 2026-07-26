import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';

const mockedInvoke = (tauriCore.invoke as any) as ReturnType<typeof vi.fn>;

function serverMessage(id: string, date: string, unread = true) {
    return {
        id,
        threadId: `t-${id}`,
        snippet: `snippet ${id}`,
        subject: `subject ${id}`,
        from: `${id} <${id}@example.com>`,
        date,
        unread,
        starred: false,
    };
}

describe('emailStore display order and sections', () => {
    beforeEach(async () => {
        mockedInvoke.mockReset();
        mockedInvoke.mockResolvedValue(undefined);
        const { authStore } = await import('$lib/stores/authStore.svelte');
        authStore.activeAccountId = 'test@test.com';
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.stopPolling();
        emailStore.reset();
    });

    afterEach(async () => {
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.stopPolling();
    });

    it('shows messages newest first regardless of server order', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [
                serverMessage('old', '2026-07-01T00:00:00Z', false),
                serverMessage('new', '2026-07-08T00:00:00Z', false),
                serverMessage('mid', '2026-07-04T00:00:00Z', false),
            ],
            nextPageToken: null,
        });

        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();

        expect(emailStore.messages.map(m => m.id)).toEqual(['new', 'mid', 'old']);
    });

    it('groups unread messages above read ones', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [
                serverMessage('read-new', '2026-07-08T00:00:00Z', false),
                serverMessage('unread-old', '2026-07-02T00:00:00Z', true),
            ],
            nextPageToken: null,
        });

        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();

        expect(emailStore.messages.map(m => m.id)).toEqual(['unread-old', 'read-new']);
        expect(emailStore.listRows.filter(r => r.kind === 'header').map(r => r.kind === 'header' && r.label))
            .toEqual(['未読', '既読']);
    });

    it('clears section membership on refresh', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('u1', '2026-07-08T00:00:00Z', true)],
            nextPageToken: null,
        });
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();
        expect(emailStore.unreadSectionIds.has('u1')).toBe(true);

        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('r1', '2026-07-08T00:00:00Z', false)],
            nextPageToken: null,
        });
        await emailStore.refresh();
        expect(emailStore.unreadSectionIds.has('u1')).toBe(false);
        expect(emailStore.unreadSectionIds.size).toBe(0);
    });

    it('defaults the selected label to INBOX so the sidebar shows a selection', async () => {
        mockedInvoke.mockResolvedValueOnce({
            labels: [
                { id: 'INBOX', name: 'INBOX', displayName: 'INBOX', labelType: 'system', messagesUnread: 3 },
            ],
        });
        mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null });

        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();

        expect(emailStore.currentLabelId).toBe('INBOX');
    });
});

describe('emailStore new-mail polling', () => {
    beforeEach(async () => {
        mockedInvoke.mockReset();
        mockedInvoke.mockResolvedValue(undefined);
        const { authStore } = await import('$lib/stores/authStore.svelte');
        authStore.activeAccountId = 'test@test.com';
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.stopPolling();
        emailStore.reset();
    });

    afterEach(async () => {
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.stopPolling();
        vi.useRealTimers();
    });

    it('merges messages that arrived since the last load', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('m1', '2026-07-01T00:00:00Z', false)],
            nextPageToken: 'page2',
        });
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();

        mockedInvoke.mockResolvedValueOnce({
            messages: [
                serverMessage('m2', '2026-07-09T00:00:00Z', true),
                serverMessage('m1', '2026-07-01T00:00:00Z', false),
            ],
            nextPageToken: 'page2',
        });
        const added = await emailStore.checkForNewMessages();

        expect(added).toBe(1);
        expect(emailStore.messages.map(m => m.id)).toEqual(['m2', 'm1']);
    });

    it('leaves pagination state untouched', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('m1', '2026-07-01T00:00:00Z', false)],
            nextPageToken: 'page2',
        });
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();

        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('m2', '2026-07-09T00:00:00Z', true)],
            nextPageToken: 'a-different-token',
        });
        await emailStore.checkForNewMessages();

        expect(emailStore.nextPageToken).toBe('page2');
    });

    it('reports zero when nothing new arrived', async () => {
        mockedInvoke.mockResolvedValueOnce({ labels: [] });
        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('m1', '2026-07-01T00:00:00Z', false)],
            nextPageToken: null,
        });
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        await emailStore.refresh();

        mockedInvoke.mockResolvedValueOnce({
            messages: [serverMessage('m1', '2026-07-01T00:00:00Z', false)],
            nextPageToken: null,
        });
        expect(await emailStore.checkForNewMessages()).toBe(0);
    });

    it('skips the check while a search is active', async () => {
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.isSearching = true;
        const before = mockedInvoke.mock.calls.length;
        expect(await emailStore.checkForNewMessages()).toBe(0);
        expect(mockedInvoke.mock.calls.length).toBe(before);
        emailStore.isSearching = false;
    });

    it('skips the check when no account is active', async () => {
        const { authStore } = await import('$lib/stores/authStore.svelte');
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        authStore.activeAccountId = null;
        expect(await emailStore.checkForNewMessages()).toBe(0);
        authStore.activeAccountId = 'test@test.com';
    });

    it('swallows backend errors so a failed poll cannot break the UI', async () => {
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        mockedInvoke.mockRejectedValue(new Error('network down'));
        await expect(emailStore.checkForNewMessages()).resolves.toBe(0);
        expect(emailStore.error).toBeNull();
    });

    it('startPolling schedules checks on the given interval', async () => {
        vi.useFakeTimers();
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        const spy = vi.spyOn(emailStore, 'checkForNewMessages').mockResolvedValue(0);

        emailStore.startPolling(1000);
        expect(emailStore.isPolling).toBe(true);

        await vi.advanceTimersByTimeAsync(3000);
        expect(spy).toHaveBeenCalledTimes(3);

        emailStore.stopPolling();
        await vi.advanceTimersByTimeAsync(3000);
        expect(spy).toHaveBeenCalledTimes(3);
        expect(emailStore.isPolling).toBe(false);
        spy.mockRestore();
    });

    it('startPolling replaces an existing timer instead of stacking them', async () => {
        vi.useFakeTimers();
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        const spy = vi.spyOn(emailStore, 'checkForNewMessages').mockResolvedValue(0);

        emailStore.startPolling(1000);
        emailStore.startPolling(1000);
        await vi.advanceTimersByTimeAsync(1000);

        expect(spy).toHaveBeenCalledTimes(1);
        emailStore.stopPolling();
        spy.mockRestore();
    });

    it('an interval of 0 disables polling', async () => {
        const { emailStore } = await import('$lib/stores/emailStore.svelte');
        emailStore.startPolling(0);
        expect(emailStore.isPolling).toBe(false);
    });
});
