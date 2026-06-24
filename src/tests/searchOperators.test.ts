import { describe, it, expect } from 'vitest';
import {
  normalizeDate,
  buildSearchQuery,
  addFromFilter,
  addToFilter,
  removeFromFilter,
  removeToFilter,
  toggleAttachmentFilter,
  toggleStarredFilter,
} from '$lib/searchOperators';

describe('normalizeDate', () => {
  it('normalizes YYYY-MM-DD to YYYY/MM/DD', () => {
    expect(normalizeDate('2026-06-25')).toBe('2026/06/25');
  });

  it('accepts YYYY/MM/DD as-is', () => {
    expect(normalizeDate('2026/06/25')).toBe('2026/06/25');
  });

  it('pads single-digit months and days', () => {
    expect(normalizeDate('2026/6/5')).toBe('2026/06/05');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeDate('')).toBe('');
  });

  it('returns empty string for invalid format', () => {
    expect(normalizeDate('25/06/2026')).toBe('');
    expect(normalizeDate('June 25, 2026')).toBe('');
    expect(normalizeDate('yesterday')).toBe('');
  });

  it('returns empty string for invalid month/day values', () => {
    expect(normalizeDate('2026/13/01')).toBe('');
    expect(normalizeDate('2026/00/01')).toBe('');
    expect(normalizeDate('2026/01/32')).toBe('');
  });

  it('handles mixed separators', () => {
    expect(normalizeDate('2026-06/25')).toBe('2026/06/25');
    expect(normalizeDate('2026/06-25')).toBe('2026/06/25');
  });
});

describe('buildSearchQuery', () => {
  it('returns empty string for empty params', () => {
    expect(buildSearchQuery({})).toBe('');
  });

  it('builds from: operator', () => {
    expect(buildSearchQuery({ from: 'sender@example.com' })).toBe(
      'from:sender@example.com'
    );
  });

  it('builds to: operator', () => {
    expect(buildSearchQuery({ to: 'recipient@example.com' })).toBe(
      'to:recipient@example.com'
    );
  });

  it('builds subject: operator', () => {
    expect(buildSearchQuery({ subject: 'important' })).toBe(
      'subject:important'
    );
  });

  it('builds has:attachment flag', () => {
    expect(buildSearchQuery({ hasAttachment: true })).toBe('has:attachment');
  });

  it('builds is:starred flag', () => {
    expect(buildSearchQuery({ starred: true })).toBe('is:starred');
  });

  it('builds after: with normalized date', () => {
    expect(buildSearchQuery({ afterDate: '2026-01-15' })).toBe(
      'after:2026/01/15'
    );
  });

  it('builds before: with normalized date', () => {
    expect(buildSearchQuery({ beforeDate: '2026/12/31' })).toBe(
      'before:2026/12/31'
    );
  });

  it('combines multiple operators correctly', () => {
    const result = buildSearchQuery({
      from: 'boss@company.com',
      subject: 'urgent',
      hasAttachment: true,
      afterDate: '2026-01-01',
    });
    expect(result).toBe('from:boss@company.com subject:urgent has:attachment after:2026/01/01');
  });

  it('places free-text query at the end', () => {
    const result = buildSearchQuery({
      from: 'sender@example.com',
      query: 'invoice receipt',
    });
    expect(result).toBe('from:sender@example.com invoice receipt');
  });

  it('ignores empty strings for optional fields', () => {
    expect(
      buildSearchQuery({ from: '', to: '   ', subject: '' })
    ).toBe('');
  });

  it('ignores invalid dates', () => {
    expect(
      buildSearchQuery({ afterDate: 'invalid', beforeDate: '' })
    ).toBe('');
  });

  it('quotes values containing spaces', () => {
    expect(buildSearchQuery({ from: 'John Doe' })).toBe(
      'from:"John Doe"'
    );
  });

  it('quotes values containing quotes', () => {
    expect(buildSearchQuery({ subject: 'test "quoted"' })).toBe(
      'subject:"test \\"quoted\\""'
    );
  });

  it('builds full query with all operators', () => {
    const result = buildSearchQuery({
      from: 'alice@example.com',
      to: 'bob@example.com',
      subject: 'meeting',
      hasAttachment: true,
      starred: true,
      afterDate: '2026-01-01',
      beforeDate: '2026-12-31',
      query: 'quarterly review',
    });
    expect(result).toBe(
      'from:alice@example.com to:bob@example.com subject:meeting has:attachment is:starred after:2026/01/01 before:2026/12/31 quarterly review'
    );
  });
});

describe('addFromFilter', () => {
  it('adds from: filter to empty query', () => {
    expect(addFromFilter('', 'sender@example.com')).toBe(
      'from:sender@example.com'
    );
  });

  it('adds from: filter to existing query', () => {
    expect(addFromFilter('subject:test', 'sender@example.com')).toBe(
      'subject:test from:sender@example.com'
    );
  });

  it('replaces existing from: filter', () => {
    expect(addFromFilter('from:old@example.com subject:test', 'new@example.com')).toBe(
      'subject:test from:new@example.com'
    );
  });

  it('handles sender with spaces', () => {
    expect(addFromFilter('', 'John Doe')).toBe('from:"John Doe"');
  });
});

describe('addToFilter', () => {
  it('adds to: filter to empty query', () => {
    expect(addToFilter('', 'recipient@example.com')).toBe(
      'to:recipient@example.com'
    );
  });

  it('adds to: filter to existing query', () => {
    expect(addToFilter('subject:test', 'recipient@example.com')).toBe(
      'subject:test to:recipient@example.com'
    );
  });

  it('replaces existing to: filter', () => {
    expect(addToFilter('to:old@example.com subject:test', 'new@example.com')).toBe(
      'subject:test to:new@example.com'
    );
  });
});

describe('removeFromFilter', () => {
  it('removes from: filter from query', () => {
    expect(removeFromFilter('from:sender@example.com subject:test')).toBe(
      'subject:test'
    );
  });

  it('returns empty string when only from: filter exists', () => {
    expect(removeFromFilter('from:sender@example.com')).toBe('');
  });

  it('does nothing when no from: filter exists', () => {
    expect(removeFromFilter('subject:test has:attachment')).toBe(
      'subject:test has:attachment'
    );
  });

  it('normalizes extra spaces after removal', () => {
    expect(removeFromFilter('from:x  subject:test')).toBe('subject:test');
  });
});

describe('removeToFilter', () => {
  it('removes to: filter from query', () => {
    expect(removeToFilter('to:recipient@example.com subject:test')).toBe(
      'subject:test'
    );
  });

  it('returns empty string when only to: filter exists', () => {
    expect(removeToFilter('to:recipient@example.com')).toBe('');
  });

  it('does nothing when no to: filter exists', () => {
    expect(removeToFilter('from:x has:attachment')).toBe(
      'from:x has:attachment'
    );
  });
});

describe('toggleAttachmentFilter', () => {
  it('adds has:attachment when not present', () => {
    expect(toggleAttachmentFilter('subject:test')).toBe(
      'subject:test has:attachment'
    );
  });

  it('removes has:attachment when present', () => {
    expect(toggleAttachmentFilter('subject:test has:attachment')).toBe(
      'subject:test'
    );
  });

  it('adds to empty query', () => {
    expect(toggleAttachmentFilter('')).toBe('has:attachment');
  });

  it('returns empty string when toggling off from just has:attachment', () => {
    expect(toggleAttachmentFilter('has:attachment')).toBe('');
  });

  it('handles multiple spaces gracefully', () => {
    expect(toggleAttachmentFilter('subject:test  has:attachment')).toBe(
      'subject:test'
    );
  });
});

describe('toggleStarredFilter', () => {
  it('adds is:starred when not present', () => {
    expect(toggleStarredFilter('subject:test')).toBe(
      'subject:test is:starred'
    );
  });

  it('removes is:starred when present', () => {
    expect(toggleStarredFilter('subject:test is:starred')).toBe(
      'subject:test'
    );
  });

  it('adds to empty query', () => {
    expect(toggleStarredFilter('')).toBe('is:starred');
  });

  it('returns empty string when toggling off from just is:starred', () => {
    expect(toggleStarredFilter('is:starred')).toBe('');
  });

  it('handles multiple spaces gracefully', () => {
    expect(toggleStarredFilter('subject:test  is:starred')).toBe(
      'subject:test'
    );
  });
});
