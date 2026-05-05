const { spawnSync } = require('child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const node = process.execPath;
const nativePackages = ['sqlite3', 'bcrypt'];

function run(args, extraEnv = {}) {
  console.log(`> ${npm} ${args.join(' ')}`);
  const options = {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv
    }
  };
  const result = process.platform === 'win32'
    ? spawnSync(`${npm} ${args.join(' ')}`, { ...options, shell: true })
    : spawnSync(npm, args, options);

  return result.status || 0;
}

function verifyNativePackages() {
  const script = nativePackages
    .map((packageName) => `require(${JSON.stringify(packageName)});`)
    .join('');
  console.log(`> ${node} -e "verify native packages"`);
  const result = spawnSync(node, ['-e', script], {
    stdio: 'inherit',
    env: process.env
  });

  return result.status || 0;
}

if (/^(1|true|yes)$/i.test(process.env.SKIP_NATIVE_REBUILD || '')) {
  console.log('Skipping native rebuild because SKIP_NATIVE_REBUILD is enabled.');
  process.exit(0);
}

if (/^(1|true|yes)$/i.test(process.env.FORCE_NATIVE_BUILD_FROM_SOURCE || '')) {
  const status = run(['rebuild', ...nativePackages], {
    npm_config_build_from_source: 'true'
  });
  process.exit(status === 0 ? verifyNativePackages() : status);
}

const fastStatus = run(['rebuild', ...nativePackages]);
if (fastStatus === 0 && verifyNativePackages() === 0) {
  process.exit(0);
}

if (process.platform !== 'linux') {
  process.exit(fastStatus);
}

console.warn('Fast native rebuild failed. Falling back to build_from_source for VPS compatibility.');
const sourceStatus = run(['rebuild', ...nativePackages], {
  npm_config_build_from_source: 'true'
});
process.exit(sourceStatus === 0 ? verifyNativePackages() : sourceStatus);
