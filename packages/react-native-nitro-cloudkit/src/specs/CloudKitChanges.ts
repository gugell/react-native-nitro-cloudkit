import type {
  CloudKitRecord,
  CloudKitRecordFailure,
  CloudKitRecordID,
  CloudKitRecordToSave,
} from './CloudKitRecord.ts';

/** What changed on the server since a token. */
export interface CloudKitChanges {
  /** Records created or changed (latest version of each). */
  modified: CloudKitRecord[];
  /** Records deleted for good. */
  deleted: CloudKitRecordID[];
  /** CKSyncEngine's serialized state; pass it to the next `fetchChanges`. Opaque. */
  token: string;
  /**
   * The zone was deleted on the server (the user cleared iCloud data, or another device called
   * `deleteAllData`). Everything the caller believes is stored is gone; push it again.
   */
  zoneWasDeleted: boolean;
}

/** Records to save and delete in one send. */
export interface CloudKitChangeSet {
  recordsToSave: CloudKitRecordToSave[];
  recordsToDelete: CloudKitRecordID[];
}

/** The outcome of a send, per record. */
export interface CloudKitSendResult {
  /** Records the server accepted, as it stored them. */
  saved: CloudKitRecord[];
  /** Records deleted (or already gone). */
  deleted: CloudKitRecordID[];
  /**
   * The server had a newer version (`serverRecordChanged`); this is that version. Merge it and
   * send again: the next save goes over it.
   */
  conflicts: CloudKitRecord[];
  /** Records refused for another reason; nothing of them was written. */
  failed: CloudKitRecordFailure[];
}
