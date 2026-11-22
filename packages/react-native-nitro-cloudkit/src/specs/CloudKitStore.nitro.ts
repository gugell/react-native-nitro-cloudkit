import type { HybridObject } from 'react-native-nitro-modules';
import type { CloudKitAccount, CloudKitAccountChange } from './CloudKitAccount.ts';
import type { CloudKitChangeSet, CloudKitChanges, CloudKitSendResult } from './CloudKitChanges.ts';
import type { CloudKitRecord } from './CloudKitRecord.ts';
import type { ListenerSubscription } from './ListenerSubscription.ts';

/**
 * One container's private database, one record zone, driven by CKSyncEngine. Every method is
 * async and rejects with a coded error (`[nitro-cloudkit:<code>] message`) instead of hanging.
 */
export interface CloudKitStore extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly containerIdentifier: string;
  readonly zoneName: string;

  /** Account status, and the user's fingerprint when available. */
  getAccount(): Promise<CloudKitAccount>;
  /** Called when the iCloud account signs in, out, or switches. */
  addOnAccountChangeListener(
    listener: (change: CloudKitAccountChange) => void,
  ): ListenerSubscription;
  /** Called when CKSyncEngine fetched changes on its own; call `fetchChanges` to get them. */
  addOnRemoteChangeListener(listener: () => void): ListenerSubscription;

  /**
   * Changes since `token` (none: from the beginning), with the token to pass next time. Only the
   * returned token covers the returned changes; persist it after applying them.
   */
  fetchChanges(token?: string): Promise<CloudKitChanges>;
  /** One record from the server, or undefined when it does not exist. */
  fetchRecord(recordType: string, recordName: string): Promise<CloudKitRecord | undefined>;
  /** Saves and deletes records; per-record outcome, server versions for conflicts. */
  sendChanges(changes: CloudKitChangeSet): Promise<CloudKitSendResult>;

  /** Uploads a file as a CKAsset under `name`, unless one is stored already (assets never change). */
  putAsset(name: string, fileUri: string): Promise<void>;
  /** Downloads asset `name` to `fileUri` (replacing it). Rejects with `asset_not_found`. */
  getAsset(name: string, fileUri: string): Promise<void>;
  /** Deletes asset `name`; no error when it is already gone. */
  removeAsset(name: string): Promise<void>;

  /** Forgets local sync state (engine state, change tags); server data stays. */
  reset(): Promise<void>;
  /** Deletes both zones and everything in them from iCloud, then resets. */
  deleteAllData(): Promise<void>;
}
