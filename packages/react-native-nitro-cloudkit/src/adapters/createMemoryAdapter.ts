import type { CloudKitAdapter, CloudKitAdapterStore } from '../CloudKitAdapter.ts';
import { CloudKitError, type CloudKitErrorCode } from '../CloudKitError.ts';
import type { CloudKitAccountChange, CloudKitAccountChangeType } from '../specs/CloudKitAccount.ts';
import type { CloudKitChangeSet, CloudKitSendResult } from '../specs/CloudKitChanges.ts';
import type { CloudKitRecord, CloudKitRecordID } from '../specs/CloudKitRecord.ts';
import type { CloudKitStoreOptions } from '../specs/CloudKitStoreOptions.ts';

/** An in-memory private database shared by every memory adapter (device) given it. */
export interface MemoryDatabase {
  /** Signs a user in (an identity) or out (null); open stores hear the account change. */
  setAccount(identity: string | null): void;
  /** The next `times` calls, on any device, reject with `code` (retries, offline, quota…). */
  failNext(code: CloudKitErrorCode, times?: number): void;
  /** What a zone holds now, for assertions and debugging. */
  records(containerIdentifier: string, zoneName: string): CloudKitRecord[];
  assetNames(containerIdentifier: string, zoneName: string): string[];
}

export interface MemoryDatabaseOptions {
  /** The signed-in user's identity; null starts signed out. Default `memory-user`. */
  readonly identity?: string | null;
}

export interface MemoryAdapterOptions {
  /** Share one database between adapters to simulate several devices. Default: a new one. */
  readonly database?: MemoryDatabase;
  /** Adapter name in logs. Default `memory`. */
  readonly name?: string;
  /** Copies an asset's file on `getAsset`; without it assets only record their source URI. */
  readonly copyFile?: (from: string, to: string) => void | Promise<void>;
}

interface Stored {
  record: CloudKitRecord;
  version: number;
}

interface LogEntry {
  seq: number;
  recordType: string;
  recordName: string;
}

class Zone {
  generation = 1;
  seq = 0;
  clock = 0;
  records = new Map<string, Stored>();
  log: LogEntry[] = [];
  assets = new Map<string, string>();

  stamp(): number {
    this.clock = Math.max(Date.now(), this.clock + 1);
    return this.clock;
  }

  token(): string {
    return `${this.generation}.${this.seq}`;
  }
}

const code = (value: CloudKitErrorCode, message: string) => new CloudKitError(value, message);

class Database implements MemoryDatabase {
  identity: string | null;
  private failures: CloudKitErrorCode[] = [];
  private zones = new Map<string, Zone>();
  readonly devices = new Set<Device>();

  constructor(options: MemoryDatabaseOptions) {
    this.identity = options.identity === undefined ? 'memory-user' : options.identity;
  }

  zone(containerIdentifier: string, zoneName: string): Zone {
    const key = `${containerIdentifier}/${zoneName}`;
    let zone = this.zones.get(key);
    if (!zone) {
      zone = new Zone();
      this.zones.set(key, zone);
    }
    return zone;
  }

  setAccount(identity: string | null): void {
    const before = this.identity;
    this.identity = identity;
    if (before === identity) return;
    const type: CloudKitAccountChangeType =
      before === null ? 'signIn' : identity === null ? 'signOut' : 'switchAccounts';
    for (const device of this.devices) device.accountChanged({ type });
  }

  failNext(value: CloudKitErrorCode, times = 1): void {
    for (let i = 0; i < times; i++) this.failures.push(value);
  }

  takeFailure(operation: string): void {
    const failure = this.failures.shift();
    if (failure) throw code(failure, `${operation} failed (simulated)`);
  }

  records(containerIdentifier: string, zoneName: string): CloudKitRecord[] {
    return [...this.zone(containerIdentifier, zoneName).records.values()].map((s) => s.record);
  }

  assetNames(containerIdentifier: string, zoneName: string): string[] {
    return [...this.zone(containerIdentifier, zoneName).assets.keys()];
  }
}

/** One device's view: the change tags it has seen, its listeners. */
class Device implements CloudKitAdapterStore {
  readonly containerIdentifier: string;
  readonly zoneName: string;
  private seen = new Map<string, number>();
  private accountListeners = new Set<(change: CloudKitAccountChange) => void>();
  private remoteListeners = new Set<() => void>();

  constructor(
    private readonly database: Database,
    private readonly options: CloudKitStoreOptions,
    private readonly copyFile: MemoryAdapterOptions['copyFile'],
  ) {
    this.containerIdentifier = options.containerIdentifier;
    this.zoneName = options.zoneName;
  }

  private get zone(): Zone {
    return this.database.zone(this.containerIdentifier, this.zoneName);
  }

  /** Simulated failures first, then the account: signed out means `not_authenticated`. */
  private gate(operation: string): Zone {
    this.database.takeFailure(operation);
    if (this.database.identity === null) throw code('not_authenticated', 'No iCloud account');
    return this.zone;
  }

  accountChanged(change: CloudKitAccountChange): void {
    if (change.type !== 'signIn') this.seen.clear();
    for (const listener of [...this.accountListeners]) listener(change);
  }

  /** Another device wrote: what CKSyncEngine's silent push would trigger. */
  remoteChanged(): void {
    if (!this.options.automaticallySync) return;
    for (const listener of [...this.remoteListeners]) listener();
  }

  private notifyOthers(): void {
    const others = [...this.database.devices].filter(
      (device) =>
        device !== this &&
        device.containerIdentifier === this.containerIdentifier &&
        device.zoneName === this.zoneName,
    );
    void Promise.resolve().then(() => {
      for (const device of others) device.remoteChanged();
    });
  }

  async getAccount() {
    this.database.takeFailure('getAccount');
    const identity = this.database.identity;
    return identity === null
      ? { status: 'noAccount' as const }
      : { status: 'available' as const, identity };
  }

  addOnAccountChangeListener(listener: (change: CloudKitAccountChange) => void) {
    this.accountListeners.add(listener);
    return {
      remove: () => {
        this.accountListeners.delete(listener);
      },
    };
  }

  addOnRemoteChangeListener(listener: () => void) {
    this.remoteListeners.add(listener);
    return {
      remove: () => {
        this.remoteListeners.delete(listener);
      },
    };
  }

  async fetchChanges(token?: string) {
    const zone = this.gate('fetchChanges');
    const [generation, seq] = (token ?? '').split('.').map(Number);
    const sameZone = token !== undefined && generation === zone.generation;
    const since = sameZone ? (seq ?? 0) : 0;
    const latest = new Map<string, LogEntry>();
    for (const entry of zone.log) if (entry.seq > since) latest.set(entry.recordName, entry);
    const modified: CloudKitRecord[] = [];
    const deleted: CloudKitRecordID[] = [];
    for (const entry of latest.values()) {
      const stored = zone.records.get(entry.recordName);
      if (stored) {
        this.seen.set(entry.recordName, stored.version);
        modified.push(stored.record);
      } else {
        this.seen.delete(entry.recordName);
        deleted.push({ recordType: entry.recordType, recordName: entry.recordName });
      }
    }
    return {
      modified,
      deleted,
      token: zone.token(),
      zoneWasDeleted: token !== undefined && !sameZone,
    };
  }

  async fetchRecord(recordType: string, recordName: string) {
    const stored = this.gate('fetchRecord').records.get(recordName);
    if (!stored || stored.record.recordType !== recordType) return undefined;
    this.seen.set(recordName, stored.version);
    return stored.record;
  }

  async sendChanges(changes: CloudKitChangeSet): Promise<CloudKitSendResult> {
    const zone = this.gate('sendChanges');
    const saving = new Set(changes.recordsToSave.map((r) => r.recordName));
    const both = changes.recordsToDelete.find((r) => saving.has(r.recordName));
    if (both) throw code('invalid_argument', `${both.recordName} is both saved and deleted`);
    const result: CloudKitSendResult = { saved: [], deleted: [], conflicts: [], failed: [] };
    for (const input of changes.recordsToSave) {
      const stored = zone.records.get(input.recordName);
      // Saving without the latest change tag: serverRecordChanged, with the server's version.
      if (stored && this.seen.get(input.recordName) !== stored.version) {
        this.seen.set(input.recordName, stored.version);
        result.conflicts.push(stored.record);
        continue;
      }
      const version = ++zone.seq;
      const record: CloudKitRecord = {
        recordType: input.recordType,
        recordName: input.recordName,
        encryptedFields: { ...stored?.record.encryptedFields, ...input.encryptedFields },
        modifiedAt: zone.stamp(),
      };
      zone.records.set(input.recordName, { record, version });
      zone.log.push({ seq: version, recordType: record.recordType, recordName: record.recordName });
      this.seen.set(input.recordName, version);
      result.saved.push(record);
    }
    for (const ref of changes.recordsToDelete) {
      if (zone.records.delete(ref.recordName))
        zone.log.push({ seq: ++zone.seq, recordType: ref.recordType, recordName: ref.recordName });
      this.seen.delete(ref.recordName);
      result.deleted.push(ref);
    }
    if (result.saved.length || result.deleted.length) this.notifyOthers();
    return result;
  }

  async putAsset(name: string, fileUri: string) {
    const zone = this.gate('putAsset');
    if (!zone.assets.has(name)) zone.assets.set(name, fileUri);
  }

  async getAsset(name: string, fileUri: string) {
    const source = this.gate('getAsset').assets.get(name);
    if (source === undefined) throw code('asset_not_found', `No asset named ${name}`);
    await this.copyFile?.(source, fileUri);
  }

  async removeAsset(name: string) {
    this.gate('removeAsset').assets.delete(name);
  }

  async reset() {
    this.seen.clear();
  }

  async deleteAllData() {
    const zone = this.gate('deleteAllData');
    zone.generation += 1;
    zone.seq = 0;
    zone.records.clear();
    zone.log = [];
    zone.assets.clear();
    this.seen.clear();
    this.notifyOthers();
  }
}

/** A private database in memory: tests, web previews, Android builds, multi-device demos. */
export function createMemoryDatabase(options: MemoryDatabaseOptions = {}): MemoryDatabase {
  return new Database(options);
}

/**
 * CloudKit's semantics without CloudKit: tokens, change tags and `serverRecordChanged` conflicts,
 * zone deletion, account changes, remote-change notifications between devices sharing a database.
 */
export function createMemoryAdapter(
  options: MemoryAdapterOptions = {},
): CloudKitAdapter & { readonly database: MemoryDatabase } {
  const database = options.database ?? new Database({});
  if (!(database instanceof Database))
    throw new TypeError('database must come from createMemoryDatabase()');
  const stores = new Map<string, Device>();
  return {
    name: options.name ?? 'memory',
    isSupported: true,
    database,
    async openStore(storeOptions) {
      const key = storeOptions.containerIdentifier;
      const existing = stores.get(key);
      if (existing) {
        if (existing.zoneName !== storeOptions.zoneName)
          throw code('invalid_argument', `${key} is already open with zone ${existing.zoneName}`);
        return existing;
      }
      const device = new Device(database, storeOptions, options.copyFile);
      stores.set(key, device);
      database.devices.add(device);
      return device;
    },
  };
}
