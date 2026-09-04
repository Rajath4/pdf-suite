import { describe, expect, it } from 'vitest';
import { buildDecryptArgs, buildEncryptArgs } from './qpdf.js';

describe('qpdf arg builders', () => {
  it('requests AES-256 with owner defaulting to the user password', () => {
    expect(buildEncryptArgs('user123')).toEqual(['--encrypt', 'user123', 'user123', '256']);
    expect(buildEncryptArgs('user123', 'owner456')).toEqual(['--encrypt', 'user123', 'owner456', '256']);
  });

  it('passes the password through for decryption', () => {
    expect(buildDecryptArgs('s3cret!')).toEqual(['--password=s3cret!', '--decrypt']);
  });
});
