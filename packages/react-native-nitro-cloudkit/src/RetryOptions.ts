/**
 * Retries of calls that failed with a retryable code (`network`, `service_unavailable`,
 * `rate_limited`, `timeout`, `account_temporarily_unavailable`). CloudKit's `retryAfter` wins over
 * the computed back-off.
 */
export interface RetryOptions {
  /** Total tries, the first included. Default 3; 1 disables retries. */
  readonly attempts?: number;
  /** Back-off before the second try; doubles each time. Default 500. */
  readonly initialDelayMs?: number;
  /** Longest wait between tries, CloudKit's `retryAfter` included. Default 30 000. */
  readonly maxDelayMs?: number;
}
