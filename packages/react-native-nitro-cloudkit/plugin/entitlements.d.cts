export interface CloudKitPluginProps {
  /** The iCloud container; default `iCloud.<ios.bundleIdentifier>`. */
  containerIdentifier?: string;
  /** `aps-environment`; default: keep the app's value, else `development`. */
  apsEnvironment?: 'development' | 'production';
  /** `com.apple.developer.icloud-container-environment`; not set unless given. */
  containerEnvironment?: 'Development' | 'Production';
}

export interface ResolvedCloudKitPluginProps {
  containerIdentifier: string;
  apsEnvironment?: 'development' | 'production';
  containerEnvironment?: 'Development' | 'Production';
}

export function applyCloudKitEntitlements(
  entitlements: Record<string, unknown>,
  props: ResolvedCloudKitPluginProps,
): Record<string, unknown>;

export function applyBackgroundModes(infoPlist: Record<string, unknown>): Record<string, unknown>;

export function resolveProps(
  props: unknown,
  bundleIdentifier: string | undefined,
): ResolvedCloudKitPluginProps;
