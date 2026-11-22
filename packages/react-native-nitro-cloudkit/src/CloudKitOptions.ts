import type { CloudKitAdapter } from './CloudKitAdapter.ts';
import type { CloudKitLogger } from './CloudKitLogger.ts';
import type { RetryOptions } from './RetryOptions.ts';
import type { TokenStore } from './TokenStore.ts';

/** Everything `createCloudKit` can be told; only the adapter, container and zone are required. */
export interface CloudKitOptions {
  /** The backend: `createNativeAdapter()`, `createMemoryAdapter()`, or your own. */
  readonly adapter: CloudKitAdapter;
  /** The iCloud container, e.g. `iCloud.com.example.app` (in the app's entitlements). */
  readonly containerIdentifier: string;
  /** The custom record zone (letters, digits, `_`, `-`; at most 64). Assets use `<zone>_assets`. */
  readonly zoneName: string;
  /** No adapter call may take longer (assets: at least 5 minutes). Default 60 000. */
  readonly timeoutMs?: number;
  /** Let the backend fetch on its own (silent pushes, launch). Default true. */
  readonly automaticallySync?: boolean;
  /** Retries of retryable failures; `false` turns them off. Default 3 tries. */
  readonly retry?: RetryOptions | false;
  /** Enables `pull()`, which reads and commits the token itself. */
  readonly tokenStore?: TokenStore;
  /** Key of this client's token in the token store. Default `nitro-cloudkit:<container>:<zone>`. */
  readonly tokenKey?: string;
  /** Operations, durations, retries and error codes; never record contents. */
  readonly logger?: CloudKitLogger;
}
