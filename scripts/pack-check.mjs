import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import spawn from 'cross-spawn';

/**
 * Packs the library as npm would publish it, installs the tarball into a fresh npm project and
 * proves the result works: files present, no workspace or catalog specifiers left, the portable
 * entry points import in Node without Nitro, and the Expo config plugin loads.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'packages/react-native-nitro-cloudkit');
const watermelonRoot = join(root, 'packages/react-native-nitro-cloudkit-watermelondb');
const temporary = mkdtempSync(join(tmpdir(), 'nitro-cloudkit-pack-'));

function run(command, args, cwd) {
  const result = spawn.sync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}

try {
  const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  run('pnpm', ['pack', '--pack-destination', temporary], packageRoot);
  const tarball = join(temporary, `react-native-nitro-cloudkit-${version}.tgz`);
  run('pnpm', ['pack', '--pack-destination', temporary], watermelonRoot);
  const watermelonTarball = join(
    temporary,
    `react-native-nitro-cloudkit-watermelondb-${version}.tgz`,
  );

  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'packed-consumer', private: true, version: '1.0.0', type: 'module' }),
  );
  // Peers (react-native, nitro) are the app's: not installed here.
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--legacy-peer-deps',
      tarball,
      watermelonTarball,
    ],
    consumer,
  );
  const installed = join(consumer, 'node_modules/react-native-nitro-cloudkit');
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.private, undefined);
  const watermelonInstalled = join(
    consumer,
    'node_modules/react-native-nitro-cloudkit-watermelondb',
  );
  const watermelonManifest = JSON.parse(
    readFileSync(join(watermelonInstalled, 'package.json'), 'utf8'),
  );
  assert.equal(watermelonManifest.version, version);
  // WatermelonDB stays the app's: a peer, never installed by the core or by this package.
  assert.equal(watermelonManifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies['@nozbe/watermelondb'], undefined);
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies'])
    for (const spec of Object.values(watermelonManifest[section] ?? {}))
      assert.doesNotMatch(spec, /^(catalog|workspace|link|file):/, `Unresolved ${section} spec`);
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const spec of Object.values(manifest[section] ?? {})) {
      assert.doesNotMatch(spec, /^(catalog|workspace|link|file):/, `Unresolved ${section} spec`);
    }
  }

  const required = [
    'lib/index.js',
    'lib/index.d.ts',
    'lib/native.js',
    'lib/native.web.js',
    'lib/memory.js',
    'lib/record-store.js',
    'src/index.ts',
    'src/specs/CloudKit.nitro.ts',
    'NitroCloudKit.podspec',
    'nitro.json',
    'react-native.config.js',
    'app.plugin.cjs',
    'plugin/withCloudKit.cjs',
    'ios/Core/SyncStore.swift',
    'ios/Nitro/HybridCloudKit.swift',
    'android/src/main/java/com/margelo/nitro/cloudkit/HybridCloudKit.kt',
    'nitrogen/generated/ios/NitroCloudKit+autolinking.rb',
    'nitrogen/generated/android/NitroCloudKit+autolinking.gradle',
    'README.md',
    'LICENSE',
  ];
  for (const file of required) {
    assert.doesNotThrow(() => readFileSync(join(installed, file)), `Missing ${file}`);
  }
  for (const unwanted of ['tests', 'node_modules', 'tsconfig.json']) {
    assert(!readdirSync(installed).includes(unwanted), `Unexpected published ${unwanted}`);
  }

  const entry = (path) => pathToFileURL(join(installed, path)).href;
  const core = await import(entry('lib/index.js'));
  const memory = await import(entry('lib/memory.js'));
  const recordStore = await import(entry('lib/record-store.js'));
  const web = await import(entry('lib/native.web.js'));
  const cloud = core.createCloudKit({
    adapter: memory.createMemoryAdapter(),
    containerIdentifier: 'iCloud.com.example.packed',
    zoneName: 'Packed',
  });
  const sent = await cloud.sendChanges({
    recordsToSave: [{ recordType: 'note', recordName: 'n1', encryptedFields: { text: 'hi' } }],
  });
  assert.equal(sent.saved.length, 1);
  assert.equal(typeof recordStore.createRecordStore(cloud).pull, 'function');
  assert.equal(web.createNativeAdapter().isSupported, false);

  // Expo is the app's peer too: link the workspace copy so the config plugin can load.
  symlinkSync(join(root, 'node_modules/expo'), join(consumer, 'node_modules/expo'), 'dir');
  const require = createRequire(join(consumer, 'index.cjs'));
  assert.equal(typeof require('react-native-nitro-cloudkit/app.plugin'), 'function');
  assert.equal(typeof require('react-native-nitro-cloudkit/plugin'), 'function');

  const watermelon = await import(pathToFileURL(join(watermelonInstalled, 'lib/index.js')).href);
  const sync = watermelon.createWatermelonSync(cloud, {
    tokenStore: core.createMemoryTokenStore(),
  });
  const pulled = await sync.pullChanges({ lastPulledAt: null });
  assert.deepEqual(
    pulled.changes.note.updated.map((raw) => raw.id),
    ['n1'],
  );

  console.log(
    `Packed npm consumer verified: react-native-nitro-cloudkit(-watermelondb)@${version}`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
