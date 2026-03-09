const mqtt = require('mqtt');

const BROKER = 'mqtt://localhost:1883';
const TOPIC = 'esp32/gateway/controller';
const INTERVAL_MS = 5000;
const ONCE = process.argv.includes('--once');

const NODE = {
  id: 'node_gps_8',
  name: 'GPS Node #8',
  mac: '24:6F:28:AA:BB:08',
};

const BASE_LAT = 20.8475;
const BASE_LNG = 106.6850;

const ALL_NODE_IDS = ['node_gps_1', 'node_gps_2', 'node_gps_3', 'node_gps_4', 'node_gps_5', 'node_gps_6', 'node_gps_7', 'node_gps_8', 'node_gps_9', 'node_gps_10'];

let seq = 0;

function pickConnectedNodes() {
  const pool = ALL_NODE_IDS.filter((nodeId) => nodeId !== NODE.id);
  const count = Math.floor(Math.random() * 3) + 3; // 3 to 5
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function buildPayload() {
  const now = new Date();
  seq += 1;
  const lat = BASE_LAT;
  const lng = BASE_LNG;
  const gps = {
    lat,
    lng,
    satellites: 8 + (seq % 4),
    hdop: 0.7 + ((seq % 6) * 0.05),
    timestamp: now.toISOString(),
  };

  return {
    node_id: NODE.id,
    node_name: NODE.name,
    node_mac: NODE.mac,
    status: 'online',
    uptime: Math.floor(process.uptime()),
    heartbeat_seq: seq,
    sensor_timestamp: now.toISOString(),
    gps,
    lat,
    lng,
    connected_nodes: pickConnectedNodes(),
  };
}

const client = mqtt.connect(BROKER, {
  clientId: `gps_node_sim_${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 1000,
});

function publishOnce() {
  const payload = buildPayload();
  console.log('[heartbeat_gps] payload:', JSON.stringify(payload));
  client.publish(TOPIC, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error(`[ERR] node -> gateway: ${err.message}`);
    } else {
      console.log(`[OK] node -> gateway (${TOPIC}) ${payload.node_id}`);
    }
  });
}

client.on('connect', () => {
  console.log(`Connected to ${BROKER}`);
  publishOnce();
  if (!ONCE) {
    setInterval(publishOnce, INTERVAL_MS);
  }
});

client.on('error', (err) => {
  console.error('MQTT error:', err.message);
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0));
});

