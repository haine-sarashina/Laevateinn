import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';

const mockedInvoke = (tauriCore.invoke as any) as ReturnType<typeof vi.fn>;

describe('AuthStore', () => {
  beforeEach(() => {
    // Reset mock to return undefined by default
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockedInvoke.mockRestore();
  });

  it('has expected interface', async () => {
    const { authStore } = await import('$lib/stores/authStore.svelte');
    expect(authStore).toBeDefined();
    expect(typeof authStore.syncAccounts).toBe('function');
    expect(typeof authStore.initialize).toBe('function');
    expect(typeof authStore.setActiveAccount).toBe('function');
    expect(typeof authStore.removeAccount).toBe('function');
    expect(typeof authStore.activeAccountId).toBeDefined();
    expect(Array.isArray(authStore.accounts)).toBe(true);
  });

  it('syncAccounts populates accounts from API', async () => {
    const mockAccounts = [
      { id: 'user@test.com', name: 'user@test.com' },
    ];
    mockedInvoke.mockResolvedValueOnce(mockAccounts);

    const { authStore } = await import('$lib/stores/authStore.svelte');
    await authStore.syncAccounts();
    expect(authStore.accounts).toEqual(mockAccounts);
  });

  it('setActiveAccount updates active id', async () => {
    // Mock: switch_active_for_account → get_accounts (for email refresh) → list_labels
    mockedInvoke.mockResolvedValueOnce(undefined);
    mockedInvoke.mockResolvedValueOnce([]);
    mockedInvoke.mockResolvedValueOnce({ labels: [] });

    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'old@test.com';
    await authStore.setActiveAccount('new@test.com');
    expect(authStore.activeAccountId).toBe('new@test.com');
  });

  it('initialize sets first account as active', async () => {
    const mockAccounts = [
      { id: 'user@test.com', name: 'user@test.com' },
    ];
    mockedInvoke.mockResolvedValueOnce(mockAccounts);

    const { authStore } = await import('$lib/stores/authStore.svelte');
    // Reset state before initialize
    authStore.activeAccountId = null;
    authStore.accounts = [];
    await authStore.initialize();
    expect(authStore.activeAccountId).toBe('user@test.com');
  });

  it('deduplicates accounts in syncAccounts', async () => {
    const mockAccounts = [
      { id: 'user@test.com', name: 'user@test.com' },
      { id: 'user@test.com', name: 'user@test.com' }, // duplicate
    ];
    mockedInvoke.mockResolvedValueOnce(mockAccounts);

    const { authStore } = await import('$lib/stores/authStore.svelte');
    await authStore.syncAccounts();
    expect(authStore.accounts.length).toBe(1);
  });

  it('removeAccount removes from list and resets active if needed', async () => {
    // Mock: remove_account → get_accounts (after removal)
    mockedInvoke.mockResolvedValueOnce(undefined);
    mockedInvoke.mockResolvedValueOnce([]);

    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'user@test.com';
    authStore.accounts = [{ id: 'user@test.com', name: 'user@test.com' }];
    await authStore.removeAccount('user@test.com');
    expect(authStore.accounts).toEqual([]);
    expect(authStore.activeAccountId).toBeNull();
  });

  it('removeAccount resets active to first remaining account', async () => {
    const remainingAccounts = [{ id: 'other@test.com', name: 'other@test.com' }];
    // Mock: remove_account → get_accounts (after removal)
    mockedInvoke.mockResolvedValueOnce(undefined);
    mockedInvoke.mockResolvedValueOnce(remainingAccounts);

    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.activeAccountId = 'removed@test.com';
    authStore.accounts = [
      { id: 'removed@test.com', name: 'removed@test.com' },
      ...remainingAccounts,
    ];
    await authStore.removeAccount('removed@test.com');
    expect(authStore.activeAccountId).toBe('other@test.com');
  });

  it('handles sync failure gracefully', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('Network error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { authStore } = await import('$lib/stores/authStore.svelte');
    authStore.accounts = [{ id: 'existing@test.com', name: 'existing@test.com' }];
    await authStore.syncAccounts();
    // Should not crash - accounts may remain as-is or be empty
    expect(authStore.accounts).toBeDefined();
    consoleSpy.mockRestore();
  });
});
