import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';

const mockedInvoke = (tauriCore.invoke as any) as ReturnType<typeof vi.fn>;

describe('EmailStore LRU cache integration', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockedInvoke.mockRestore();
  });

  it('getCacheInfo returns valid stats object', async () => {
    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    emailStore.reset();

    const info = emailStore.getCacheInfo();
    expect(info).toHaveProperty('size');
    expect(info).toHaveProperty('capacity');
    expect(info).toHaveProperty('totalAdded');
    expect(info).toHaveProperty('totalEvicted');
    expect(info).toHaveProperty('resetCount');
    expect(info.capacity).toBe(500);
  });

  it('getCacheInfo tracks messages added via loadMessages', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'm1', threadId: 't1', snippet: 'first', subject: 'S1', from: 'a@b.com', date: '2026-01-01' },
        { id: 'm2', threadId: 't2', snippet: 'second', subject: 'S2', from: 'c@d.com', date: '2026-01-02' },
      ],
      nextPageToken: null,
    });

    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();

    const info = emailStore.getCacheInfo();
    expect(info.size).toBe(2);
    expect(info.totalAdded).toBeGreaterThanOrEqual(2);
  });

  it('getMessage does O(1) lookup by id', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'target', threadId: 't1', snippet: 'found me', subject: 'Target', from: 'a@b.com', date: '2026-01-01' },
      ],
      nextPageToken: null,
    });

    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();

    const found = emailStore.getMessage('target');
    expect(found).toBeDefined();
    expect(found!.snippet).toBe('found me');
    expect(emailStore.getMessage('nonexistent')).toBeUndefined();
  });

  it('evicts oldest messages when cache exceeds capacity', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    // First page (refresh) — mock labels + messages
    mockedInvoke.mockResolvedValueOnce({ labels: [] });

    // Create 3 messages for first load
    const firstPage = Array.from({ length: 3 }, (_, i) => ({
      id: `msg-${i}`,
      threadId: `t-${i}`,
      snippet: `snippet ${i}`,
      subject: `Subject ${i}`,
      from: 'a@b.com',
      date: '2026-01-01',
    }));
    mockedInvoke.mockResolvedValueOnce({ messages: firstPage, nextPageToken: 'page2' });

    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();

    expect(emailStore.messages.length).toBe(3);

    // Lower capacity to trigger eviction on next load
    (emailStore as any)._cache.capacity = 4;

    // Load more — add 2 new messages, should evict oldest to stay at capacity 4
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'msg-new1', threadId: 't-new1', snippet: 'newer', subject: 'New1', from: 'b@c.com', date: '2026-01-03' },
        { id: 'msg-new2', threadId: 't-new2', snippet: 'newest', subject: 'New2', from: 'c@d.com', date: '2026-01-04' },
      ],
      nextPageToken: null,
    });

    await emailStore.loadMoreMessages();

    const info = emailStore.getCacheInfo();
    expect(info.size).toBeLessThanOrEqual(4);
    expect(info.totalEvicted).toBeGreaterThanOrEqual(1); // At least msg-0 should be evicted
  });

  it('loadMessageDetail updates cache entry', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'detail-me', threadId: 't1', snippet: 'before', subject: 'Old', from: 'old@x.com', date: '2026-01-01' },
      ],
      nextPageToken: null,
    });

    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();

    // Verify initial state
    expect(emailStore.getMessage('detail-me')!.snippet).toBe('before');

    // Mock getMessageDetails response
    mockedInvoke.mockResolvedValueOnce({
      id: 'detail-me',
      snippet: 'updated snippet',
      subject: 'Updated Subject',
      from: 'new@y.com',
      date: '2026-01-05',
      body: 'Full body text',
    });

    await emailStore.loadMessageDetail('detail-me');

    // Cache entry should be updated
    const updated = emailStore.getMessage('detail-me');
    expect(updated!.snippet).toBe('updated snippet');
    expect(updated!.subject).toBe('Updated Subject');
    expect(updated!.read).toBe(true);
  });

  it('reset clears the LRU cache', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'x', threadId: 'tx', snippet: 'hi', subject: 'Hi', from: 'a@b.com', date: '2026-01-01' },
      ],
      nextPageToken: null,
    });

    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();
    expect(emailStore.messages.length).toBeGreaterThanOrEqual(1);

    emailStore.reset();
    expect(emailStore.messages.length).toBe(0);
    expect(emailStore.getCacheInfo().size).toBe(0);
  });

  it('messages array is sorted newest-first by insertion order', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'a', threadId: 'ta', snippet: 'A', subject: 'A', from: 'a@b.com', date: '2026-01-01' },
        { id: 'b', threadId: 'tb', snippet: 'B', subject: 'B', from: 'c@d.com', date: '2026-01-02' },
        { id: 'c', threadId: 'tc', snippet: 'C', subject: 'C', from: 'e@f.com', date: '2026-01-03' },
      ],
      nextPageToken: null,
    });

    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();

    // Last-inserted message should appear first in array
    expect(emailStore.messages[0].id).toBe('c');
    expect(emailStore.messages[1].id).toBe('b');
    expect(emailStore.messages[2].id).toBe('a');
  });

  it('loadMoreMessages deduplicates against cache', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'test@test.com';

    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'existing', threadId: 't1', snippet: 'orig', subject: 'S', from: 'a@b.com', date: '2026-01-01' },
      ],
      nextPageToken: 'next',
    });

    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    await emailStore.refresh();

    // Load more with duplicate
    mockedInvoke.mockResolvedValueOnce({
      messages: [
        { id: 'existing', threadId: 't1', snippet: 'changed', subject: 'S2', from: 'a@b.com', date: '2026-01-01' },
        { id: 'new-one', threadId: 't2', snippet: 'fresh', subject: 'Fresh', from: 'x@y.com', date: '2026-01-02' },
      ],
      nextPageToken: null,
    });

    await emailStore.loadMoreMessages();

    // Should have 2 entries: existing (not overwritten) + new-one
    expect(emailStore.messages.length).toBe(2);
    expect(emailStore.getMessage('existing')!.snippet).toBe('orig'); // not overwritten
    expect(emailStore.getMessage('new-one')!.snippet).toBe('fresh');
  });
});

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
