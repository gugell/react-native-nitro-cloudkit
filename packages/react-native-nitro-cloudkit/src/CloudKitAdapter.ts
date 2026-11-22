import type { CloudKitAccount, CloudKitAccountChange } from './specs/CloudKitAccount.ts';
import type {
  CloudKitChangeSet,
  CloudKitChanges,
  CloudKitSendResult,
} from './specs/CloudKitChanges.ts';
import type { CloudKitRecord } from './specs/CloudKitRecord.ts';
import type { CloudKitStoreOptions } from './specs/CloudKitStoreOptions.ts';
import type { ListenerSubscription } from './specs/ListenerSubscription.ts';

/**
 * A backend the client talks to: CKSyncEngine through Nitro (`react-native-nitro-cloudkit/native`),
 * an in-memory database (`/memory`), or your own. Adapters reject with a `CloudKitError`, or an
 * `Error` whose message starts `[nitro-cloudkit:<code>]`; the client maps both.
 */
export interface CloudKitAdapter {
  /** Shown in logs and diagnostics, e.g. `native` or `memory`. */
  readonly name: string;
  /** Whether this adapter works on this device right now. */
  readonly isSupported: boolean;
  /** Opens the store of a container and zone; called once per client. */
  openStore(options: CloudKitStoreOptions): Promise<CloudKitAdapterStore>;
}

/** One container's private database and record zone, as an adapter serves it. */
export interface CloudKitAdapterStore {
  readonly containerIdentifier: string;
  readonly zoneName: string;
  getAccount(): Promise<CloudKitAccount>;
  addOnAccountChangeListener(
    listener: (change: CloudKitAccountChange) => void,
  ): ListenerSubscription;
  addOnRemoteChangeListener(listener: () => void): ListenerSubscription;
  /** Changes since `token` (none: everything) and the token covering them. */
  fetchChanges(token?: string): Promise<CloudKitChanges>;
  fetchRecord(recordType: string, recordName: string): Promise<CloudKitRecord | undefined>;
  sendChanges(changes: CloudKitChangeSet): Promise<CloudKitSendResult>;
  putAsset(name: string, fileUri: string): Promise<void>;
  getAsset(name: string, fileUri: string): Promise<void>;
  removeAsset(name: string): Promise<void>;
  reset(): Promise<void>;
  deleteAllData(): Promise<void>;
}
