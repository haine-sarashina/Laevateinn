import { describe, it, expect } from 'vitest';

/**
 * Tests for pure helper functions found in EmailList.svelte and EmailDetail.svelte.
 * These replicate the component logic to test them in isolation.
 */

// Replicate formatDate from EmailList.svelte
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (isNaN(diffMs)) {
    return '';
  }

  if (diffDays === 0) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('ja-JP', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
}

// Replicate formatSender from EmailList.svelte
function formatSender(from: string): string {
  const match = from.match(/^[^<]+/);
  return match ? match[0].trim() : from;
}

// Replicate truncate from EmailList.svelte
function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

// Replicate formatSender from EmailDetail.svelte
function formatSenderDetail(from: string): { name: string; email: string } {
  const nameMatch = from.match(/^[^<]*/);
  const emailMatch = from.match(/<([^>]+)>/);
  return {
    name: nameMatch?.[0]?.trim() || '',
    email: emailMatch?.[1] || from,
  };
}

// Replicate isAuthError from emailStore.svelte.ts
function isAuthError(e: unknown): boolean {
  if (e instanceof Error) {
    return e.message.includes('AuthError') || e.message.includes('認証');
  }
  if (typeof e === 'object' && e !== null && 'type' in e) {
    return (e as any).type === 'AuthError';
  }
  if (typeof e === 'string') {
    return e.includes('AuthError') || e.includes('認証');
  }
  return false;
}

describe('formatDate', () => {
  it('returns empty string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('');
  });

  it('returns a time string for today', () => {
    const today = new Date().toISOString();
    const result = formatDate(today);
    // Should return a time string like "14:30"
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it('handles ISO date strings', () => {
    const result = formatDate('2025-06-15T10:30:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty for malformed dates', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('abc123')).toBe('');
  });
});

describe('formatSender', () => {
  it('extracts name from "Name <email>" format', () => {
    expect(formatSender('John Doe <john@example.com>')).toBe('John Doe');
  });

  it('returns the whole string when no angle brackets', () => {
    expect(formatSender('just-an-email@example.com')).toBe('just-an-email@example.com');
  });

  it('handles empty string', () => {
    expect(formatSender('')).toBe('');
  });

  it('trims whitespace from extracted name', () => {
    expect(formatSender('  Spaces  <test@test.com>')).toBe('Spaces');
  });

  it('handles angle brackets with no content before', () => {
    // "<email>" → regex matches empty string, so returns original string
    expect(formatSender('<only-email@test.com>')).toBe('<only-email@test.com>');
  });
});

describe('truncate', () => {
  it('returns text unchanged when within maxLen', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
  });

  it('truncates and adds ellipsis when exceeding maxLen', () => {
    expect(truncate('Hello, World! This is a long string.', 10)).toBe('Hello, Wor...');
  });

  it('handles exact length', () => {
    expect(truncate('Exactly10!', 10)).toBe('Exactly10!');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('handles maxLen of 0', () => {
    expect(truncate('anything', 0)).toBe('...');
  });

  it('preserves unicode characters', () => {
    expect(truncate('日本語テスト', 3)).toBe('日本語...');
  });
});

describe('formatSenderDetail (EmailDetail variant)', () => {
  it('parses "Name <email>" correctly', () => {
    const result = formatSenderDetail('Alice <alice@test.com>');
    expect(result.name).toBe('Alice');
    expect(result.email).toBe('alice@test.com');
  });

  it('handles bare email without angle brackets', () => {
    const result = formatSenderDetail('bob@test.com');
    expect(result.name).toBe('bob@test.com');
    expect(result.email).toBe('bob@test.com');
  });

  it('returns empty name for angle-bracket-only input', () => {
    const result = formatSenderDetail('<charlie@test.com>');
    expect(result.name).toBe('');
    expect(result.email).toBe('charlie@test.com');
  });

  it('handles empty string gracefully', () => {
    const result = formatSenderDetail('');
    expect(result.name).toBe('');
    expect(result.email).toBe('');
  });
});

describe('isAuthError', () => {
  it('detects AuthError in Error message', () => {
    expect(isAuthError(new Error('AuthError: invalid token'))).toBe(true);
  });

  it('detects Japanese auth error text', () => {
    expect(isAuthError(new Error('認証が無効です'))).toBe(true);
  });

  it('detects AuthError object type', () => {
    expect(isAuthError({ type: 'AuthError', message: 'expired' })).toBe(true);
  });

  it('detects AuthError in plain string', () => {
    expect(isAuthError('Got AuthError from backend')).toBe(true);
  });

  it('returns false for non-auth errors', () => {
    expect(isAuthError(new Error('Network timeout'))).toBe(false);
  });

  it('returns false for plain objects without type field', () => {
    expect(isAuthError({ foo: 'bar' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAuthError(null)).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(isAuthError(42)).toBe(false);
  });

  it('returns false for booleans', () => {
    expect(isAuthError(true)).toBe(false);
  });

  it('detects Japanese auth error in string', () => {
    expect(isAuthError('認証エラーが発生しました')).toBe(true);
  });
});
