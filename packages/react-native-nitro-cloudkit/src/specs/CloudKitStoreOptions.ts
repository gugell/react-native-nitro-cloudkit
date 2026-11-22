/**
 * Where a {@linkcode CloudKitStoreOptions} store keeps its records: one CloudKit container's
 * private database, in a record zone of its own.
 */
export interface CloudKitStoreOptions {
  /** The iCloud container, e.g. `iCloud.com.example.app`. It must be in the app's entitlements. */
  containerIdentifier: string;
  /**
   * The custom record zone that holds the records (CKSyncEngine needs one). Assets live in a
   * second zone, `<zoneName>_assets`, which sync never downloads in bulk.
   */
  zoneName: string;
  /** No single CloudKit call may take longer; a stuck one rejects with `timeout`. */
  timeoutSeconds: number;
  /**
   * Let CKSyncEngine fetch on its own (silent pushes, app launch). What it fetches is held until
   * the next `fetchChanges`; a remote-change listener hears about it.
   */
  automaticallySync: boolean;
}
