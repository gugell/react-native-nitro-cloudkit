import type { CloudKitAdapterStore } from './CloudKitAdapter.ts';
import type { CloudKitClient } from './CloudKitClient.ts';
import { CloudKitError, toCloudKitError, toErrorCode } from './CloudKitError.ts';
import type { CloudKitOptions } from './CloudKitOptions.ts';
import { sleep, withDeadline } from './internal/deadline.ts';
import { resolveRetry, retryDelay } from './internal/retry.ts';
import {
  checkContainer,
  checkFileUri,
  checkRecord,
  checkRecordName,
  checkRecordType,
  checkZoneName,
} from './internal/validation.ts';
import type { CloudKitSendOutcome } from './types.ts';

export const DEFAULT_TIMEOUT_MS = 60_000;
const ASSET_TIMEOUT_MS = 300_000;
/** The JS deadline only catches a call that never settles; adapters time out first. */
const GRACE_MS = 5_000;

/**
 * A CloudKit client over an adapter. Checks options now (throws `CloudKitError`
 * `invalid_argument`), opens the store on first use, and adds input checks, deadlines, retries,
 * token storage and logging on top of the adapter.
 */
export function createCloudKit(options: CloudKitOptions): CloudKitClient {
  const { adapter, containerIdentifier, zoneName, logger } = options;
  checkContainer(containerIdentifier);
  checkZoneName(zoneName);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!(timeoutMs > 0)) throw new CloudKitError('invalid_argument', 'timeoutMs must be > 0');
  const retry = resolveRetry(options.retry);
  const tokenKey = options.tokenKey ?? `nitro-cloudkit:${containerIdentifier}:${zoneName}`;
  // Adapter calls queue one at a time, each bounded: allow for one waiting ahead.
  const recordMs = 2 * timeoutMs + GRACE_MS;
  const assetMs = 2 * Math.max(timeoutMs, ASSET_TIMEOUT_MS) + GRACE_MS;
  const base = { adapter: adapter.name };

  let opening: Promise<CloudKitAdapterStore> | null = null;
  const open = (): Promise<CloudKitAdapterStore> => {
    if (opening) return opening;
    // An unsupported adapter rejects with its own reason (unsupported_os, unsupported_platform…).
    opening = (async () =>
      withDeadline(
        adapter.openStore({
          containerIdentifier,
          zoneName,
          timeoutSeconds: timeoutMs / 1000,
          automaticallySync: options.automaticallySync ?? true,
        }),
        timeoutMs + GRACE_MS,
        'Opening the store',
      ))().catch((error: unknown) => {
      opening = null;
      throw toCloudKitError(error);
    });
    return opening;
  };

  /** One operation: open, run within the deadline, retry retryable failures, log the outcome. */
  async function run<T>(
    operation: string,
    budgetMs: number,
    body: (store: CloudKitAdapterStore) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      try {
        const store = await open();
        const result = await withDeadline(body(store), budgetMs, operation);
        logger?.debug?.(`cloudkit.${operation}`, {
          ...base,
          attempt,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (raw) {
        const error = toCloudKitError(raw);
        const delay = retryDelay(retry, error, attempt);
        if (delay === null) {
          logger?.warn?.(`cloudkit.${operation}.failed`, { ...base, attempt, code: error.code });
          throw error;
        }
        logger?.info?.(`cloudkit.${operation}.retry`, {
          ...base,
          attempt,
          code: error.code,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }
  }

  /** Subscribes once the store is open; the remover works before and after. */
  function subscribe(add: (store: CloudKitAdapterStore) => { remove: () => void }): () => void {
    let removed = false;
    let remove: (() => void) | null = null;
    open().then(
      (store) => {
        if (removed) return;
        const subscription = add(store);
        remove = () => subscription.remove();
      },
      () => {},
    );
    return () => {
      removed = true;
      remove?.();
    };
  }

  const fetchChanges = (token: string | null) =>
    run('fetchChanges', recordMs, async (store) => {
      const changes = await store.fetchChanges(token ?? undefined);
      return {
        modified: changes.modified,
        deleted: changes.deleted,
        token: changes.token === '' ? null : changes.token,
        zoneWasDeleted: changes.zoneWasDeleted,
      };
    });

  const clearToken = async () => {
    if (options.tokenStore) await options.tokenStore.delete(tokenKey);
  };

  return {
    adapter: adapter.name,
    containerIdentifier,
    zoneName,
    get isSupported() {
      return adapter.isSupported;
    },

    open: async () => {
      await open();
    },

    getAccount: () =>
      run('getAccount', recordMs, async (store) => {
        const account = await store.getAccount();
        return { status: account.status, identity: account.identity ?? null };
      }),

    onAccountChange: (listener) => subscribe((store) => store.addOnAccountChangeListener(listener)),
    onRemoteChange: (listener) => subscribe((store) => store.addOnRemoteChangeListener(listener)),

    fetchChanges,

    async pull() {
      const tokens = options.tokenStore;
      if (!tokens)
        throw new CloudKitError('invalid_argument', 'pull() needs a tokenStore in createCloudKit');
      const stored = (await tokens.get(tokenKey)) ?? null;
      const changes = await fetchChanges(stored);
      return {
        ...changes,
        commit: async () => {
          if (changes.token === null) await tokens.delete(tokenKey);
          else await tokens.set(tokenKey, changes.token);
        },
      };
    },

    fetchRecord: (recordType, recordName) =>
      run('fetchRecord', recordMs, async (store) => {
        checkRecordType(recordType);
        checkRecordName(recordName);
        return (await store.fetchRecord(recordType, recordName)) ?? null;
      }),

    sendChanges: (changes) =>
      run('sendChanges', recordMs, async (store): Promise<CloudKitSendOutcome> => {
        const recordsToSave = [...(changes.recordsToSave ?? [])];
        const recordsToDelete = [...(changes.recordsToDelete ?? [])];
        recordsToSave.forEach(checkRecord);
        for (const ref of recordsToDelete) {
          checkRecordType(ref.recordType);
          checkRecordName(ref.recordName);
        }
        if (!recordsToSave.length && !recordsToDelete.length)
          return { saved: [], deleted: [], conflicts: [], failed: [] };
        const result = await store.sendChanges({ recordsToSave, recordsToDelete });
        logger?.debug?.('cloudkit.sendChanges.result', {
          ...base,
          saved: result.saved.length,
          deleted: result.deleted.length,
          conflicts: result.conflicts.length,
          failed: result.failed.length,
        });
        return {
          saved: result.saved,
          deleted: result.deleted,
          conflicts: result.conflicts,
          failed: result.failed.map((failure) => ({ ...failure, code: toErrorCode(failure.code) })),
        };
      }),

    putAsset: (name, fileUri) =>
      run('putAsset', assetMs, async (store) => {
        checkRecordName(name);
        checkFileUri(fileUri);
        await store.putAsset(name, fileUri);
      }),

    getAsset: (name, fileUri) =>
      run('getAsset', assetMs, async (store) => {
        checkRecordName(name);
        checkFileUri(fileUri);
        await store.getAsset(name, fileUri);
      }),

    removeAsset: (name) =>
      run('removeAsset', recordMs, async (store) => {
        checkRecordName(name);
        await store.removeAsset(name);
      }),

    reset: () =>
      run('reset', recordMs, async (store) => {
        await store.reset();
        await clearToken();
      }),

    deleteAllData: () =>
      run('deleteAllData', recordMs, async (store) => {
        await store.deleteAllData();
        await clearToken();
      }),
  };
}
