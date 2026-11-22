import { CloudKitError, toCloudKitError } from '../CloudKitError.ts';

const timers = globalThis as unknown as {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** Resolves after `ms` (retry back-off). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms);
  });
}

/**
 * Settles with `promise`, or rejects with `timeout` after `ms` when it never does. Any rejection
 * becomes a `CloudKitError`.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = timers.setTimeout(
      () => reject(new CloudKitError('timeout', `${what} took longer than ${ms} ms`)),
      ms,
    );
    promise.then(
      (value) => {
        timers.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(timer);
        reject(toCloudKitError(error));
      },
    );
  });
}
