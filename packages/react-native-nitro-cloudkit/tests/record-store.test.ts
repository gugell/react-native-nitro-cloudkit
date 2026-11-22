import { describe, expect, it } from 'vitest';
import { CloudKitError } from '../src/CloudKitError.ts';
import { createCloudKit } from '../src/createCloudKit.ts';
import { createMemoryAdapter, createMemoryDatabase } from '../src/memory.ts';
import { createRecordStore, type VersionedRecord } from '../src/record-store.ts';

const base = {
  containerIdentifier: 'iCloud.com.whisperbrain.suitcase',
  zoneName: 'Suitcase',
} as const;
const reading = (id: string, updatedAt: number, data: unknown): VersionedRecord => ({
  type: 'document-reading',
  id,
  updatedAt,
  deleted: false,
  data,
  assets: ['scan-1.jpg'],
});

function devices() {
  const database = createMemoryDatabase();
  const device = () =>
    createRecordStore(
      createCloudKit({ ...base, adapter: createMemoryAdapter({ database }), retry: false }),
    );
  return { database, phone: device(), mac: device() };
}

describe('createRecordStore', () => {
  it('serves the sync port: identity, pull with tokens, push with conflicts, purge, assets', async () => {
    const { phone, mac } = devices();
    expect(await phone.isAvailable()).toBe(true);
    expect(await phone.identity()).toBe('memory-user');

    await phone.putAsset('scan-1.jpg', 'file:///docs/scan-1.jpg');
    expect(await phone.push([reading('0b5d', 10, { title: 'Passport' })])).toEqual({
      saved: ['document-reading/0b5d'],
      conflicts: [],
    });

    const pulled = await mac.pull(null);
    expect(pulled.records).toEqual([reading('0b5d', 10, { title: 'Passport' })]);
    expect(pulled.pending).toBe(0);
    await mac.getAsset('scan-1.jpg', 'file:///mac/scan-1.jpg');

    await phone.push([reading('0b5d', 20, { title: 'Phone' })]);
    const clash = await mac.push([reading('0b5d', 15, { title: 'Mac' })]);
    expect(clash).toEqual({ saved: [], conflicts: [reading('0b5d', 20, { title: 'Phone' })] });

    expect(await mac.get('document-reading', '0b5d')).toEqual(
      reading('0b5d', 20, { title: 'Phone' }),
    );
    expect((await mac.pull(pulled.token)).records.map((r) => r.updatedAt)).toEqual([20]);

    await phone.purge('document-reading', '0b5d');
    expect(await mac.get('document-reading', '0b5d')).toBeNull();
  });

  it('reports signed out as unavailable, and fails a push on a fatal per-record code', async () => {
    const { database, phone } = devices();
    database.setAccount(null);
    expect(await phone.isAvailable()).toBe(false);
    expect(await phone.identity()).toBeNull();

    database.setAccount('user');
    database.failNext('quota_exceeded');
    await expect(phone.push([reading('a', 1, null)])).rejects.toBeInstanceOf(CloudKitError);
  });

  it('takes a custom codec, part by part', async () => {
    const database = createMemoryDatabase();
    const cloud = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });
    const store = createRecordStore(cloud, {
      codec: {
        toRecordName: (type, id) => `${type}:${id}`,
        fromRecordName: (type, name) => name.slice(type.length + 1),
      },
    });
    await store.push([reading('x1', 5, 'hi')]);
    expect(
      database
        .records(base.containerIdentifier, base.zoneName)
        .map((r) => [r.recordType, r.recordName]),
    ).toEqual([['document_reading', 'document-reading:x1']]);
    expect(await store.get('document-reading', 'x1')).toEqual(reading('x1', 5, 'hi'));
  });

  it('skips records it cannot decode', async () => {
    const database = createMemoryDatabase();
    const cloud = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });
    await cloud.sendChanges({
      recordsToSave: [{ recordType: 'other', recordName: 'o', encryptedFields: { x: '1' } }],
    });
    expect((await createRecordStore(cloud).pull(null)).records).toEqual([]);
  });
});
