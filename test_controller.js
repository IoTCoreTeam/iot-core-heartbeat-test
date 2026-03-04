const mqtt = require('mqtt');

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const TOPIC = process.env.CONTROLLER_TO_GATEWAY_TOPIC || 'esp32/gateway/controller';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000);
const ONCE = process.argv.includes('--once');

const CONTROLLER = {
  id: process.env.NODE_ID || 'node-control-001',
  name: process.env.NODE_NAME || 'Control Node #1',
  mac: process.env.NODE_MAC || '24:6F:28:AA:BB:01',
};

const DEVICES = {
  digital: { device: process.env.DIGITAL_DEVICE || 'pump', kind: 'digital' },
  analog: { device: process.env.ANALOG_DEVICE || 'fan_speed', kind: 'analog' },
};

let seq = 0;
let digitalOn = true;
let analogValue = 64;

function nextDevices() {
  digitalOn = !digitalOn;
  analogValue = (analogValue + 32) % 256;

  return [
    { ...DEVICES.digital, state: digitalOn ? 'on' : 'off' },
    { ...DEVICES.analog, state: analogValue },
  ];
}

function buildStatusKv(devices) {
  const parts = ['v=1'];
  devices.forEach((d) => {
    parts.push(`d=${d.device}`);
    parts.push(`k=${d.kind}`);
    parts.push(`s=${String(d.state)}`);
  });
  return parts.join(';');
}

function buildPayload() {
  const now = new Date();
  const devices = nextDevices();
  seq += 1;
  return {
    node_id: CONTROLLER.id,
    node_name: CONTROLLER.name,
    node_mac: CONTROLLER.mac,
    status: 'online',
    uptime: Math.floor(process.uptime()),
    heartbeat_seq: seq,
    sensor_timestamp: now.toISOString(),
    status_kv: buildStatusKv(devices),
    controller_states: devices.map((d) => ({
      device: d.device,
      kind: d.kind,
      state: d.state,
    })),
  };
}

const client = mqtt.connect(BROKER, {
  clientId: `controller_sim_${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 1000,
});

function publishOnce() {
  const payload = buildPayload();
  client.publish(TOPIC, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error(`[ERR] controller -> gateway: ${err.message}`);
    } else {
      console.log(`[OK] controller -> gateway (${TOPIC}) ${payload.node_id}`);
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
