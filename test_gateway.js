const mqtt = require('mqtt')

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883'

const GATEWAY = {
  id: process.env.GATEWAY_ID || 'TEST_GW_001',
  name: process.env.GATEWAY_NAME || '[TEST] Gateway Simulator 001',
  ip: process.env.GATEWAY_IP || '192.168.1.249',
  mac: process.env.GATEWAY_MAC || '00:70:07:E6:7D:14'
}

const COMMAND_TOPIC_PREFIX = process.env.CONTROL_COMMAND_TOPIC_PREFIX || 'esp32/commands'
const COMMAND_TOPIC = process.env.CONTROL_COMMAND_TOPIC || `${COMMAND_TOPIC_PREFIX}/${GATEWAY.id}`

const GATEWAY_TO_CONTROLLER_TOPIC =
  process.env.GATEWAY_TO_CONTROLLER_TOPIC || 'esp32/gateway/control-command'
const CONTROLLER_TO_GATEWAY_TOPIC =
  process.env.CONTROLLER_TO_GATEWAY_TOPIC || 'esp32/gateway/controller-updates'
const LEGACY_CONTROLLER_TO_GATEWAY_TOPIC =
  process.env.LEGACY_CONTROLLER_TO_GATEWAY_TOPIC || 'esp32/gateway/controller'

const SERVER_CONTROLLER_HEARTBEAT_TOPIC =
  process.env.SERVER_CONTROLLER_HEARTBEAT_TOPIC || 'esp32/controllers/heartbeat'
const SERVER_CONTROLLER_STATUS_EVENT_TOPIC =
  process.env.SERVER_CONTROLLER_STATUS_EVENT_TOPIC || 'esp32/controllers/status-event'
const SERVER_GATEWAY_HEARTBEAT_TOPIC =
  process.env.SERVER_GATEWAY_HEARTBEAT_TOPIC || 'esp32/heartbeat'

const GW_HEARTBEAT_INTERVAL_MS = Number(process.env.GW_HEARTBEAT_INTERVAL_MS || 5000)

function buildGatewayHeartbeat() {
  return {
    gateway_id: GATEWAY.id,
    gateway_name: GATEWAY.name,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    status: 'online',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }
}

function publishJson(client, topic, payload) {
  client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
    if (error) {
      console.error(`[ERR] publish ${topic}: ${error.message}`)
      return
    }
    console.log(`[OK] publish ${topic}: ${JSON.stringify(payload)}`)
  })
}

function forwardCommandToController(client, payload) {
  const forwarded = {
    ...payload,
    gateway_id: payload.gateway_id || GATEWAY.id,
    gateway_name: payload.gateway_name || GATEWAY.name,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    forwarded_at: new Date().toISOString()
  }
  publishJson(client, GATEWAY_TO_CONTROLLER_TOPIC, forwarded)
}

function forwardControllerUpdateToServer(client, payload) {
  const updateType = String(payload.event_type || payload.type || '').toLowerCase()
  const enriched = {
    ...payload,
    gateway_id: payload.gateway_id || GATEWAY.id,
    gateway_name: payload.gateway_name || GATEWAY.name,
    gateway_ip: payload.gateway_ip || GATEWAY.ip,
    gateway_mac: payload.gateway_mac || GATEWAY.mac
  }

  if (updateType === 'controller_status_event') {
    publishJson(client, SERVER_CONTROLLER_STATUS_EVENT_TOPIC, enriched)
    return
  }

  publishJson(client, SERVER_CONTROLLER_HEARTBEAT_TOPIC, enriched)
}

const client = mqtt.connect(BROKER, {
  clientId: `gateway_sim_${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 1000
})

client.on('connect', () => {
  console.log(`Connected to ${BROKER}`)

  const subscribedTopics = [COMMAND_TOPIC, CONTROLLER_TO_GATEWAY_TOPIC]
  if (LEGACY_CONTROLLER_TO_GATEWAY_TOPIC !== CONTROLLER_TO_GATEWAY_TOPIC) {
    subscribedTopics.push(LEGACY_CONTROLLER_TO_GATEWAY_TOPIC)
  }

  client.subscribe(subscribedTopics, { qos: 1 }, (error) => {
    if (error) {
      console.error(`[ERR] subscribe: ${error.message}`)
      return
    }
    console.log(`Subscribed command topic: ${COMMAND_TOPIC}`)
    console.log(`Subscribed controller uplink topic: ${CONTROLLER_TO_GATEWAY_TOPIC}`)
    if (LEGACY_CONTROLLER_TO_GATEWAY_TOPIC !== CONTROLLER_TO_GATEWAY_TOPIC) {
      console.log(`Subscribed legacy controller uplink topic: ${LEGACY_CONTROLLER_TO_GATEWAY_TOPIC}`)
    }
  })

  setInterval(() => {
    publishJson(client, SERVER_GATEWAY_HEARTBEAT_TOPIC, buildGatewayHeartbeat())
  }, GW_HEARTBEAT_INTERVAL_MS)
})

client.on('message', (topic, payloadBuf) => {
  let payload
  try {
    payload = JSON.parse(payloadBuf.toString())
  } catch (error) {
    console.error(`[ERR] invalid JSON from ${topic}: ${error.message}`)
    return
  }

  if (topic === COMMAND_TOPIC) {
    console.log(`[IN] command from server: ${JSON.stringify(payload)}`)
    forwardCommandToController(client, payload)
    return
  }

  if (topic === CONTROLLER_TO_GATEWAY_TOPIC || topic === LEGACY_CONTROLLER_TO_GATEWAY_TOPIC) {
    console.log(`[IN] update from controller: ${JSON.stringify(payload)}`)
    forwardControllerUpdateToServer(client, payload)
  }
})

client.on('error', (error) => {
  console.error(`MQTT error: ${error.message}`)
  process.exitCode = 1
})

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0))
})
