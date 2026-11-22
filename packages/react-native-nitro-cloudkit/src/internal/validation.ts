import { CloudKitError } from '../CloudKitError.ts';
import type { CloudKitRecordToSave } from '../specs/CloudKitRecord.ts';

/** CloudKit's limit per record, excluding assets. */
export const MAX_RECORD_BYTES = 1_000_000;

const RECORD_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,254}$/;
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,254}$/;
/** Printable ASCII without spaces; CloudKit reserves names starting with `_`. */
const RECORD_NAME = /^[!-^`-~][!-~]{0,254}$/;
const ZONE_NAME = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,63}$/;

const invalid = (message: string) => new CloudKitError('invalid_argument', message);

export function checkContainer(containerIdentifier: string): void {
  if (!/^iCloud\.[A-Za-z0-9.-]+$/.test(containerIdentifier))
    throw invalid(`containerIdentifier must look like iCloud.com.example.app`);
}

export function checkZoneName(zoneName: string): void {
  if (!ZONE_NAME.test(zoneName))
    throw invalid(`zoneName must be 1–64 letters, digits, _ or -, not starting with _`);
}

export function checkRecordType(recordType: string): void {
  if (!RECORD_TYPE.test(recordType))
    throw invalid(`Record type "${recordType}": a letter, then letters, digits or _ (max 255)`);
}

/** Also used for asset names (an asset is a record named after it). */
export function checkRecordName(recordName: string): void {
  if (!RECORD_NAME.test(recordName))
    throw invalid(`Record name "${recordName}": printable ASCII, no spaces, not starting with _`);
}

export function checkFileUri(fileUri: string): void {
  if (!fileUri.startsWith('file://') && !fileUri.startsWith('/'))
    throw invalid('Expected a file:// URI or an absolute path');
}

/** UTF-8 length of a string, without TextEncoder (not in every JS runtime). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Bytes a record's fields take (UTF-8 keys and values): what counts toward the 1 MB limit. */
export function recordSize(record: Pick<CloudKitRecordToSave, 'encryptedFields'>): number {
  let bytes = 0;
  for (const [key, value] of Object.entries(record.encryptedFields))
    bytes += utf8Length(key) + utf8Length(value);
  return bytes;
}

export function checkRecord(record: CloudKitRecordToSave): void {
  checkRecordType(record.recordType);
  checkRecordName(record.recordName);
  for (const [key, value] of Object.entries(record.encryptedFields)) {
    if (!FIELD_KEY.test(key))
      throw invalid(`Field "${key}" of ${record.recordName}: a letter, then letters, digits or _`);
    if (typeof value !== 'string')
      throw invalid(`Field "${key}" of ${record.recordName} must be a string`);
  }
  const bytes = recordSize(record);
  if (bytes > MAX_RECORD_BYTES)
    throw new CloudKitError(
      'record_too_large',
      `${record.recordName} is ${bytes} bytes; CloudKit allows ${MAX_RECORD_BYTES} per record (put large data in an asset)`,
    );
}
