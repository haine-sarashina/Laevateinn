import { describe, it, expect } from 'vitest';
import { basenameOf, bytesToBase64, inferMimeType, DEFAULT_MIME_TYPE } from '$lib/attachments';

describe('inferMimeType', () => {
    it('maps known extensions', () => {
        expect(inferMimeType('report.pdf')).toBe('application/pdf');
        expect(inferMimeType('photo.PNG')).toBe('image/png');
        expect(inferMimeType('sheet.xlsx')).toBe(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
    });

    it('falls back for unknown or missing extensions', () => {
        expect(inferMimeType('archive.unknownext')).toBe(DEFAULT_MIME_TYPE);
        expect(inferMimeType('LICENSE')).toBe(DEFAULT_MIME_TYPE);
        expect(inferMimeType('trailing.')).toBe(DEFAULT_MIME_TYPE);
    });

    it('uses the last extension of a multi-dot name', () => {
        expect(inferMimeType('backup.tar.gz')).toBe('application/gzip');
    });
});

describe('basenameOf', () => {
    it('handles Windows paths', () => {
        expect(basenameOf('C:\\Users\\me\\Documents\\file.pdf')).toBe('file.pdf');
    });

    it('handles POSIX paths', () => {
        expect(basenameOf('/home/me/file.pdf')).toBe('file.pdf');
    });

    it('handles a bare filename', () => {
        expect(basenameOf('file.pdf')).toBe('file.pdf');
    });

    it('ignores trailing separators', () => {
        expect(basenameOf('C:\\dir\\sub\\')).toBe('sub');
    });
});

describe('bytesToBase64', () => {
    it('encodes a short byte array', () => {
        // "hello" -> aGVsbG8=
        expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
    });

    it('encodes an empty array', () => {
        expect(bytesToBase64(new Uint8Array([]))).toBe('');
    });

    it('encodes payloads larger than one chunk without overflowing the stack', () => {
        const big = new Uint8Array(200_000).fill(65); // 'A'
        const encoded = bytesToBase64(big);
        expect(atob(encoded)).toHaveLength(200_000);
    });
});
