const { spawnSync } = require('child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

if (process.platform === 'linux') {
  run(['rebuild', 'sqlite3', 'bcrypt'], {
    npm_config_build_from_source: 'true'
  });
} else {
  run(['rebuild', 'sqlite3', 'bcrypt']);
}
