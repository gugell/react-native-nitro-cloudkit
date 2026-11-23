import {
  CloudKitError,
  type CloudKitClient,
  type CloudKitRecord,
  type CloudKitRecordToSave,
  type TokenStore,
} from 'react-native-nitro-cloudkit';

/*
 * WatermelonDB's sync protocol, written out structurally so this package never imports
 * WatermelonDB: the app's own copy is what runs, and these shapes are checked against it in tests.
 */

/** A record as WatermelonDB passes it to sync: columns plus `id`, `_status`, `_changed`. */
export type WatermelonRawRecord = { id: string } & Record<string, unknown>;

export interface WatermelonTableChangeSet {
  created: WatermelonRawRecord[];
  updated: WatermelonRawRecord[];
  deleted: string[];
}

export type WatermelonChangeSet = Record<string, WatermelonTableChangeSet>;

export interface WatermelonPullArgs {
  lastPulledAt?: number | null;
}

export interface WatermelonPullResult {
  changes: WatermelonChangeSet;
  timestamp: number;
}

export interface WatermelonPushArgs {
  changes: WatermelonChangeSet;
  lastPulledAt: number;
}

/** Spread into `synchronize({ database, ...sync, sendCreatedAsUpdated: true })`. */
export interface WatermelonSync {
  pullChanges(args: WatermelonPullArgs): Promise<WatermelonPullResult>;
  pushChanges(args: WatermelonPushArgs): Promise<void>;
}

/** How a WatermelonDB row maps to a CloudKit record. Every part can be replaced. */
export interface WatermelonCodec {
  /** Table → CloudKit record type. Default: the table name. */
  toRecordType(table: string): string;
  fromRecordType(recordType: string): string;
  /** Record name, unique across tables and not encrypted. Default `<table>.<id>`. */
  toRecordName(table: string, id: string): string;
  fromRecordName(table: string, recordName: string): string;
  /** One column's value → its encrypted field. Default: JSON. */
  encodeValue(value: unknown): string;
  decodeValue(field: string): unknown;
}

export const defaultWatermelonCodec: WatermelonCodec = {
  toRecordType: (table) => table,
  fromRecordType: (recordType) => recordType,
  toRecordName: (table, id) => `${table}.${id}`,
  fromRecordName: (table, recordName) =>
    recordName.startsWith(`${table}.`) ? recordName.slice(table.length + 1) : recordName,
  encodeValue: (value) => JSON.stringify(value ?? null),
  decodeValue: (field) => {
    if (field === '') return null;
    try {
      return JSON.parse(field) as unknown;
    } catch {
      return field;
    }
  },
};

export interface WatermelonSyncOptions {
  /**
   * Keeps the CloudKit token of each pull until WatermelonDB has applied it. Use a persistent
   * store (`createKeyValueTokenStore(new MMKV())`); the client's own token store is fine.
   */
  readonly tokenStore: TokenStore;
  /** Default `nitro-cloudkit-watermelondb:<container>:<zone>`. */
  readonly tokenKey?: string;
  /** Tables to sync. Default: every table WatermelonDB pushes, every record type pulled. */
  readonly tables?: readonly string[];
  /** Replace any part of the mapping; the rest stays default. */
  readonly codec?: Partial<WatermelonCodec>;
  /** Rounds of merge-and-resend when the server has newer versions. Default 3. */
  readonly conflictRounds?: number;
  /**
   * The zone was deleted on the server (iCloud data deleted, or `deleteAllData()` on another
   * device). The pull returns nothing for it; what the app keeps is up to it.
   */
  readonly onZoneDeleted?: () => void | Promise<void>;
}

/** Columns WatermelonDB keeps for itself: never uploaded. */
const LOCAL_COLUMNS = new Set(['id', '_status', '_changed']);

const columnsOf = (raw: WatermelonRawRecord) =>
  Object.entries(raw).filter(([column]) => !LOCAL_COLUMNS.has(column));

/** Columns changed since the last sync; null for a record created since (all of them). */
function changedColumns(raw: WatermelonRawRecord): Set<string> | null {
  if (raw._status === 'created' || typeof raw._changed !== 'string') return null;
  return new Set(raw._changed.split(',').filter(Boolean));
}

/**
 * WatermelonDB's `pullChanges` and `pushChanges` over a CloudKit client:
 *
 * ```ts
 * const sync = createWatermelonSync(cloud, { tokenStore });
 * await synchronize({ database, ...sync, sendCreatedAsUpdated: true });
 * ```
 *
 * Each row is one CloudKit record, each column one end-to-end encrypted field. The CloudKit token
 * of a pull is kept under WatermelonDB's `timestamp` and used only once WatermelonDB passes that
 * timestamp back as `lastPulledAt`, i.e. after it applied the changes: a crash refetches, never
 * skips. A push that meets a newer server version merges per column, like WatermelonDB does on
 * pull: the server's values, with the columns changed on this device on top, then sends again.
 */
export function createWatermelonSync(
  cloud: CloudKitClient,
  options: WatermelonSyncOptions,
): WatermelonSync {
  const codec: WatermelonCodec = { ...defaultWatermelonCodec, ...options.codec };
  const key =
    options.tokenKey ??
    `nitro-cloudkit-watermelondb:${cloud.containerIdentifier}:${cloud.zoneName}`;
  const tables = options.tables ? new Set(options.tables) : null;
  const syncs = (table: string) => !tables || tables.has(table);
  const rounds = Math.max(1, options.conflictRounds ?? 3);

  /** Tokens by the timestamp WatermelonDB was given with them. */
  async function readTokens(): Promise<Record<string, string | null>> {
    const stored = await options.tokenStore.get(key);
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string | null>) : {};
    } catch {
      return {};
    }
  }

  const encodeFields = (columns: Iterable<[string, unknown]>) => {
    const fields: Record<string, string> = {};
    for (const [column, value] of columns) fields[column] = codec.encodeValue(value);
    return fields;
  };

  const tableChanges = (changes: WatermelonChangeSet, table: string) =>
    (changes[table] ??= { created: [], updated: [], deleted: [] });

  return {
    async pullChanges({ lastPulledAt }) {
      const tokens = await readTokens();
      const confirmed = lastPulledAt == null ? undefined : String(lastPulledAt);
      // Unknown timestamp (first sync, cleared storage): fetch everything; applying is idempotent.
      const token = confirmed === undefined ? null : (tokens[confirmed] ?? null);
      const fetched = await cloud.fetchChanges(token);
      if (fetched.zoneWasDeleted) await options.onZoneDeleted?.();

      const changes: WatermelonChangeSet = {};
      for (const record of fetched.modified) {
        const table = codec.fromRecordType(record.recordType);
        if (!syncs(table)) continue;
        const raw: WatermelonRawRecord = { id: codec.fromRecordName(table, record.recordName) };
        for (const [column, field] of Object.entries(record.encryptedFields)) {
          if (!LOCAL_COLUMNS.has(column)) raw[column] = codec.decodeValue(field);
        }
        // CloudKit does not say created or updated: `sendCreatedAsUpdated: true` expects this.
        tableChanges(changes, table).updated.push(raw);
      }
      for (const ref of fetched.deleted) {
        const table = codec.fromRecordType(ref.recordType);
        if (syncs(table))
          tableChanges(changes, table).deleted.push(codec.fromRecordName(table, ref.recordName));
      }

      const timestamp = Math.max(Date.now(), (lastPulledAt ?? 0) + 1);
      // Keep the token WatermelonDB confirmed (its apply may still fail and come back with it)
      // and this one; older ones are superseded.
      const next: Record<string, string | null> = { [String(timestamp)]: fetched.token };
      if (confirmed !== undefined && confirmed in tokens)
        next[confirmed] = tokens[confirmed] ?? null;
      await options.tokenStore.set(key, JSON.stringify(next));
      return { changes, timestamp };
    },

    async pushChanges({ changes }) {
      const local = new Map<string, { raw: WatermelonRawRecord; changed: Set<string> | null }>();
      let saves: CloudKitRecordToSave[] = [];
      const deletes: { recordType: string; recordName: string }[] = [];

      for (const [table, set] of Object.entries(changes)) {
        if (!syncs(table)) continue;
        const recordType = codec.toRecordType(table);
        for (const raw of [...set.created, ...set.updated]) {
          const recordName = codec.toRecordName(table, raw.id);
          local.set(recordName, { raw, changed: changedColumns(raw) });
          saves.push({ recordType, recordName, encryptedFields: encodeFields(columnsOf(raw)) });
        }
        for (const id of set.deleted) {
          deletes.push({ recordType, recordName: codec.toRecordName(table, id) });
        }
      }

      // Per column, as WatermelonDB merges on pull: the server's values, this device's changes on top.
      const merge = (
        server: CloudKitRecord,
        mine: { raw: WatermelonRawRecord; changed: Set<string> | null } | undefined,
      ): CloudKitRecordToSave => {
        const fields = { ...server.encryptedFields };
        if (mine) {
          for (const [column, value] of columnsOf(mine.raw)) {
            if (!mine.changed || mine.changed.has(column))
              fields[column] = codec.encodeValue(value);
          }
        }
        return {
          recordType: server.recordType,
          recordName: server.recordName,
          encryptedFields: fields,
        };
      };

      for (let round = 0; saves.length > 0 || (round === 0 && deletes.length > 0); round++) {
        if (round === rounds) {
          throw new CloudKitError(
            'conflict',
            `${saves.length} record(s) still conflict after ${rounds} rounds; sync again`,
          );
        }
        const result = await cloud.sendChanges({
          recordsToSave: saves,
          recordsToDelete: round === 0 ? deletes : [],
        });
        // Throwing leaves every change pending in WatermelonDB; the next sync sends them again.
        const failure = result.failed[0];
        if (failure) throw new CloudKitError(failure.code, failure.message);
        saves = result.conflicts.map((server) => merge(server, local.get(server.recordName)));
      }
    },
  };
}
