import { NitroModules } from 'react-native-nitro-modules';
import type { CloudKitAdapter, CloudKitAdapterStore } from '../CloudKitAdapter.ts';
import { CloudKitError } from '../CloudKitError.ts';
import type { CloudKit } from '../specs/CloudKit.nitro.ts';

/**
 * CloudKit through CKSyncEngine (iOS 17+), as a Nitro hybrid object. On Android the native object
 * loads and reports itself unsupported; without the native module (Expo Go, not rebuilt) the
 * adapter is unsupported too. The hybrid object is created on first use.
 */
export function createNativeAdapter(): CloudKitAdapter {
  let root: CloudKit | null | undefined;
  let loadError: unknown;
  const load = (): CloudKit | null => {
    if (root !== undefined) return root;
    try {
      root = NitroModules.createHybridObject<CloudKit>('CloudKit');
    } catch (error) {
      loadError = error;
      root = null;
    }
    return root;
  };
  return {
    name: 'native',
    get isSupported() {
      return load()?.isSupported ?? false;
    },
    async openStore(options): Promise<CloudKitAdapterStore> {
      const native = load();
      if (!native)
        throw new CloudKitError(
          'misconfigured',
          'The native CloudKit module is not linked (rebuild the app; Expo Go cannot load it)',
          { cause: loadError },
        );
      return native.openStore(options);
    },
  };
}
