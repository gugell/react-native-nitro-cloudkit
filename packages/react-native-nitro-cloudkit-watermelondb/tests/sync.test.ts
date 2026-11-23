import { Database, Model, appSchema, tableSchema } from '@nozbe/watermelondb';
import lokijs from '@nozbe/watermelondb/adapters/lokijs/index.js';
import { hasUnsyncedChanges, synchronize } from '@nozbe/watermelondb/sync/index.js';
import { describe, expect, it } from 'vitest';
import {
  CloudKitError,
  createCloudKit,
  createMemoryTokenStore,
  type CloudKitClient,
} from 'react-native-nitro-cloudkit';
import {
  createMemoryAdapter,
  createMemoryDatabase,
  type MemoryDatabase,
} from 'react-native-nitro-cloudkit/memory';
import { createWatermelonSync, type WatermelonSyncOptions } from '../src/index.ts';

const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'notes',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'pinned', type: 'boolean' },
        { name: 'position', type: 'number' },
      ],
    }),
    tableSchema({ name: 'drafts', columns: [{ name: 'text', type: 'string' }] }),
  ],
});

class Note extends Model {
  static override table = 'notes';
}
class Draft extends Model {
  static override table = 'drafts';
}

// CommonJS from ESM: Vitest hands over the class, TypeScript (NodeNext) types the module object.
const LokiJSAdapter = lokijs as unknown as typeof lokijs.default;

const container = 'iCloud.com.example.watermelon';
const zone = 'Notes';

/** One device: a WatermelonDB database and a CloudKit client on the shared memory database. */
function device(
  cloudDatabase: MemoryDatabase,
  name: string,
  options: Partial<WatermelonSyncOptions> = {},
) {
  const database = new Database({
    adapter: new LokiJSAdapter({
      schema,
      dbName: name,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    }),
    modelClasses: [Note, Draft],
  });
  const cloud: CloudKitClient = createCloudKit({
    adapter: createMemoryAdapter({ database: cloudDatabase, name }),
    containerIdentifier: container,
    zoneName: zone,
    retry: false,
  });
  const sync = createWatermelonSync(cloud, { tokenStore: createMemoryTokenStore(), ...options });
  const notes = database.get<Note>('notes');
  return {
    database,
    cloud,
    sync: () => synchronize({ database, ...sync, sendCreatedAsUpdated: true }),
    create: (id: string, values: Record<string, unknown>) =>
      database.write(() =>
        notes.create((note) => {
          note._raw.id = id;
          for (const [column, value] of Object.entries(values))
            note._setRaw(column, value as never);
        }),
      ),
    edit: (id: string, values: Record<string, unknown>) =>
      database.write(async () => {
        const note = await notes.find(id);
        await note.update(() => {
          for (const [column, value] of Object.entries(values))
            note._setRaw(column, value as never);
        });
      }),
    remove: (id: string) => database.write(async () => (await notes.find(id)).markAsDeleted()),
    rows: async () =>
      (await notes.query().fetch())
        .map((note) => {
          const raw = note._raw as unknown as Record<string, unknown>;
          return {
            id: note.id,
            title: raw.title,
            body: raw.body,
            pinned: raw.pinned,
            position: raw.position,
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe('createWatermelonSync', () => {
  it('syncs creates, edits and deletes between two WatermelonDB databases', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone');
    const mac = device(cloudDatabase, 'mac');

    await phone.create('n1', { title: 'Passport', body: 'renew', pinned: true, position: 1 });
    await phone.create('n2', { title: 'Milk', body: '', pinned: false, position: 2 });
    await phone.sync();
    expect(await hasUnsyncedChanges({ database: phone.database })).toBe(false);

    await mac.sync();
    expect(await mac.rows()).toEqual(await phone.rows());
    expect((await mac.rows()).map((row) => row.title)).toEqual(['Passport', 'Milk']);

    await mac.edit('n1', { body: 'renew before June' });
    await mac.remove('n2');
    await mac.sync();
    await phone.sync();
    expect(await phone.rows()).toEqual([
      { id: 'n1', title: 'Passport', body: 'renew before June', pinned: true, position: 1 },
    ]);
  });

  it('stores one encrypted field per column, never WatermelonDB bookkeeping', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone');
    await phone.create('n1', { title: 'Hi', body: 'there', pinned: false, position: 3 });
    await phone.sync();

    const [record] = cloudDatabase.records(container, zone);
    expect(record?.recordType).toBe('notes');
    expect(record?.recordName).toBe('notes.n1');
    expect(record?.encryptedFields).toEqual({
      title: '"Hi"',
      body: '"there"',
      pinned: 'false',
      position: '3',
    });
  });

  it('merges concurrent edits per column: each device keeps the column it changed', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone');
    const mac = device(cloudDatabase, 'mac');
    await phone.create('n1', { title: 'Trip', body: 'pack', pinned: false, position: 1 });
    await phone.sync();
    await mac.sync();

    // Offline on both: different columns of the same note.
    await phone.edit('n1', { title: 'Trip to Vienna' });
    await mac.edit('n1', { pinned: true });
    await phone.sync();
    await mac.sync(); // pull merges per column; the push goes over the newer server version
    await phone.sync();

    const expected = [
      { id: 'n1', title: 'Trip to Vienna', body: 'pack', pinned: true, position: 1 },
    ];
    expect(await phone.rows()).toEqual(expected);
    expect(await mac.rows()).toEqual(expected);
  });

  it('resolves a push conflict by merging the server version with the local changes', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone');
    const mac = device(cloudDatabase, 'mac');
    await phone.create('n1', { title: 'A', body: 'a', pinned: false, position: 1 });
    await phone.sync();
    await mac.sync();

    await phone.edit('n1', { body: 'from phone' });
    await phone.sync();
    // The mac pushes without pulling first: its change tag is stale.
    await mac.edit('n1', { title: 'from mac' });
    const sync = createWatermelonSync(mac.cloud, { tokenStore: createMemoryTokenStore() });
    await sync.pushChanges({
      changes: {
        notes: {
          created: [],
          updated: [
            {
              id: 'n1',
              title: 'from mac',
              body: 'a',
              pinned: false,
              position: 1,
              _status: 'updated',
              _changed: 'title',
            },
          ],
          deleted: [],
        },
      },
      lastPulledAt: 1,
    });
    expect(cloudDatabase.records(container, zone)[0]?.encryptedFields).toMatchObject({
      title: '"from mac"',
      body: '"from phone"',
    });
  });

  it('keeps changes pending when CloudKit fails, and sends them on the next sync', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone');
    await phone.create('n1', { title: 'Offline', body: '', pinned: false, position: 1 });

    cloudDatabase.failNext('network');
    await expect(phone.sync()).rejects.toBeInstanceOf(CloudKitError);
    expect(await hasUnsyncedChanges({ database: phone.database })).toBe(true);

    await phone.sync();
    expect(await hasUnsyncedChanges({ database: phone.database })).toBe(false);
    expect(cloudDatabase.records(container, zone)).toHaveLength(1);
  });

  it('fails the sync on a per-record failure, so WatermelonDB keeps the record pending', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone');
    await phone.create('n1', { title: 'Too big', body: '', pinned: false, position: 1 });
    const refusing: CloudKitClient = {
      ...phone.cloud,
      sendChanges: async () => ({
        saved: [],
        deleted: [],
        conflicts: [],
        failed: [
          {
            recordType: 'notes',
            recordName: 'notes.n1',
            code: 'record_too_large',
            message: 'over 1 MB',
          },
        ],
      }),
    };
    const sync = createWatermelonSync(refusing, { tokenStore: createMemoryTokenStore() });
    await expect(
      synchronize({ database: phone.database, ...sync, sendCreatedAsUpdated: true }),
    ).rejects.toMatchObject({ code: 'record_too_large' });
    expect(await hasUnsyncedChanges({ database: phone.database })).toBe(true);
  });

  it('refetches changes WatermelonDB did not confirm, and skips the ones it did', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone');
    await phone.create('n1', { title: 'One', body: '', pinned: false, position: 1 });
    await phone.sync();

    const sync = createWatermelonSync(phone.cloud, { tokenStore: createMemoryTokenStore() });
    const first = await sync.pullChanges({ lastPulledAt: null });
    expect(first.changes.notes?.updated.map((raw) => raw.id)).toEqual(['n1']);
    // Not applied (the app died): WatermelonDB asks again from its old timestamp.
    const again = await sync.pullChanges({ lastPulledAt: null });
    expect(again.changes.notes?.updated.map((raw) => raw.id)).toEqual(['n1']);
    // Applied: WatermelonDB passes the timestamp back, and only newer changes come.
    const after = await sync.pullChanges({ lastPulledAt: again.timestamp });
    expect(after.changes).toEqual({});
    expect(after.timestamp).toBeGreaterThan(again.timestamp);
  });

  it('syncs only the listed tables', async () => {
    const cloudDatabase = createMemoryDatabase();
    const phone = device(cloudDatabase, 'phone', { tables: ['notes'] });
    await phone.create('n1', { title: 'Synced', body: '', pinned: false, position: 1 });
    await phone.database.write(() =>
      phone.database.get<Draft>('drafts').create((draft) => {
        draft._setRaw('text', 'stays on this device');
      }),
    );
    await phone.sync();
    expect(cloudDatabase.records(container, zone).map((r) => r.recordType)).toEqual(['notes']);
  });

  it('reports a deleted zone to the app', async () => {
    const cloudDatabase = createMemoryDatabase();
    let zoneDeleted = 0;
    const phone = device(cloudDatabase, 'phone', {
      onZoneDeleted: () => {
        zoneDeleted += 1;
      },
    });
    await phone.create('n1', { title: 'Gone', body: '', pinned: false, position: 1 });
    await phone.sync();
    await phone.cloud.deleteAllData();
    await phone.sync();
    expect(zoneDeleted).toBe(1);
  });
});
