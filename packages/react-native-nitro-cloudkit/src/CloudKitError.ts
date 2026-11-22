/** Why a CloudKit call failed. Native errors carry these codes; the JS layer adds a few. */
export type CloudKitErrorCode =
  /** Not an Apple platform (Android, web). */
  | 'unsupported_platform'
  /** iOS older than 17 (no CKSyncEngine). */
  | 'unsupported_os'
  /** No iCloud account signed in, or iCloud Drive off for the app. */
  | 'not_authenticated'
  /** The account exists but cannot be used right now (e.g. needs the passcode re-entered). */
  | 'account_temporarily_unavailable'
  /** Offline, or the connection dropped. Retry later. */
  | 'network'
  /** CloudKit is busy or down. Retry after `retryAfterSeconds`. */
  | 'service_unavailable'
  /** Too many requests. Retry after `retryAfterSeconds`. */
  | 'rate_limited'
  /** The user's iCloud storage is full. */
  | 'quota_exceeded'
  /** The record zone does not exist (deleted, or not created yet). */
  | 'zone_not_found'
  | 'not_found'
  /** The server has a newer version of the record. */
  | 'conflict'
  /** A record is over CloudKit's 1 MB limit (assets excluded). */
  | 'record_too_large'
  /** A request was too large (too many records or bytes at once). */
  | 'limit_exceeded'
  | 'permission_denied'
  /** Wrong container, missing entitlement, or schema not deployed. A developer error. */
  | 'misconfigured'
  | 'asset_not_found'
  /** A local file could not be read or written. */
  | 'file_error'
  | 'invalid_argument'
  /** A call took longer than the timeout. */
  | 'timeout'
  | 'cancelled'
  | 'server_rejected'
  | 'unknown';

const CODES: ReadonlySet<string> = new Set<CloudKitErrorCode>([
  'unsupported_platform',
  'unsupported_os',
  'not_authenticated',
  'account_temporarily_unavailable',
  'network',
  'service_unavailable',
  'rate_limited',
  'quota_exceeded',
  'zone_not_found',
  'not_found',
  'conflict',
  'record_too_large',
  'limit_exceeded',
  'permission_denied',
  'misconfigured',
  'asset_not_found',
  'file_error',
  'invalid_argument',
  'timeout',
  'cancelled',
  'server_rejected',
  'unknown',
]);

const RETRYABLE: ReadonlySet<CloudKitErrorCode> = new Set<CloudKitErrorCode>([
  'network',
  'service_unavailable',
  'rate_limited',
  'timeout',
  'account_temporarily_unavailable',
]);

/** Narrows any string to a known code (`unknown` otherwise). */
export function toErrorCode(code: string): CloudKitErrorCode {
  return CODES.has(code) ? (code as CloudKitErrorCode) : 'unknown';
}

/** Whether trying again later can succeed (network, busy server, rate limit, timeout). */
export function isRetryable(code: CloudKitErrorCode): boolean {
  return RETRYABLE.has(code);
}

/** A failed CloudKit call, with a code to branch on. */
export class CloudKitError extends Error {
  override readonly name = 'CloudKitError';
  readonly code: CloudKitErrorCode;
  /** Seconds CloudKit asks to wait before retrying; undefined when it did not say. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: CloudKitErrorCode,
    message: string,
    options: { retryAfterSeconds?: number | undefined; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** Whether trying again later can succeed. */
  get retryable(): boolean {
    return isRetryable(this.code);
  }
}

const PREFIX = /\[nitro-cloudkit:([a-z_]+)(?:;retryAfter=([0-9.]+))?\]\s*/;

/**
 * Turns whatever a native call threw into a `CloudKitError`. Native errors carry
 * `[nitro-cloudkit:<code>;retryAfter=<s>] message` (anywhere in the text: Nitro may prefix it).
 */
export function toCloudKitError(error: unknown): CloudKitError {
  if (error instanceof CloudKitError) return error;
  const text = error instanceof Error ? error.message : String(error);
  const match = PREFIX.exec(text);
  if (!match) return new CloudKitError('unknown', text, { cause: error });
  const [whole, code = 'unknown', retryAfter] = match;
  const message = text.slice(match.index + whole.length).trim() || code;
  return new CloudKitError(toErrorCode(code), message, {
    retryAfterSeconds: retryAfter === undefined ? undefined : Number(retryAfter),
    cause: error,
  });
}
