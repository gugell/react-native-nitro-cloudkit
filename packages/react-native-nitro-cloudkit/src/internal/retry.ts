import type { CloudKitError } from '../CloudKitError.ts';
import type { RetryOptions } from '../RetryOptions.ts';

export interface RetryPolicy {
  readonly attempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
}

export function resolveRetry(options: RetryOptions | false | undefined): RetryPolicy {
  if (options === false) return { attempts: 1, initialDelayMs: 0, maxDelayMs: 0 };
  const policy = {
    attempts: options?.attempts ?? 3,
    initialDelayMs: options?.initialDelayMs ?? 500,
    maxDelayMs: options?.maxDelayMs ?? 30_000,
  };
  if (!Number.isInteger(policy.attempts) || policy.attempts < 1)
    throw new TypeError('retry.attempts must be a positive integer');
  if (policy.initialDelayMs < 0 || policy.maxDelayMs < 0)
    throw new TypeError('retry delays must not be negative');
  return policy;
}

/** Milliseconds to wait before try `attempt + 1`, or null when no try is left or worth it. */
export function retryDelay(
  policy: RetryPolicy,
  error: CloudKitError,
  attempt: number,
): number | null {
  if (!error.retryable || attempt >= policy.attempts) return null;
  const backoff = policy.initialDelayMs * 2 ** (attempt - 1);
  const asked = error.retryAfterSeconds === undefined ? backoff : error.retryAfterSeconds * 1000;
  return Math.min(policy.maxDelayMs, asked);
}
