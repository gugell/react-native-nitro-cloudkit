'use strict';

const {
  createRunOncePlugin,
  withEntitlementsPlist,
  withInfoPlist,
} = require('expo/config-plugins');
const {
  applyBackgroundModes,
  applyCloudKitEntitlements,
  resolveProps,
} = require('./entitlements.cjs');
const pkg = require('../package.json');

/**
 * Expo config plugin: CloudKit service + container, push for silent change notifications, and
 * the `remote-notification` background mode. Merges with iCloud Documents (`usesIcloudStorage`).
 *
 * ["react-native-nitro-cloudkit", { "containerIdentifier": "iCloud.com.example.app" }]
 */
const withCloudKit = (config, props) => {
  const resolved = resolveProps(props, config.ios && config.ios.bundleIdentifier);
  config = withInfoPlist(config, (mod) => {
    mod.modResults = applyBackgroundModes(mod.modResults);
    return mod;
  });
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults = applyCloudKitEntitlements(mod.modResults, resolved);
    return mod;
  });
  return config;
};

module.exports = createRunOncePlugin(withCloudKit, pkg.name, pkg.version);
