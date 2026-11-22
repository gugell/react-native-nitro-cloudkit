import type { CloudKitErrorCode } from './CloudKitError.ts';
import type { CloudKitAccountStatus } from './specs/CloudKitAccount.ts';
import type {
  CloudKitRecord,
  CloudKitRecordID,
  CloudKitRecordToSave,
} from './specs/CloudKitRecord.ts';

/** The iCloud account, as this container sees it. */
export interface CloudKitAccountInfo {
  readonly status: CloudKitAccountStatus;
  /** Stable fingerprint of the Apple ID for this container; null unless `available`. */
  readonly identity: string | null;
}

/** What changed since a token. */
export interface CloudKitFetchResult {
  readonly modified: readonly CloudKitRecord[];
  readonly deleted: readonly CloudKitRecordID[];
  /** Pass to the next `fetchChanges`; persist it only after applying these changes. */
  readonly token: string | null;
  /** The zone was deleted on the server: everything stored before is gone; push it again. */
  readonly zoneWasDeleted: boolean;
}

/** `pull()`'s result: the changes, and `commit()` to store their token once they are applied. */
export interface CloudKitPull extends CloudKitFetchResult {
  /** Stores the token in the token store. Call after applying; skip it to fetch them again. */
  commit(): Promise<void>;
}

/** Records to save and delete in one send. */
export interface CloudKitChangeRequest {
  readonly recordsToSave?: readonly CloudKitRecordToSave[];
  readonly recordsToDelete?: readonly CloudKitRecordID[];
}

/** A record CloudKit refused. */
export interface CloudKitSendFailure extends CloudKitRecordID {
  readonly code: CloudKitErrorCode;
  readonly message: string;
}

/** Per-record outcome of a send. */
export interface CloudKitSendOutcome {
  readonly saved: readonly CloudKitRecord[];
  readonly deleted: readonly CloudKitRecordID[];
  /** The server's newer versions (`serverRecordChanged`): merge, then send again. */
  readonly conflicts: readonly CloudKitRecord[];
  readonly failed: readonly CloudKitSendFailure[];
}
