import type { CloudKitAdapter } from './CloudKitAdapter.ts';
import { createUnsupportedAdapter } from './adapters/createUnsupportedAdapter.ts';

/** The web has no native CloudKit: this adapter reports `unsupported_platform`. */
export function createNativeAdapter(): CloudKitAdapter {
  return createUnsupportedAdapter('native', 'the web');
}
