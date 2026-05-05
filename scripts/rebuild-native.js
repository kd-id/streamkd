const { spawnSync } = require('child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
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

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (/^(1|true|yes)$/i.test(process.env.SKIP_NATIVE_REBUILD || '')) {
  console.log('Skipping native rebuild because SKIP_NATIVE_REBUILD is enabled.');
  process.exit(0);
}

if (/^(1|true|yes)$/i.test(process.env.FORCE_NATIVE_BUILD_FROM_SOURCE || '')) {
  run(['rebuild', ...nativePackages], {
    npm_config_build_from_source: 'true'
  });
} else {
  run(['rebuild', ...nativePackages]);
}
