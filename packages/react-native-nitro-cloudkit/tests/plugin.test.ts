import { describe, expect, it } from 'vitest';
import {
  applyBackgroundModes,
  applyCloudKitEntitlements,
  resolveProps,
} from '../plugin/entitlements.cjs';

const container = 'iCloud.com.whisperbrain.suitcase';

describe('config plugin', () => {
  it('adds CloudKit next to iCloud Documents without dropping anything', () => {
    const documents = {
      'com.apple.developer.icloud-services': ['CloudDocuments'],
      'com.apple.developer.icloud-container-identifiers': [container],
      'com.apple.developer.ubiquity-container-identifiers': [container],
      'com.apple.security.application-groups': ['group.com.whisperbrain.suitcase'],
    };
    const result = applyCloudKitEntitlements(documents, { containerIdentifier: container });
    expect(result['com.apple.developer.icloud-services']).toEqual(['CloudDocuments', 'CloudKit']);
    expect(result['com.apple.developer.icloud-container-identifiers']).toEqual([container]);
    expect(result['com.apple.developer.ubiquity-container-identifiers']).toEqual([container]);
    expect(result['com.apple.security.application-groups']).toEqual([
      'group.com.whisperbrain.suitcase',
    ]);
    expect(result['aps-environment']).toBe('development');
    expect(result).not.toHaveProperty('com.apple.developer.icloud-container-environment');
  });

  it('is idempotent and keeps an aps-environment another plugin set', () => {
    const once = applyCloudKitEntitlements(
      { 'aps-environment': 'production' },
      { containerIdentifier: container },
    );
    const twice = applyCloudKitEntitlements(once, { containerIdentifier: container });
    expect(twice).toEqual(once);
    expect(twice['aps-environment']).toBe('production');
    expect(twice['com.apple.developer.icloud-services']).toEqual(['CloudKit']);
  });

  it('sets the optional environments only when asked', () => {
    const result = applyCloudKitEntitlements(
      { 'aps-environment': 'development' },
      {
        containerIdentifier: container,
        apsEnvironment: 'production',
        containerEnvironment: 'Production',
      },
    );
    expect(result['aps-environment']).toBe('production');
    expect(result['com.apple.developer.icloud-container-environment']).toBe('Production');
  });

  it('adds the remote-notification background mode once', () => {
    const plist = applyBackgroundModes(applyBackgroundModes({ UIBackgroundModes: ['audio'] }));
    expect(plist.UIBackgroundModes).toEqual(['audio', 'remote-notification']);
  });

  it('defaults the container to the bundle id and refuses bad props', () => {
    expect(resolveProps(undefined, 'com.example.app').containerIdentifier).toBe(
      'iCloud.com.example.app',
    );
    expect(() => resolveProps({}, undefined)).toThrow(/containerIdentifier/);
    expect(() => resolveProps({ containerIdentifier: 'com.example' }, undefined)).toThrow();
    expect(() =>
      resolveProps({ containerIdentifier: container, apsEnvironment: 'prod' }, undefined),
    ).toThrow();
  });
});
