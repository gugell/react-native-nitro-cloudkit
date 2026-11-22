'use strict';

const SERVICES = 'com.apple.developer.icloud-services';
const CONTAINERS = 'com.apple.developer.icloud-container-identifiers';
const CONTAINER_ENVIRONMENT = 'com.apple.developer.icloud-container-environment';
const APS = 'aps-environment';

/** Adds `values` to a plist array, keeping what is there and its order. */
function union(existing, values) {
  const list = Array.isArray(existing) ? [...existing] : [];
  for (const value of values) if (!list.includes(value)) list.push(value);
  return list;
}

/**
 * The entitlements CKSyncEngine needs, merged into what the app already has: the CloudKit service
 * and the container next to any iCloud Documents ones (`CloudDocuments` and the ubiquity containers
 * stay), and push for silent change notifications.
 *
 * @param {Record<string, unknown>} entitlements
 * @param {{ containerIdentifier: string, apsEnvironment?: 'development' | 'production', containerEnvironment?: 'Development' | 'Production' }} props
 */
function applyCloudKitEntitlements(entitlements, props) {
  const result = { ...entitlements };
  result[SERVICES] = union(result[SERVICES], ['CloudKit']);
  result[CONTAINERS] = union(result[CONTAINERS], [props.containerIdentifier]);
  // An existing value wins: EAS and other plugins (expo-notifications) set it per build.
  if (props.apsEnvironment) result[APS] = props.apsEnvironment;
  else if (!result[APS]) result[APS] = 'development';
  if (props.containerEnvironment) result[CONTAINER_ENVIRONMENT] = props.containerEnvironment;
  return result;
}

/**
 * Silent pushes wake the app for CloudKit changes: `remote-notification` background mode.
 *
 * @param {Record<string, unknown>} infoPlist
 */
function applyBackgroundModes(infoPlist) {
  return {
    ...infoPlist,
    UIBackgroundModes: union(infoPlist.UIBackgroundModes, ['remote-notification']),
  };
}

/**
 * Checks plugin props; returns them normalized.
 *
 * @param {unknown} props
 * @param {string | undefined} bundleIdentifier
 */
function resolveProps(props, bundleIdentifier) {
  const input = props && typeof props === 'object' ? props : {};
  const containerIdentifier =
    input.containerIdentifier || (bundleIdentifier ? `iCloud.${bundleIdentifier}` : undefined);
  if (!containerIdentifier || !/^iCloud\.[A-Za-z0-9.-]+$/.test(containerIdentifier))
    throw new Error(
      'react-native-nitro-cloudkit: set containerIdentifier (iCloud.<id>) or ios.bundleIdentifier',
    );
  if (input.apsEnvironment && !['development', 'production'].includes(input.apsEnvironment))
    throw new Error('react-native-nitro-cloudkit: apsEnvironment is development or production');
  if (
    input.containerEnvironment &&
    !['Development', 'Production'].includes(input.containerEnvironment)
  )
    throw new Error(
      'react-native-nitro-cloudkit: containerEnvironment is Development or Production',
    );
  return {
    containerIdentifier,
    apsEnvironment: input.apsEnvironment,
    containerEnvironment: input.containerEnvironment,
  };
}

module.exports = { applyCloudKitEntitlements, applyBackgroundModes, resolveProps };
