import { describe, expect, it } from 'vitest';
import {
  MAX_RECORD_BYTES,
  checkContainer,
  checkRecord,
  checkRecordName,
  checkRecordType,
  checkZoneName,
  recordSize,
  utf8Length,
} from '../src/internal/validation.ts';

const codeOf = (run: () => void) => {
  try {
    run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe('validation', () => {
  it('accepts CloudKit-legal names and refuses the rest', () => {
    expect(codeOf(() => checkContainer('iCloud.com.whisperbrain.suitcase'))).toBeNull();
    expect(codeOf(() => checkContainer('com.whisperbrain.suitcase'))).toBe('invalid_argument');
    expect(codeOf(() => checkZoneName('Suitcase'))).toBeNull();
    expect(codeOf(() => checkZoneName('_defaultZone'))).toBe('invalid_argument');
    expect(codeOf(() => checkRecordType('document_reading'))).toBeNull();
    expect(codeOf(() => checkRecordType('document-reading'))).toBe('invalid_argument');
    expect(codeOf(() => checkRecordType('1doc'))).toBe('invalid_argument');
    expect(codeOf(() => checkRecordName('document/0b5d-uuid'))).toBeNull();
    expect(codeOf(() => checkRecordName('_system'))).toBe('invalid_argument');
    expect(codeOf(() => checkRecordName('has space'))).toBe('invalid_argument');
    expect(codeOf(() => checkRecordName('x'.repeat(256)))).toBe('invalid_argument');
  });

  it('counts UTF-8 bytes like CloudKit does', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('ä')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
    expect(recordSize({ encryptedFields: { a: 'äb' } })).toBe(4);
  });

  it('refuses a record over 1 MB before it reaches CloudKit', () => {
    const big = {
      recordType: 'doc',
      recordName: 'a',
      encryptedFields: { data: 'x'.repeat(MAX_RECORD_BYTES) },
    };
    expect(codeOf(() => checkRecord(big))).toBe('record_too_large');
    const ok = { recordType: 'doc', recordName: 'a', encryptedFields: { data: 'x'.repeat(1000) } };
    expect(codeOf(() => checkRecord(ok))).toBeNull();
    const badKey = { recordType: 'doc', recordName: 'a', encryptedFields: { 'bad-key': 'x' } };
    expect(codeOf(() => checkRecord(badKey))).toBe('invalid_argument');
  });
});
