const { spawn } = require('child_process');
const path = require('path');

const COUNT = Number(process.env.GPS_NODE_COUNT || 10);
const ONCE = process.argv.includes('--once');
const EXTRA_ARGS = process.argv.filter((arg) => arg !== '--once');

const nodesDir = path.join(__dirname, 'nodes');
const children = [];

function nodeFile(index) {
  return path.join(nodesDir, `node_gps${index}.js`);
}

function startNode(index) {
  const args = [nodeFile(index), ...EXTRA_ARGS];
  if (ONCE) args.push('--once');

  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[gps_runner] node_gps${index} exited via signal ${signal}`);
    } else {
      console.log(`[gps_runner] node_gps${index} exited with code ${code}`);
    }
  });

  children.push(child);
}

for (let i = 1; i <= COUNT; i += 1) {
  startNode(i);
}

function shutdown() {
  children.forEach((child) => {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  });
}

process.on('SIGINT', () => {
  shutdown();
  setTimeout(() => process.exit(0), 200);
});

process.on('SIGTERM', () => {
  shutdown();
  setTimeout(() => process.exit(0), 200);
});
