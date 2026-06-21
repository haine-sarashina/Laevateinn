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

describe('AuthStore.onAccountChange() callbacks', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockedInvoke.mockRestore();
  });

  it('calls before callback with old and new account ids', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'old@test.com';

    const beforeCb = vi.fn();
    authStore.onAccountChange({ before: beforeCb });

    // Mock: switch_active_for_account -> get_accounts (for email refresh) -> list_labels -> list_messages
    mockedInvoke.mockResolvedValueOnce(undefined); // switch
    mockedInvoke.mockResolvedValueOnce([]);        // get_accounts
    mockedInvoke.mockResolvedValueOnce({ labels: [] });  // list_labels
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null }); // list_messages

    await authStore.setActiveAccount('new@test.com');

    expect(beforeCb).toHaveBeenCalledWith('old@test.com', 'new@test.com');
  });

  it('calls after callback following a successful account switch', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'old@test.com';

    const afterCb = vi.fn();
    authStore.onAccountChange({ after: afterCb });

    mockedInvoke.mockResolvedValueOnce(undefined);
    mockedInvoke.mockResolvedValueOnce([]);
    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null });

    await authStore.setActiveAccount('new@test.com');

    expect(afterCb).toHaveBeenCalledWith('old@test.com', 'new@test.com');
  });

  it('unsubscribe removes the callback', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'old@test.com';

    const beforeCb = vi.fn();
    const afterCb = vi.fn();
    const unsubscribe = authStore.onAccountChange({ before: beforeCb, after: afterCb });
    unsubscribe();

    mockedInvoke.mockResolvedValueOnce(undefined);
    mockedInvoke.mockResolvedValueOnce([]);
    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null });

    await authStore.setActiveAccount('new@test.com');

    expect(beforeCb).not.toHaveBeenCalled();
    expect(afterCb).not.toHaveBeenCalled();
  });

  it('before callback can be async', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'old@test.com';

    let resolved = false;
    const beforeCb = vi.fn(async () => {
      resolved = true;
    });
    authStore.onAccountChange({ before: beforeCb });

    mockedInvoke.mockResolvedValueOnce(undefined);
    mockedInvoke.mockResolvedValueOnce([]);
    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null });

    await authStore.setActiveAccount('new@test.com');

    expect(resolved).toBe(true);
  });

  it('does not crash if after callback throws', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'old@test.com';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const badAfterCb = vi.fn(() => { throw new Error('after callback error'); });
    const goodAfterCb = vi.fn();
    authStore.onAccountChange({ after: badAfterCb });
    authStore.onAccountChange({ after: goodAfterCb });

    mockedInvoke.mockResolvedValueOnce(undefined);
    mockedInvoke.mockResolvedValueOnce([]);
    mockedInvoke.mockResolvedValueOnce({ labels: [] });
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null });

    await authStore.setActiveAccount('new@test.com');

    expect(badAfterCb).toHaveBeenCalled();
    expect(goodAfterCb).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe('EmailStore compose state per account', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
    // Reset emailStore to clear any leftover compose state from previous tests
    (async () => {
      const { emailStore } = await import('$lib/stores/emailStore.svelte');
      emailStore.reset();
    })();
  });

  afterEach(() => {
    mockedInvoke.mockRestore();
  });

  it('saveComposeBeforeSwitch saves current compose state', async () => {
    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    const { authStore } = await import('$lib/stores/authStore.svelte');

    authStore.activeAccountId = 'compose-test1@test.com';

    // Set up compose state
    emailStore.isComposing = true;
    emailStore.composeMode = 'reply';
    emailStore.composeTo = 'someone@example.com';
    emailStore.composeCc = 'cc@example.com';
    emailStore.composeSubject = 'Re: Test Subject';
    emailStore.composeBody = 'Reply body content';

    // Save the compose state
    emailStore.saveComposeBeforeSwitch();

    // Clear the current state (simulating reset during account switch)
    emailStore.isComposing = false;
    emailStore.composeTo = '';
    emailStore.composeCc = '';
    emailStore.composeSubject = '';
    emailStore.composeBody = '';

    // Restore should bring back the saved state
    emailStore.restoreComposeAfterSwitch();

    expect(emailStore.isComposing).toBe(true);
    expect(emailStore.composeMode).toBe('reply');
    expect(emailStore.composeTo).toBe('someone@example.com');
    expect(emailStore.composeCc).toBe('cc@example.com');
    expect(emailStore.composeSubject).toBe('Re: Test Subject');
    expect(emailStore.composeBody).toBe('Reply body content');
  });

  it('does not restore compose state when none was saved', async () => {
    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    const { authStore } = await import('$lib/stores/authStore.svelte');

    // Use a unique account that wasn't used in other tests
    authStore.activeAccountId = 'compose-empty@test.com';

    // No compose state set — just call restore directly
    emailStore.restoreComposeAfterSwitch();

    expect(emailStore.isComposing).toBe(false);
  });

  it('only restores state for the current account', async () => {
    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    const { authStore } = await import('$lib/stores/authStore.svelte');

    // Save compose state for account1
    authStore.activeAccountId = 'compose-a@test.com';
    emailStore.isComposing = true;
    emailStore.composeSubject = 'Account A draft';
    emailStore.saveComposeBeforeSwitch();

    // Switch to account2 and save different compose state
    emailStore.reset();
    authStore.activeAccountId = 'compose-b@test.com';
    emailStore.isComposing = true;
    emailStore.composeSubject = 'Account B draft';
    emailStore.saveComposeBeforeSwitch();

    // Now restore for account2 — should NOT show account1's draft
    emailStore.reset();
    authStore.activeAccountId = 'compose-b@test.com';
    emailStore.restoreComposeAfterSwitch();

    expect(emailStore.isComposing).toBe(true);
    expect(emailStore.composeSubject).toBe('Account B draft');
  });

  it('does not save when not composing', async () => {
    const { emailStore } = await import('$lib/stores/emailStore.svelte');
    const { authStore } = await import('$lib/stores/authStore.svelte');

    authStore.activeAccountId = 'compose-nosave@test.com';

    // Not composing — nothing to save
    emailStore.isComposing = false;
    emailStore.saveComposeBeforeSwitch();

    // Restore for same account — should remain not composing (nothing was saved)
    emailStore.reset();
    emailStore.restoreComposeAfterSwitch();

    expect(emailStore.isComposing).toBe(false);
  });
});
