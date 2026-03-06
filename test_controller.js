const mqtt = require('mqtt');

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const TOPIC = process.env.CONTROLLER_TO_GATEWAY_TOPIC || 'esp32/gateway/controller';
const COMMAND_TOPIC_PREFIX = process.env.CONTROL_COMMAND_TOPIC_PREFIX || 'esp32/commands';
const GATEWAY_ID = process.env.GATEWAY_ID || 'GW_001';
const COMMAND_TOPIC = process.env.CONTROL_COMMAND_TOPIC || `${COMMAND_TOPIC_PREFIX}/${GATEWAY_ID}`;
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
let digitalOn = false;
let analogValue = 0;

function currentDevices() {
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
  const devices = currentDevices();
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

function normalizeDigitalState(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['on', 'true', '1', 'open', 'opened', 'enabled'].includes(normalized)) return true;
    if (['off', 'false', '0', 'close', 'closed', 'disabled'].includes(normalized)) return false;
  }
  return null;
}

function applyCommand(command) {
  if (!command || typeof command !== 'object') return;
  if (command.node_id && command.node_id !== CONTROLLER.id) return;

  if (command.device === DEVICES.digital.device) {
    const next = normalizeDigitalState(command.state);
    if (typeof next === 'boolean') {
      digitalOn = next;
      console.log(
        `[OK] command digital ${DEVICES.digital.device} -> ${digitalOn ? 'on' : 'off'}`
      );
    }
  }

  if (command.device === DEVICES.analog.device) {
    const value = Number(command.value ?? command.state);
    if (Number.isFinite(value)) {
      analogValue = value;
      console.log(`[OK] command analog ${DEVICES.analog.device} -> ${analogValue}`);
    }
  }
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
  client.subscribe(COMMAND_TOPIC, { qos: 1 }, (err) => {
    if (err) {
      console.error(`[ERR] subscribe ${COMMAND_TOPIC}: ${err.message}`);
    } else {
      console.log(`Subscribed to ${COMMAND_TOPIC}`);
    }
  });
  publishOnce();
  if (!ONCE) {
    setInterval(publishOnce, INTERVAL_MS);
  }
});

client.on('message', (topic, payloadBuf) => {
  if (topic !== COMMAND_TOPIC) return;
  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString());
  } catch (err) {
    console.error('[ERR] invalid command payload:', err.message);
    return;
  }
  applyCommand(payload);
});

client.on('error', (err) => {
  console.error('MQTT error:', err.message);
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0));
});
