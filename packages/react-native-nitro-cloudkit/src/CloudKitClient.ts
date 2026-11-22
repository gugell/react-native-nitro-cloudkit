import type { CloudKitAccountChange } from './specs/CloudKitAccount.ts';
import type { CloudKitRecord } from './specs/CloudKitRecord.ts';
import type {
  CloudKitAccountInfo,
  CloudKitChangeRequest,
  CloudKitFetchResult,
  CloudKitPull,
  CloudKitSendOutcome,
} from './types.ts';

/**
 * One container's private database and record zone. The store opens on first use; every call
 * rejects with a `CloudKitError`, retries what is worth retrying, and never waits forever.
 */
export interface CloudKitClient {
  /** The adapter's name (`native`, `memory`, …). */
  readonly adapter: string;
  readonly containerIdentifier: string;
  readonly zoneName: string;
  /** Whether the adapter works here (`native`: iOS 17+ with the module linked). */
  readonly isSupported: boolean;

  /** Opens the store now instead of on first use; rejects when it cannot be opened. */
  open(): Promise<void>;
  getAccount(): Promise<CloudKitAccountInfo>;
  /** Sign-in, sign-out, account switch. Returns a function that removes the listener. */
  onAccountChange(listener: (change: CloudKitAccountChange) => void): () => void;
  /** The backend fetched changes on its own; pull them. Returns a remover. */
  onRemoteChange(listener: () => void): () => void;

  /** Changes since `token` (null: everything). The caller keeps the token. */
  fetchChanges(token: string | null): Promise<CloudKitFetchResult>;
  /** Changes since the stored token, with `commit()` to store the new one. Needs a token store. */
  pull(): Promise<CloudKitPull>;
  fetchRecord(recordType: string, recordName: string): Promise<CloudKitRecord | null>;
  sendChanges(changes: CloudKitChangeRequest): Promise<CloudKitSendOutcome>;

  /** Uploads a file under `name` unless one is stored already (assets never change). */
  putAsset(name: string, fileUri: string): Promise<void>;
  /** Downloads asset `name` to `fileUri`. Rejects `asset_not_found`. */
  getAsset(name: string, fileUri: string): Promise<void>;
  removeAsset(name: string): Promise<void>;

  /** Forgets local sync state and the stored token; server data stays. */
  reset(): Promise<void>;
  /** Deletes the zones and everything in them from iCloud, then resets. */
  deleteAllData(): Promise<void>;
}
