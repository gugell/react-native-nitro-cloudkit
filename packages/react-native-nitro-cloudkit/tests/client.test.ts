import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudKitAdapter, CloudKitAdapterStore } from '../src/CloudKitAdapter.ts';
import { CloudKitError } from '../src/CloudKitError.ts';
import type { CloudKitLogAttributes } from '../src/CloudKitLogger.ts';
import { createCloudKit } from '../src/createCloudKit.ts';
import { createKeyValueTokenStore, createMemoryTokenStore } from '../src/TokenStore.ts';
import { createUnsupportedAdapter } from '../src/adapters/createUnsupportedAdapter.ts';
import { createMemoryAdapter, createMemoryDatabase } from '../src/memory.ts';

const base = { containerIdentifier: 'iCloud.com.example.app', zoneName: 'Main' } as const;
const note = (name: string, title: string) => ({
  recordType: 'note',
  recordName: name,
  encryptedFields: { title },
});

async function rejection(promise: Promise<unknown>): Promise<CloudKitError> {
  try {
    await promise;
  } catch (error) {
    return error as CloudKitError;
  }
  throw new Error('expected a rejection');
}

afterEach(() => vi.useRealTimers());

describe('createCloudKit', () => {
  it('checks options when created', () => {
    const adapter = createMemoryAdapter();
    expect(() => createCloudKit({ ...base, adapter, containerIdentifier: 'nope' })).toThrow(
      CloudKitError,
    );
    expect(() => createCloudKit({ ...base, adapter, zoneName: '_x' })).toThrow(/zoneName/);
    expect(() => createCloudKit({ ...base, adapter, timeoutMs: 0 })).toThrow(/timeoutMs/);
    expect(() => createCloudKit({ ...base, adapter, retry: { attempts: 0 } })).toThrow(/attempts/);
  });

  it('reports an unsupported adapter with a typed error, without opening anything', async () => {
    const cloud = createCloudKit({
      ...base,
      adapter: createUnsupportedAdapter('native', 'Android'),
    });
    expect(cloud.isSupported).toBe(false);
    expect((await rejection(cloud.getAccount())).code).toBe('unsupported_platform');
  });

  it('opens the store once, lazily, with defaults passed to the adapter', async () => {
    const adapter = createMemoryAdapter();
    const openStore = vi.spyOn(adapter, 'openStore');
    const cloud = createCloudKit({ ...base, adapter });
    expect(openStore).not.toHaveBeenCalled();
    await Promise.all([cloud.getAccount(), cloud.fetchChanges(null), cloud.open()]);
    expect(openStore).toHaveBeenCalledTimes(1);
    expect(openStore).toHaveBeenCalledWith({
      ...base,
      timeoutSeconds: 60,
      automaticallySync: true,
    });
  });

  it('round-trips records, tokens and conflicts between two devices', async () => {
    const database = createMemoryDatabase();
    const phone = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });
    const mac = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });

    const first = await phone.fetchChanges(null);
    expect(first).toMatchObject({ modified: [], deleted: [], zoneWasDeleted: false });

    expect(
      (await phone.sendChanges({ recordsToSave: [note('n1', 'Passport')] })).saved,
    ).toHaveLength(1);
    expect((await mac.fetchChanges(null)).modified[0]?.encryptedFields).toEqual({
      title: 'Passport',
    });

    await phone.sendChanges({ recordsToSave: [note('n1', 'Passport 2')] });
    const clash = await mac.sendChanges({ recordsToSave: [note('n1', 'Mine')] });
    expect(clash.saved).toEqual([]);
    expect(clash.conflicts[0]?.encryptedFields.title).toBe('Passport 2');
    const merged = await mac.sendChanges({ recordsToSave: [note('n1', 'Merged')] });
    expect(merged.saved[0]?.encryptedFields.title).toBe('Merged');

    const later = await phone.fetchChanges(first.token);
    expect(later.modified.map((r) => r.encryptedFields.title)).toEqual(['Merged']);
    expect(await phone.fetchRecord('note', 'n1')).toMatchObject({ recordName: 'n1' });
    expect(await phone.fetchRecord('note', 'missing')).toBeNull();

    await mac.sendChanges({ recordsToDelete: [{ recordType: 'note', recordName: 'n1' }] });
    expect((await phone.fetchChanges(later.token)).deleted).toEqual([
      { recordType: 'note', recordName: 'n1' },
    ]);
  });

  it('pull() reads the stored token and commit() stores the new one', async () => {
    const values = new Map<string, string>();
    const tokenStore = createKeyValueTokenStore({
      getString: (key) => values.get(key),
      set: (key, value) => void values.set(key, value),
      delete: (key) => void values.delete(key),
    });
    const database = createMemoryDatabase();
    const writer = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });
    const reader = createCloudKit({
      ...base,
      adapter: createMemoryAdapter({ database }),
      tokenStore,
    });

    await writer.sendChanges({ recordsToSave: [note('a', 'A')] });
    const pull = await reader.pull();
    expect(pull.modified).toHaveLength(1);
    // Not committed (the app crashed before applying): the same changes come again.
    expect((await reader.pull()).modified).toHaveLength(1);
    await pull.commit();
    expect(values.get('nitro-cloudkit:iCloud.com.example.app:Main')).toBe(pull.token);
    expect((await reader.pull()).modified).toHaveLength(0);

    await reader.reset();
    expect(values.size).toBe(0);
    const noStore = createCloudKit({ ...base, adapter: createMemoryAdapter() });
    expect((await rejection(noStore.pull())).code).toBe('invalid_argument');
  });

  it('reports a deleted zone to devices holding an older token', async () => {
    const database = createMemoryDatabase();
    const a = createCloudKit({
      ...base,
      adapter: createMemoryAdapter({ database }),
      tokenStore: createMemoryTokenStore(),
    });
    const b = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });
    await a.sendChanges({ recordsToSave: [note('a', 'A')] });
    const pull = await a.pull();
    await pull.commit();
    await b.deleteAllData();
    expect((await a.pull()).zoneWasDeleted).toBe(true);
  });

  it('refuses what CloudKit would refuse before the adapter sees it', async () => {
    const adapter = createMemoryAdapter();
    const cloud = createCloudKit({ ...base, adapter });
    const big = 'x'.repeat(1_000_001);
    const error = await rejection(
      cloud.sendChanges({
        recordsToSave: [{ recordType: 'note', recordName: 'a', encryptedFields: { big } }],
      }),
    );
    expect(error.code).toBe('record_too_large');
    expect((await rejection(cloud.fetchRecord('note-type', 'a'))).code).toBe('invalid_argument');
    expect((await rejection(cloud.putAsset('a', 'relative/path'))).code).toBe('invalid_argument');
    expect(adapter.database.records(base.containerIdentifier, base.zoneName)).toEqual([]);
  });

  it('retries retryable failures with back-off, honouring retryAfter, and logs codes only', async () => {
    vi.useFakeTimers();
    const database = createMemoryDatabase();
    const logs: [string, CloudKitLogAttributes | undefined][] = [];
    const logger = {
      info: (message: string, attributes?: CloudKitLogAttributes) =>
        void logs.push([message, attributes]),
      warn: (message: string, attributes?: CloudKitLogAttributes) =>
        void logs.push([message, attributes]),
    };
    const cloud = createCloudKit({
      ...base,
      adapter: createMemoryAdapter({ database }),
      retry: { attempts: 3, initialDelayMs: 100 },
      logger,
    });
    database.failNext('network', 2);
    const pending = cloud.fetchChanges(null);
    await vi.advanceTimersByTimeAsync(100 + 200);
    await expect(pending).resolves.toMatchObject({ zoneWasDeleted: false });
    expect(
      logs.map(([message, attributes]) => [message, attributes?.code, attributes?.delayMs]),
    ).toEqual([
      ['cloudkit.fetchChanges.retry', 'network', 100],
      ['cloudkit.fetchChanges.retry', 'network', 200],
    ]);

    database.failNext('quota_exceeded');
    expect((await rejection(cloud.fetchChanges(null))).code).toBe('quota_exceeded');
    expect(logs.at(-1)?.[0]).toBe('cloudkit.fetchChanges.failed');
    expect(JSON.stringify(logs)).not.toContain('iCloud.com');
  });

  it('never waits forever on an adapter call that does not settle', async () => {
    vi.useFakeTimers();
    const store = {
      containerIdentifier: base.containerIdentifier,
      zoneName: base.zoneName,
      fetchChanges: () => new Promise(() => {}),
    } as unknown as CloudKitAdapterStore;
    const adapter: CloudKitAdapter = {
      name: 'stuck',
      isSupported: true,
      openStore: async () => store,
    };
    const cloud = createCloudKit({ ...base, adapter, timeoutMs: 1_000, retry: false });
    const pending = rejection(cloud.fetchChanges(null));
    await vi.advanceTimersByTimeAsync(2 * 1_000 + 5_000);
    expect((await pending).code).toBe('timeout');
  });

  it('maps coded errors from any adapter, and lets a failed open be tried again', async () => {
    let attempts = 0;
    const memory = createMemoryAdapter();
    const flaky: CloudKitAdapter = {
      name: 'flaky',
      isSupported: true,
      openStore: async (options) => {
        attempts += 1;
        if (attempts === 1) throw new Error('[nitro-cloudkit:misconfigured] missing entitlement');
        return memory.openStore(options);
      },
    };
    const cloud = createCloudKit({ ...base, adapter: flaky, retry: false });
    const error = await rejection(cloud.getAccount());
    expect(error).toBeInstanceOf(CloudKitError);
    expect(error.code).toBe('misconfigured');
    expect(error.message).toBe('missing entitlement');
    await expect(cloud.getAccount()).resolves.toEqual({
      status: 'available',
      identity: 'memory-user',
    });
  });

  it('delivers account changes and remote changes to listeners, removable before opening', async () => {
    const database = createMemoryDatabase();
    const phone = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });
    const mac = createCloudKit({ ...base, adapter: createMemoryAdapter({ database }) });
    const heard: string[] = [];
    const stopAccount = phone.onAccountChange((change) => heard.push(change.type));
    const stopRemote = phone.onRemoteChange(() => heard.push('remote'));
    const never = phone.onRemoteChange(() => heard.push('never'));
    never();
    await phone.open();

    await mac.sendChanges({ recordsToSave: [note('a', 'A')] });
    await Promise.resolve();
    database.setAccount('someone-else');
    expect(await phone.getAccount()).toEqual({ status: 'available', identity: 'someone-else' });
    database.setAccount(null);
    expect(await phone.getAccount()).toEqual({ status: 'noAccount', identity: null });
    expect((await rejection(phone.fetchChanges(null))).code).toBe('not_authenticated');
    stopAccount();
    stopRemote();
    database.setAccount('back');
    expect(heard).toEqual(['remote', 'switchAccounts', 'signOut']);
  });

  it('stores, fetches and removes assets', async () => {
    const copies: string[] = [];
    const adapter = createMemoryAdapter({
      copyFile: (from, to) => void copies.push(`${from}→${to}`),
    });
    const cloud = createCloudKit({ ...base, adapter });
    await cloud.putAsset('scan.jpg', 'file:///a/scan.jpg');
    await cloud.putAsset('scan.jpg', 'file:///other.jpg');
    await cloud.getAsset('scan.jpg', 'file:///b/scan.jpg');
    expect(copies).toEqual(['file:///a/scan.jpg→file:///b/scan.jpg']);
    await cloud.removeAsset('scan.jpg');
    expect((await rejection(cloud.getAsset('scan.jpg', '/tmp/x'))).code).toBe('asset_not_found');
  });
});
