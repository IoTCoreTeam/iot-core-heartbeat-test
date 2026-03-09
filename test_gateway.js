const mqtt = require('mqtt');

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const INBOUND_TOPIC = process.env.CONTROLLER_TO_GATEWAY_TOPIC || 'esp32/gateway/controller';
const OUTBOUND_TOPIC = process.env.GATEWAY_TO_SERVER_TOPIC || 'esp32/controllers/heartbeat';
const GW_HEARTBEAT_TOPIC = process.env.GATEWAY_HEARTBEAT_TOPIC || 'esp32/heartbeat';
const GW_HEARTBEAT_INTERVAL_MS = Number(process.env.GW_HEARTBEAT_INTERVAL_MS || 5000);

const GATEWAY = {
  id: process.env.GATEWAY_ID || 'GW_001',
  ip: process.env.GATEWAY_IP || '192.168.1.249',
  mac: process.env.GATEWAY_MAC || '00:70:07:E6:7D:14',
};

function buildGatewayHeartbeat() {
  const now = new Date();
  return {
    gateway_id: GATEWAY.id,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    status: 'online',
    uptime: Math.floor(process.uptime()),
    timestamp: now.toISOString(),
  };
}

function parseStatusKv(kv) {
  if (!kv || typeof kv !== 'string') return [];
  const items = [];
  const parts = kv.split(';');
  let device = null;
  let kind = null;
  let state = null;
  parts.forEach((part) => {
    const [k, v] = part.split('=');
    if (!k) return;
    if (k === 'd') {
      if (device) {
        items.push({ device, kind: kind || 'digital', state: state ?? 'unknown' });
      }
      device = v || null;
      kind = null;
      state = null;
      return;
    }
    if (k === 'k') {
      kind = v || null;
      return;
    }
    if (k === 's') {
      state = v || null;
    }
  });
  if (device) {
    items.push({ device, kind: kind || 'digital', state: state ?? 'unknown' });
  }
  return items;
}

function buildControllerHeartbeat(controllerPayload) {
  const now = new Date();
  const nodeId = controllerPayload.node_id || 'node-control-001';
  const controllerStates = Array.isArray(controllerPayload.controller_states)
    ? controllerPayload.controller_states
    : parseStatusKv(controllerPayload.status_kv);

  return {
    type: 'node_heartbeat',
    gateway_id: GATEWAY.id,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    node_id: nodeId,
    node_name: controllerPayload.node_name || nodeId,
    node_ip: controllerPayload.node_ip || null,
    node_mac: controllerPayload.node_mac || null,
    status: controllerPayload.status || 'online',
    uptime: controllerPayload.uptime ?? null,
    heartbeat_seq: controllerPayload.heartbeat_seq ?? null,
    sensor_rssi: controllerPayload.sensor_rssi ?? -55,
    gateway_timestamp: now.toISOString(),
    sensor_timestamp: controllerPayload.sensor_timestamp || now.toISOString(),
    status_kv: controllerPayload.status_kv || null,
    controller_states: controllerStates,
    gps: controllerPayload.gps ?? null,
    lat: controllerPayload.lat ?? null,
    lng: controllerPayload.lng ?? null,
    latitude: controllerPayload.latitude ?? null,
    longitude: controllerPayload.longitude ?? null,
    connected_nodes: Array.isArray(controllerPayload.connected_nodes)
      ? controllerPayload.connected_nodes
      : null,
  };
}

const client = mqtt.connect(BROKER, {
  clientId: `gateway_sim_${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 1000,
});

client.on('connect', () => {
  console.log(`Connected to ${BROKER}`);
  client.subscribe(INBOUND_TOPIC, { qos: 1 }, (err) => {
    if (err) {
      console.error(`Subscribe error: ${err.message}`);
    } else {
      console.log(`Listening controller -> gateway: ${INBOUND_TOPIC}`);
    }
  });

  setInterval(() => {
    const hb = buildGatewayHeartbeat();
    client.publish(GW_HEARTBEAT_TOPIC, JSON.stringify(hb), { qos: 1 }, (err) => {
      if (!err) {
        console.log(`[OK] gateway heartbeat -> server (${GW_HEARTBEAT_TOPIC})`);
      }
    });
  }, GW_HEARTBEAT_INTERVAL_MS);
});

client.on('message', (topic, payloadBuf) => {
  if (topic !== INBOUND_TOPIC) return;
  let controllerPayload;
  try {
    controllerPayload = JSON.parse(payloadBuf.toString());
  } catch (err) {
    console.error('Invalid controller payload:', err.message);
    return;
  }

  const outPayload = buildControllerHeartbeat(controllerPayload);
  client.publish(OUTBOUND_TOPIC, JSON.stringify(outPayload), { qos: 1 }, (err) => {
    if (err) {
      console.error(`[ERR] gateway -> server: ${err.message}`);
    } else {
      console.log(`[OK] gateway -> server (${OUTBOUND_TOPIC}) ${outPayload.node_id}`);
    }
  });
});

client.on('error', (err) => {
  console.error('MQTT error:', err.message);
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0));
});
