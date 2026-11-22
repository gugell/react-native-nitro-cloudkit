import { describe, expect, it } from 'vitest';
import { CloudKitError, isRetryable, toCloudKitError, toErrorCode } from '../src/CloudKitError.ts';

describe('toCloudKitError', () => {
  it('reads the code and message native code put in the error', () => {
    const error = toCloudKitError(new Error('[nitro-cloudkit:quota_exceeded] iCloud is full'));
    expect(error).toBeInstanceOf(CloudKitError);
    expect(error.code).toBe('quota_exceeded');
    expect(error.message).toBe('iCloud is full');
    expect(error.retryable).toBe(false);
  });

  it('reads retryAfter and finds the prefix inside a longer message', () => {
    const error = toCloudKitError(
      new Error('Error: [nitro-cloudkit:rate_limited;retryAfter=2.5] Slow down'),
    );
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(2.5);
    expect(error.retryable).toBe(true);
  });

  it('maps codes it does not know, and foreign errors, to unknown', () => {
    expect(toCloudKitError(new Error('[nitro-cloudkit:brand_new] x')).code).toBe('unknown');
    const foreign = toCloudKitError('boom');
    expect(foreign.code).toBe('unknown');
    expect(foreign.message).toBe('boom');
  });

  it('keeps a CloudKitError as it is', () => {
    const original = new CloudKitError('network', 'offline');
    expect(toCloudKitError(original)).toBe(original);
  });

  it('narrows codes and knows which are worth retrying', () => {
    expect(toErrorCode('network')).toBe('network');
    expect(toErrorCode('nope')).toBe('unknown');
    expect(isRetryable('timeout')).toBe(true);
    expect(isRetryable('not_authenticated')).toBe(false);
  });
});
