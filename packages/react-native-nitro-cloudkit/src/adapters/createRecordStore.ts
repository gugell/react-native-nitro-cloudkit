import type { CloudKitClient } from '../CloudKitClient.ts';
import { CloudKitError, type CloudKitErrorCode } from '../CloudKitError.ts';
import type { CloudKitRecord } from '../specs/CloudKitRecord.ts';

/**
 * A versioned record as last-writer-wins sync engines keep it (`@kit/sync`'s `SyncRecord`): a
 * header (`updatedAt`, `deleted`), the app's data, and the names of files that travel with it.
 */
export interface VersionedRecord {
  readonly type: string;
  readonly id: string;
  readonly updatedAt: number;
  readonly deleted: boolean;
  readonly data: unknown;
  readonly assets: readonly string[];
}

/** What a pull returns: changed records since `token`, and the token to pass next time. */
export interface RecordPullResult {
  readonly records: VersionedRecord[];
  readonly token: string | null;
  /** Records seen but not readable yet. CloudKit returns whole records, so always 0. */
  readonly pending: number;
  /** The zone was deleted on the server: push everything again. */
  readonly zoneWasDeleted: boolean;
}

export interface RecordPushResult {
  /** Keys (`type/id`) the store accepted. */
  readonly saved: string[];
  /** The server's newer versions of records it refused. */
  readonly conflicts: VersionedRecord[];
}

/** The record-store port of a sync engine, served by CloudKit. */
export interface RecordStore {
  isAvailable(): Promise<boolean>;
  /** Fingerprint of the signed-in account; null when signed out. */
  identity(): Promise<string | null>;
  pull(token: string | null): Promise<RecordPullResult>;
  get(type: string, id: string): Promise<VersionedRecord | null>;
  push(records: readonly VersionedRecord[]): Promise<RecordPushResult>;
  /** Removes a record for good (old deletions). */
  purge(type: string, id: string): Promise<void>;
  putAsset(name: string, localUri: string): Promise<void>;
  getAsset(name: string, localUri: string): Promise<void>;
  removeAsset(name: string): Promise<void>;
}

/** How versioned records map to CloudKit records. Every part can be replaced. */
export interface RecordStoreCodec {
  /** Sync type → CloudKit record type (letters, digits, `_`). Default: `-` becomes `_`. */
  toRecordType(type: string): string;
  fromRecordType(recordType: string): string;
  /** Record name, unique across types and not encrypted. Default `<type>.<id>`. */
  toRecordName(type: string, id: string): string;
  fromRecordName(type: string, recordName: string): string;
  /** The encrypted fields that carry header and data. Default: one JSON `payload` field. */
  encode(record: VersionedRecord): Record<string, string>;
  /** Back from fields; null when they are not a record of this codec (skipped). */
  decode(fields: Readonly<Record<string, string>>): Omit<VersionedRecord, 'type' | 'id'> | null;
}

export const defaultRecordStoreCodec: RecordStoreCodec = {
  toRecordType: (type) => type.replaceAll('-', '_'),
  fromRecordType: (recordType) => recordType.replaceAll('_', '-'),
  toRecordName: (type, id) => `${type}.${id}`,
  fromRecordName: (type, recordName) =>
    recordName.startsWith(`${type}.`) ? recordName.slice(type.length + 1) : recordName,
  encode: (record) => ({
    payload: JSON.stringify({
      updatedAt: record.updatedAt,
      deleted: record.deleted,
      data: record.data,
      assets: record.assets,
    }),
  }),
  decode: (fields) => {
    if (fields.payload === undefined) return null;
    const parsed = JSON.parse(fields.payload) as Partial<Omit<VersionedRecord, 'type' | 'id'>>;
    if (typeof parsed.updatedAt !== 'number' || typeof parsed.deleted !== 'boolean') return null;
    return {
      updatedAt: parsed.updatedAt,
      deleted: parsed.deleted,
      data: parsed.data ?? null,
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
    };
  },
};

export interface RecordStoreOptions {
  /** Replace any part of the mapping; the rest stays default. */
  readonly codec?: Partial<RecordStoreCodec>;
  /**
   * Per-record failures that fail the whole push (the run cannot work) instead of leaving the
   * record unsaved for the next run. Default: not_authenticated, quota_exceeded, network,
   * misconfigured.
   */
  readonly fatalCodes?: readonly CloudKitErrorCode[];
}

const FATAL: readonly CloudKitErrorCode[] = [
  'not_authenticated',
  'quota_exceeded',
  'network',
  'misconfigured',
];

/** A sync engine's record store over a CloudKit client (its tokens stay with the engine). */
export function createRecordStore(
  client: CloudKitClient,
  options: RecordStoreOptions = {},
): RecordStore {
  const codec: RecordStoreCodec = { ...defaultRecordStoreCodec, ...options.codec };
  const fatal = new Set(options.fatalCodes ?? FATAL);

  const decode = (record: CloudKitRecord): VersionedRecord | null => {
    const body = codec.decode(record.encryptedFields);
    if (!body) return null;
    const type = codec.fromRecordType(record.recordType);
    return { type, id: codec.fromRecordName(type, record.recordName), ...body };
  };
  const decodeAll = (records: readonly CloudKitRecord[]) =>
    records.map(decode).filter((record): record is VersionedRecord => record !== null);
  const ref = (type: string, id: string) => ({
    recordType: codec.toRecordType(type),
    recordName: codec.toRecordName(type, id),
  });

  return {
    async isAvailable() {
      return client.isSupported && (await client.getAccount()).status === 'available';
    },
    async identity() {
      return (await client.getAccount()).identity;
    },
    async pull(token) {
      const changes = await client.fetchChanges(token);
      // Hard deletions follow purges of old tombstones: nothing to apply.
      return {
        records: decodeAll(changes.modified),
        token: changes.token,
        pending: 0,
        zoneWasDeleted: changes.zoneWasDeleted,
      };
    },
    async get(type, id) {
      const { recordType, recordName } = ref(type, id);
      const record = await client.fetchRecord(recordType, recordName);
      return record ? decode(record) : null;
    },
    async push(records) {
      const result = await client.sendChanges({
        recordsToSave: records.map((record) => ({
          ...ref(record.type, record.id),
          encryptedFields: codec.encode(record),
        })),
      });
      const failure = result.failed.find((f) => fatal.has(f.code));
      if (failure) throw new CloudKitError(failure.code, failure.message);
      return {
        saved: decodeAll(result.saved).map((record) => `${record.type}/${record.id}`),
        conflicts: decodeAll(result.conflicts),
      };
    },
    async purge(type, id) {
      await client.sendChanges({ recordsToDelete: [ref(type, id)] });
    },
    putAsset: (name, localUri) => client.putAsset(name, localUri),
    getAsset: (name, localUri) => client.getAsset(name, localUri),
    removeAsset: (name) => client.removeAsset(name),
  };
}
