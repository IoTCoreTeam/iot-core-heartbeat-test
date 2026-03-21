const mqtt = require('mqtt');

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const SENSOR_TOPIC = process.env.SENSOR_DATA_TOPIC || 'esp32/sensors/data';
const HEARTBEAT_TOPIC = process.env.NODE_HEARTBEAT_TOPIC || 'esp32/nodes/heartbeat';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 5000);
const ONCE = process.argv.includes('--once');

const GATEWAY = {
  id: process.env.GATEWAY_ID || 'GW_001',
  ip: process.env.GATEWAY_IP || '192.168.1.249',
  mac: process.env.GATEWAY_MAC || '00:70:07:E6:7D:14',
};

const SENSOR_NODE = {
  nodeId: process.env.NODE_ID || 'node-sensor-001',
  nodeName: process.env.NODE_NAME || 'Sensor Node',
  nodeMac: process.env.NODE_MAC || '00:70:07:E5:F2:58',
  sensorId: process.env.SENSOR_ID || 'sensor-env-01',
};

const BASE = {
  temperature: Number(process.env.BASE_TEMPERATURE || 30),
  humidity: Number(process.env.BASE_HUMIDITY || 65),
  lightPercent: Number(process.env.BASE_LIGHT_PERCENT || 58),
  rainPercent: Number(process.env.BASE_RAIN_PERCENT || 12),
  soilPercent: Number(process.env.BASE_SOIL_PERCENT || 72),
  rssi: Number(process.env.BASE_RSSI || -58),
};

let heartbeatSeq = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function jitter(base, spread) {
  const delta = (Math.random() * 2 - 1) * spread;
  return base + delta;
}

function buildPercentAndRaw(percent) {
  const p = clamp(Math.round(percent), 0, 100);
  const raw = Math.round((p / 100) * 4095);
  return { raw, percent: p, unit: '%' };
}

function buildSensorPayload() {
  const now = new Date();
  const temperature = Number(jitter(BASE.temperature, 2).toFixed(1));
  const humidity = clamp(Math.round(jitter(BASE.humidity, 6)), 0, 100);
  const light = buildPercentAndRaw(jitter(BASE.lightPercent, 10));
  const rain = buildPercentAndRaw(jitter(BASE.rainPercent, 12));
  const soil = buildPercentAndRaw(jitter(BASE.soilPercent, 9));

  return {
    gateway_id: GATEWAY.id,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    node_id: SENSOR_NODE.nodeId,
    node_name: SENSOR_NODE.nodeName,
    node_mac: SENSOR_NODE.nodeMac,
    sensor_id: SENSOR_NODE.sensorId,
    temperature,
    humidity,
    light,
    rain,
    soil,
    sensor_timestamp: Date.now(),
    gateway_timestamp: now.toISOString(),
    sensor_rssi: clamp(Math.round(jitter(BASE.rssi, 6)), -100, -20),
  };
}

function buildHeartbeatPayload() {
  const now = new Date();
  heartbeatSeq += 1;

  return {
    type: 'node_heartbeat',
    gateway_id: GATEWAY.id,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    node_id: SENSOR_NODE.nodeId,
    node_name: SENSOR_NODE.nodeName,
    node_mac: SENSOR_NODE.nodeMac,
    sensor_id: SENSOR_NODE.sensorId,
    status: 'online',
    uptime: Math.floor(process.uptime()),
    heartbeat_seq: heartbeatSeq,
    sensor_rssi: clamp(Math.round(jitter(BASE.rssi, 5)), -100, -20),
    gateway_timestamp: now.toISOString(),
    sensor_timestamp: Date.now(),
  };
}

const client = mqtt.connect(BROKER, {
  clientId: `sensor_sim_${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 1000,
});

function publishSensorData() {
  const payload = buildSensorPayload();
  console.log('[sensor_test] sensor payload:', JSON.stringify(payload));
  client.publish(SENSOR_TOPIC, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error(`[ERR] sensor data -> server: ${err.message}`);
    } else {
      console.log(`[OK] sensor data -> server (${SENSOR_TOPIC}) ${payload.node_id}`);
    }
  });
}

function publishHeartbeat() {
  const payload = buildHeartbeatPayload();
  console.log('[sensor_test] heartbeat payload:', JSON.stringify(payload));
  client.publish(HEARTBEAT_TOPIC, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error(`[ERR] node heartbeat -> server: ${err.message}`);
    } else {
      console.log(`[OK] node heartbeat -> server (${HEARTBEAT_TOPIC}) ${payload.node_id}`);
    }
  });
}

client.on('connect', () => {
  console.log(`Connected to ${BROKER}`);
  publishSensorData();
  publishHeartbeat();

  if (!ONCE) {
    setInterval(publishSensorData, INTERVAL_MS);
    setInterval(publishHeartbeat, HEARTBEAT_INTERVAL_MS);
  }
});

client.on('error', (err) => {
  console.error('MQTT error:', err.message);
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0));
});
