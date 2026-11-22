import spawn from 'cross-spawn';

/**
 * Nitrogen output is committed. Regenerate it and fail when anything changed: a spec edited
 * without `pnpm specs` ships bindings that do not match the TypeScript API.
 */
const generated = 'packages/react-native-nitro-cloudkit/nitrogen';
const run = (command, args) => spawn.sync(command, args, { stdio: 'inherit' });

const specs = run('pnpm', ['specs']);
if (specs.status !== 0) process.exit(specs.status ?? 1);
const status = spawn.sync('git', ['status', '--porcelain', '--', generated], { encoding: 'utf8' });
if (status.status !== 0) process.exit(1);
if (status.stdout.trim()) {
  console.error('Nitrogen output is stale. Run `pnpm specs` and commit nitrogen/generated:');
  console.error(status.stdout);
  process.exit(1);
}
console.log('Nitrogen output is reproducible.');
