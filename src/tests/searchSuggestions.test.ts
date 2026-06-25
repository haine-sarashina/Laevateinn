import { describe, it, expect } from 'vitest';
import {
  filterHistoryEntries,
  operatorSuggestions,
  senderSuggestions,
  parseOperatorPrefix,
  generateSuggestions,
} from '$lib/searchSuggestions';

// ─── Helper: mock messages ───
function mockMessages(froms: string[]) {
  return froms.map(f => ({ from: f }));
}

// ─── filterHistoryEntries ───
describe('filterHistoryEntries', () => {
  const history = ['hello world', 'goodbye', 'HELLO again', 'foo bar', 'baz'];

  it('returns empty array when input is empty', () => {
    expect(filterHistoryEntries(history, '')).toEqual([]);
    expect(filterHistoryEntries(history, '   ')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const result = filterHistoryEntries(history, 'HELLO');
    expect(result.map(r => r.text)).toContain('hello world');
    expect(result.map(r => r.text)).toContain('HELLO again');
  });

  it('uses fuzzy matching (subsequence)', () => {
    // 'gdbye' should match 'goodbye' via fuzzy match (g-o-d-b-y-e)
    const result = filterHistoryEntries(history, 'gdbye');
    expect(result.map(r => r.text)).toContain('goodbye');
  });

  it('respects maxResults', () => {
    const result = filterHistoryEntries(history, 'o', 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('all suggestions have kind "history"', () => {
    const result = filterHistoryEntries(history, 'o');
    for (const s of result) {
      expect(s.kind).toBe('history');
    }
  });

  it('returns all matches when input is common character', () => {
    // 'o' appears in hello, goodbye, Hello again, foo
    const result = filterHistoryEntries(history, 'o');
    expect(result.length).toBeGreaterThan(1);
  });

  it('returns empty when no match', () => {
    const result = filterHistoryEntries(history, 'xyz_not_found');
    expect(result).toEqual([]);
  });
});

// ─── operatorSuggestions ───
describe('operatorSuggestions', () => {
  it('returns empty array when input is empty', () => {
    expect(operatorSuggestions('')).toEqual([]);
    expect(operatorSuggestions('   ')).toEqual([]);
  });

  it('matches "from:" prefix', () => {
    const result = operatorSuggestions('fro');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].operator).toBe('from:');
  });

  it('matches "subject:" prefix', () => {
    const result = operatorSuggestions('sub');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].operator?.startsWith('subject')).toBe(true);
  });

  it('matches "is:starred"', () => {
    const result = operatorSuggestions('is:');
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.operator?.includes('is'))).toBe(true);
  });

  it('matches "has:attachment"', () => {
    const result = operatorSuggestions('has:att');
    expect(result.length).toBeGreaterThan(0);
  });

  it('respects maxResults', () => {
    // empty-ish input that might match many operators
    const result = operatorSuggestions('a', 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('all suggestions have kind "operator"', () => {
    const result = operatorSuggestions('f');
    for (const s of result) {
      expect(s.kind).toBe('operator');
    }
  });

  it('returns empty when no operator matches', () => {
    expect(operatorSuggestions('xyz_not_an_operator')).toEqual([]);
  });
});

// ─── senderSuggestions ───
describe('senderSuggestions', () => {
  const messages = mockMessages([
    'Alice <alice@example.com>',
    'Bob <bob@example.com>',
    'alice@example.com', // duplicate of Alice, should be deduped
    'Charlie <charlie@example.com>',
  ]);

  it('returns empty array when input is empty and no messages match', () => {
    const result = senderSuggestions([], '');
    expect(result).toEqual([]);
  });

  it('matches senders case-insensitively', () => {
    const result = senderSuggestions(messages, 'alice');
    // Alice and alice@example.com are deduped to one result via email key
    expect(result.length).toBe(1);
    expect(result[0].text.toLowerCase()).toContain('alice');
  });

  it('deduplicates senders by lowercase email', () => {
    const result = senderSuggestions(messages, 'a');
    // Alice appears once (deduped from two entries), Charlie may also match
    // The key assertion: Alice should only appear once total
    const aliceCount = result.filter(r => r.text.toLowerCase().includes('alice')).length;
    expect(aliceCount).toBeLessThanOrEqual(1);
  });

  it('respects maxResults', () => {
    const result = senderSuggestions(messages, '', 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('all suggestions have kind "sender"', () => {
    const result = senderSuggestions(messages, '');
    for (const s of result) {
      expect(s.kind).toBe('sender');
    }
  });

  it('skips messages with empty from field', () => {
    const msgs = [{ from: '' }, { from: 'Valid <valid@test.com>' }];
    const result = senderSuggestions(msgs as any, '');
    expect(result.length).toBe(1);
    expect(result[0].text).toContain('Valid');
  });

  it('uses substring matching for sender names', () => {
    // 'har' should match 'Charlie' via substring
    const result = senderSuggestions(messages, 'har');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text.toLowerCase()).toContain('charlie');
  });

  it('matches empty input against all senders', () => {
    const result = senderSuggestions(messages, '');
    // Should return top senders (up to maxResults)
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// ─── parseOperatorPrefix ───
describe('parseOperatorPrefix', () => {
  it('detects "from:" prefix', () => {
    expect(parseOperatorPrefix('from:alice')).toBe('from:');
  });

  it('detects "to:" prefix', () => {
    expect(parseOperatorPrefix('to:bob')).toBe('to:');
  });

  it('detects "subject:" prefix', () => {
    expect(parseOperatorPrefix('subject:hello')).toBe('subject:');
  });

  it('detects "after:" prefix', () => {
    expect(parseOperatorPrefix('after:2026/01/01')).toBe('after:');
  });

  it('detects "before:" prefix', () => {
    expect(parseOperatorPrefix('before:2026/12/31')).toBe('before:');
  });

  it('detects "is:" prefix', () => {
    expect(parseOperatorPrefix('is:starred')).toBe('is:');
  });

  it('detects "has:" prefix', () => {
    expect(parseOperatorPrefix('has:attachment')).toBe('has:');
  });

  it('returns null for plain text', () => {
    expect(parseOperatorPrefix('hello world')).toBeNull();
    expect(parseOperatorPrefix('test123')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parseOperatorPrefix('FROM:alice')).toBe('from:');
    expect(parseOperatorPrefix('From:Bob')).toBe('from:');
  });
});

// ─── generateSuggestions (integration) ───
describe('generateSuggestions', () => {
  const history = ['test query', 'another search'];
  const messages = mockMessages([
    'Alice <alice@example.com>',
    'Bob <bob@example.com>',
  ]);

  it('returns empty array when input is empty', () => {
    expect(generateSuggestions('', history, messages)).toEqual([]);
  });

  it('returns operator suggestions for partial operator input', () => {
    const result = generateSuggestions('fro', history, messages);
    // "fro" matches from: operator
    expect(result.some(r => r.kind === 'operator')).toBe(true);
  });

  it('returns sender suggestions when typing "from:"', () => {
    const result = generateSuggestions('from:', history, messages);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => r.kind === 'sender')).toBe(true);
  });

  it('returns sender suggestions filtered by name after "from: A"', () => {
    const result = generateSuggestions('from: A', history, messages);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text.toLowerCase()).toContain('alice');
  });

  it('combines history and sender suggestions for plain text', () => {
    const result = generateSuggestions('test', history, messages);
    // Should include history match "test query"
    expect(result.some(r => r.kind === 'history')).toBe(true);
  });

  it('respects max options', () => {
    const result = generateSuggestions('t', history, messages, {
      maxHistory: 1,
      maxSenders: 1,
      maxOperators: 1,
    });
    expect(result.length).toBeLessThanOrEqual(2); // 1 history + 1 sender
  });
});
