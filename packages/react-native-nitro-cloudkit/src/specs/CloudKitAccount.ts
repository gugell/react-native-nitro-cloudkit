/** The iCloud account's state on this device (`CKAccountStatus`). */
export type CloudKitAccountStatus =
  'available' | 'noAccount' | 'restricted' | 'couldNotDetermine' | 'temporarilyUnavailable';

/** The signed-in iCloud account, as far as this container can tell. */
export interface CloudKitAccount {
  status: CloudKitAccountStatus;
  /**
   * Stable fingerprint of the user for this container (a hash of the user record id), the same on
   * every device of that Apple ID. Absent unless `status` is `available`.
   */
  identity?: string;
}

/** How the account changed. */
export type CloudKitAccountChangeType = 'signIn' | 'signOut' | 'switchAccounts';

/** Sent when the iCloud account on this device changes. */
export interface CloudKitAccountChange {
  type: CloudKitAccountChangeType;
}
