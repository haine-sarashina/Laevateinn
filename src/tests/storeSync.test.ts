import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';

const mockedInvoke = (tauriCore.invoke as any) as ReturnType<typeof vi.fn>;

describe('EmailStore.reset()', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockedInvoke.mockRestore();
  });

  it('clears all state fields', async () => {
    const { emailStore } = await import('$lib/stores/emailStore.svelte');

    // Set up non-empty state
    emailStore.messages = [
      { id: '1', threadId: 't1', snippet: 'Test', subject: 'S', from: 'a@b.com', date: 'today', body: '', read: false },
    ];
    emailStore.selectedMessage = {
      id: '1', snippet: 'Test', subject: 'S', from: 'a@b.com', date: 'today', body: '',
    } as any;
    emailStore.error = 'some error';
    emailStore.isAuthErrorFlag = true;
    emailStore.isLoading = true;
    emailStore.isDetailsLoading = true;
    emailStore.isMoreLoading = true;
    emailStore.nextPageToken = 'abc123';
    emailStore.hasMore = false;
    emailStore.expandedThreads = new Set(['t1']);
    emailStore.currentLabelId = 'INBOX';
    emailStore.labels = [{ id: 'INBOX', name: 'INBOX', displayName: 'Inbox', labelType: 'system', messagesUnread: 0 }] as any;
    emailStore.isComposing = true;

    // Reset all state
    emailStore.reset();

    expect(emailStore.messages.length).toBe(0);
    expect(emailStore.selectedMessage).toBeNull();
    expect(emailStore.error).toBeNull();
    expect(emailStore.isAuthErrorFlag).toBe(false);
    expect(emailStore.isLoading).toBe(false);
    expect(emailStore.isDetailsLoading).toBe(false);
    expect(emailStore.isMoreLoading).toBe(false);
    expect(emailStore.nextPageToken).toBeNull();
    expect(emailStore.hasMore).toBe(true);
    expect(emailStore.expandedThreads.size).toBe(0);
    expect(emailStore.currentLabelId).toBeNull();
    expect(emailStore.labels.length).toBe(0);
    expect(emailStore.isComposing).toBe(false);
  });
});

describe('EmailStore.refresh()', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    mockedInvoke.mockRestore();
  });

  it('calls reset before loading messages', async () => {
    // Set up authStore with an active account so loadMessages doesn't error
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    // Mock the API calls that refresh() triggers: loadLabels + loadMessages
    mockedInvoke.mockResolvedValueOnce({ labels: [] });       // list_labels
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null }); // list_messages

    const { emailStore } = await import('$lib/stores/emailStore.svelte');

    // Set state that should be cleared by reset -> refresh chain
    emailStore.selectedMessage = { id: 'old', snippet: '', subject: '', from: '', date: '', body: '' } as any;
    emailStore.error = 'previous error';
    emailStore.expandedThreads = new Set(['should-be-cleared']);

    await emailStore.refresh();

    expect(emailStore.selectedMessage).toBeNull();
    expect(emailStore.error).toBeNull();
    expect(emailStore.expandedThreads.size).toBe(0);
  });
});

describe('AuthStore token refresh callbacks', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockedInvoke.mockRestore();
  });

  it('registers and notifies callbacks via onTokenRefresh/notifyTokenRefreshed', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    authStore.onTokenRefresh(callback1);
    authStore.onTokenRefresh(callback2);

    authStore.notifyTokenRefreshed('user@test.com');

    expect(callback1).toHaveBeenCalledWith('user@test.com');
    expect(callback2).toHaveBeenCalledWith('user@test.com');
  });

  it('unsubscribe removes the callback', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');

    const callback = vi.fn();
    const unsubscribe = authStore.onTokenRefresh(callback);

    unsubscribe();
    authStore.notifyTokenRefreshed('user@test.com');

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not crash if a callback throws', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const badCallback = vi.fn(() => { throw new Error('callback error'); });
    const goodCallback = vi.fn();

    authStore.onTokenRefresh(badCallback);
    authStore.onTokenRefresh(goodCallback);

    // Should not throw even if first callback errors
    expect(() => authStore.notifyTokenRefreshed('x@test.com')).not.toThrow();
    expect(goodCallback).toHaveBeenCalledWith('x@test.com');

    consoleSpy.mockRestore();
  });
});

describe('AuthStore.getEmailStore()', async () => {
  beforeEach(() => mockedInvoke.mockReset());
  afterEach(() => mockedInvoke.mockRestore());

  it('returns the emailStore singleton', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    const mod = await import('$lib/stores/emailStore.svelte');
    const emailStore = await authStore.getEmailStore();
    expect(emailStore).toBe(mod.emailStore);
  });

  it('caches the reference across calls', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    const ref1 = await authStore.getEmailStore();
    const ref2 = await authStore.getEmailStore();
    expect(ref1).toBe(ref2);
  });
});
