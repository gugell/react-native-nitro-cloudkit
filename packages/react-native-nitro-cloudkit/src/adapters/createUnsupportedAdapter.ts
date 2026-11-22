import type { CloudKitAdapter } from '../CloudKitAdapter.ts';
import { CloudKitError } from '../CloudKitError.ts';

/** An adapter for where CloudKit does not exist: `isSupported` false, `openStore` rejects. */
export function createUnsupportedAdapter(name: string, platform: string): CloudKitAdapter {
  return {
    name,
    isSupported: false,
    openStore: () =>
      Promise.reject(
        new CloudKitError('unsupported_platform', `CloudKit is not available on ${platform}`),
      ),
  };
}
