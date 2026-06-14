import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// We need to import invoke from the mocked module
import * as tauriCore from '@tauri-apps/api/core';
const mockedInvoke = (tauriCore.invoke as any) as MockedFunction<typeof tauriCore.invoke>;

describe('api.safeInvoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Dynamic import to ensure mock is active
  it('returns result from successful invoke', async () => {
    const api = await import('$lib/api');
    mockedInvoke.mockResolvedValueOnce({ id: 'test@example.com', name: 'Test User' });
    const result = await api.safeInvoke<{ id: string; name: string }>('get_accounts');
    expect(result).toEqual({ id: 'test@example.com', name: 'Test User' });
  });

  it('retries once on failure then succeeds', async () => {
    const api = await import('$lib/api');
    mockedInvoke
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ ok: true });
    const result = await api.safeInvoke<{ ok: boolean }>('some_command');
    expect(result).toEqual({ ok: true });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const api = await import('$lib/api');
    // Use mockRejectedValueOnce to avoid polluting subsequent tests
    mockedInvoke.mockRejectedValueOnce(new Error('persistent error'))
      .mockRejectedValueOnce(new Error('persistent error'));
    await expect(
      api.safeInvoke('failing_command')
    ).rejects.toThrow('persistent error');
    // 2 attempts from safeInvoke retries + 1 from errorStore.set() -> log() invoke call = 3
    expect(mockedInvoke).toHaveBeenCalledTimes(3);
  });

  it('passes args to invoke', async () => {
    const api = await import('$lib/api');
    mockedInvoke.mockResolvedValueOnce(null);
    await api.safeInvoke('send_email', {
      accountId: 'user@test.com',
      to: 'recipient@test.com',
      subject: 'Hello',
      body: 'Body',
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'send_email',
      expect.objectContaining({ accountId: 'user@test.com' })
    );
  });
});

describe('api.getAccounts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns accounts array', async () => {
    const api = await import('$lib/api');
    const mockAccounts = [
      { id: 'user1@test.com', name: 'user1@test.com' },
      { id: 'user2@test.com', name: 'user2@test.com' },
    ];
    mockedInvoke.mockResolvedValueOnce(mockAccounts);
    const result = await api.getAccounts();
    expect(result).toEqual(mockAccounts);
  });
});

describe('api.listMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes list_messages with correct arguments', async () => {
    const api = await import('$lib/api');
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null });
    await api.listMessages('user@test.com', 'INBOX', undefined, 20);
    expect(mockedInvoke).toHaveBeenCalledWith(
      'list_messages',
      expect.objectContaining({ accountId: 'user@test.com', labelId: 'INBOX' })
    );
  });

  it('sends null for optional parameters', async () => {
    const api = await import('$lib/api');
    mockedInvoke.mockResolvedValueOnce({ messages: [], nextPageToken: null });
    await api.listMessages('user@test.com');
    expect(mockedInvoke).toHaveBeenCalledWith(
      'list_messages',
      expect.objectContaining({ labelId: null, pageToken: null })
    );
  });
});

describe('api.getMessageDetails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes get_message_details with correct args', async () => {
    const api = await import('$lib/api');
    const mockDetail = { id: '123', subject: 'Test', from: 'sender@test.com', date: 'today', body: '<p>hello</p>', snippet: 'hello' };
    mockedInvoke.mockResolvedValueOnce(mockDetail);
    const result = await api.getMessageDetails('user@test.com', 'msg123');
    expect(result).toEqual(mockDetail);
    expect(mockedInvoke).toHaveBeenCalledWith(
      'get_message_details',
      { accountId: 'user@test.com', messageId: 'msg123' }
    );
  });
});

describe('api.listLabels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes list_labels with account id', async () => {
    const api = await import('$lib/api');
    const mockLabels = { labels: [{ id: 'INBOX', name: 'INBOX', displayName: 'Inbox', labelType: 'system', messagesUnread: 5 }] };
    mockedInvoke.mockResolvedValueOnce(mockLabels);
    const result = await api.listLabels('user@test.com');
    expect(result).toEqual(mockLabels);
  });
});

describe('api.log', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes log_message with correct args', async () => {
    const api = await import('$lib/api');
    mockedInvoke.mockResolvedValueOnce(undefined);
    await api.log('info', 'test message');
    expect(mockedInvoke).toHaveBeenCalledWith(
      'log_message',
      { level: 'info', message: 'test message' }
    );
  });
});
