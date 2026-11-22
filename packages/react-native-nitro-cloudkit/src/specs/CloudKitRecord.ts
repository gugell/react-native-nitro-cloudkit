/** Identifies a record in the store's zone. */
export interface CloudKitRecordID {
  /** CloudKit record type: starts with a letter; letters, digits and `_`; at most 255. */
  recordType: string;
  /** Record name: ASCII, at most 255, not starting with `_`. Not encrypted: keep it opaque. */
  recordName: string;
}

/** A record as the server has it. */
export interface CloudKitRecord {
  recordType: string;
  recordName: string;
  /** String fields, stored in `CKRecord.encryptedValues` (end-to-end encrypted). */
  encryptedFields: Record<string, string>;
  /** When the server last changed it (ms since 1970). */
  modifiedAt: number;
}

/**
 * A record to save. The fields given replace those fields on the server; fields not given are
 * left as they are (send an empty string to clear one).
 */
export interface CloudKitRecordToSave {
  recordType: string;
  recordName: string;
  /** String fields, stored in `CKRecord.encryptedValues` (end-to-end encrypted). */
  encryptedFields: Record<string, string>;
}

/** A record CloudKit refused, with the reason. */
export interface CloudKitRecordFailure {
  recordType: string;
  recordName: string;
  /** Error code: `quota_exceeded`, `network`, `limit_exceeded`, … (see `CloudKitErrorCode`). */
  code: string;
  message: string;
}
