import type { HybridObject } from 'react-native-nitro-modules';
import type { CloudKitStore } from './CloudKitStore.nitro.ts';
import type { CloudKitStoreOptions } from './CloudKitStoreOptions.ts';

/**
 * Entry point: opens {@linkcode CloudKitStore}s. iOS 17+ only (CKSyncEngine); on Android and on
 * older iOS `isSupported` is false and `openStore` rejects.
 */
export interface CloudKit extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** Whether this device can run CloudKit sync (iOS 17 or later). */
  readonly isSupported: boolean;
  /**
   * Opens the store of a container (one per container; opening it again returns the same one).
   * Rejects with `unsupported_platform`, `unsupported_os` or `invalid_argument`.
   */
  openStore(options: CloudKitStoreOptions): Promise<CloudKitStore>;
}
