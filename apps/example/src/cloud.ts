import { createCloudKit, createMemoryTokenStore } from 'react-native-nitro-cloudkit';
import { createMemoryAdapter } from 'react-native-nitro-cloudkit/memory';
import { createNativeAdapter } from 'react-native-nitro-cloudkit/native';

// CKSyncEngine where it exists (iOS 17+, rebuilt dev client); an in-memory database elsewhere
// (Android, web, older iOS), with the same API and semantics.
const native = createNativeAdapter();
const adapter = native.isSupported ? native : createMemoryAdapter();

export const cloud = createCloudKit({
  adapter,
  containerIdentifier: 'iCloud.com.gugell.nitrocloudkit.example',
  zoneName: 'Notes',
  tokenStore: createMemoryTokenStore(),
  logger: console,
});
