const mqtt = require('mqtt')

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883'
const GATEWAY_TO_CONTROLLER_TOPIC =
  process.env.GATEWAY_TO_CONTROLLER_TOPIC || 'esp32/gateway/control-command'
const CONTROLLER_TO_GATEWAY_TOPIC =
  process.env.CONTROLLER_TO_GATEWAY_TOPIC || 'esp32/gateway/controller-updates'
const HEARTBEAT_INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000)
const ONCE = process.argv.includes('--once')

const GATEWAY = {
  id: process.env.GATEWAY_ID || 'GW_001',
  ip: process.env.GATEWAY_IP || '192.168.1.249',
  mac: process.env.GATEWAY_MAC || '00:70:07:E6:7D:14'
}

const CONTROLLER = {
  id: process.env.NODE_ID || 'node-control-001',
  name: process.env.NODE_NAME || 'Control Node #1',
  mac: process.env.NODE_MAC || '24:6F:28:AA:BB:01',
  sensorId: process.env.DEVICE_ID || 'actuator-control-001'
}

const DEVICES = {
  primary: process.env.DIGITAL_DEVICE || 'pump',
  secondary: process.env.SECONDARY_DIGITAL_DEVICE || 'light'
}

let heartbeatSeq = 0
let eventSeq = 0
let fallbackCommandSeq = 0

let primaryOn = false
let secondaryOn = false

function currentDeviceStates() {
  return [
    { device: DEVICES.primary, kind: 'digital', state: primaryOn ? 'on' : 'off' },
    { device: DEVICES.secondary, kind: 'digital', state: secondaryOn ? 'on' : 'off' }
  ]
}

function buildStatusKv(states, commandMeta = null) {
  const parts = ['v=1']

  if (commandMeta) {
    parts.push(`cmd=${String(commandMeta.seq)}`)
    parts.push(`ce=${String(commandMeta.execMs)}`)
    parts.push(`cd=${String(commandMeta.device)}`)
    parts.push(`ct=${String(commandMeta.state)}`)
    parts.push(`cr=${String(commandMeta.result)}`)
  }

  for (const state of states) {
    parts.push(`d=${state.device}`)
    parts.push(`k=${state.kind}`)
    parts.push(`s=${state.state}`)
  }

  return parts.join(';')
}

function normalizeDigitalState(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'on') return true
  if (normalized === 'off') return false
  return null
}

function applyCommand(command) {
  if (!command || typeof command !== 'object') {
    return null
  }

  const nodeId = String(command.node_id || CONTROLLER.id)
  if (nodeId !== CONTROLLER.id) {
    return null
  }

  const startedAt = Date.now()
  const device = String(command.device || '')
  const seq = Number(command.command_seq) > 0 ? Number(command.command_seq) : ++fallbackCommandSeq
  const requestedState = String(command.state || '').toLowerCase()

  let result = 'unknown_device'
  let appliedState = requestedState

  if (device === DEVICES.primary) {
    const next = normalizeDigitalState(requestedState)
    if (next === null) {
      result = 'invalid_state'
    } else {
      primaryOn = next
      result = 'applied'
      appliedState = next ? 'on' : 'off'
    }
  } else if (device === DEVICES.secondary) {
    const next = normalizeDigitalState(requestedState)
    if (next === null) {
      result = 'invalid_state'
    } else {
      secondaryOn = next
      result = 'applied'
      appliedState = next ? 'on' : 'off'
    }
  }

  // Simulate controller processing time.
  const jitterMs = Math.floor(Math.random() * 40)
  const execMs = Date.now() - startedAt + jitterMs

  return {
    seq,
    device,
    state: appliedState,
    result,
    execMs
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

function buildHeartbeatPayload() {
  const now = new Date().toISOString()
  const controllerStates = currentDeviceStates()
  heartbeatSeq += 1

  return {
    type: 'node_heartbeat',
    gateway_id: GATEWAY.id,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    node_id: CONTROLLER.id,
    node_name: CONTROLLER.name,
    node_mac: CONTROLLER.mac,
    sensor_id: CONTROLLER.sensorId,
    status: 'online',
    uptime: Math.floor(process.uptime()),
    heartbeat_seq: heartbeatSeq,
    sensor_rssi: -45,
    gateway_timestamp: now,
    sensor_timestamp: now,
    status_kv: buildStatusKv(controllerStates),
    controller_states: controllerStates
  }
}

function publishHeartbeat(client) {
  publishJson(client, CONTROLLER_TO_GATEWAY_TOPIC, buildHeartbeatPayload())
}

function publishStatusEvent(client, command, commandResult) {
  const now = new Date().toISOString()
  const controllerStates = currentDeviceStates()
  eventSeq += 1

  const payload = {
    type: 'controller_status_event',
    gateway_id: command.gateway_id || GATEWAY.id,
    gateway_ip: command.gateway_ip || GATEWAY.ip,
    gateway_mac: command.gateway_mac || GATEWAY.mac,
    node_id: CONTROLLER.id,
    node_mac: CONTROLLER.mac,
    sensor_id: CONTROLLER.sensorId,
    event_seq: eventSeq,
    sensor_rssi: -45,
    sensor_timestamp: now,
    gateway_timestamp: now,
    status_kv: buildStatusKv(controllerStates, commandResult),
    command_seq: commandResult.seq,
    command_device: commandResult.device,
    command_state: commandResult.state,
    command_result: commandResult.result,
    command_exec_ms: commandResult.execMs,
    requested_at: command.requested_at || null,
    requested_at_ms: command.requested_at_ms || null,
    response_deadline_at: command.response_deadline_at || null,
    controller_states: controllerStates
  }

  publishJson(client, CONTROLLER_TO_GATEWAY_TOPIC, payload)
}

const client = mqtt.connect(BROKER, {
  clientId: `controller_sim_${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 1000
})

client.on('connect', () => {
  console.log(`Connected to ${BROKER}`)
  client.subscribe(GATEWAY_TO_CONTROLLER_TOPIC, { qos: 1 }, (error) => {
    if (error) {
      console.error(`[ERR] subscribe ${GATEWAY_TO_CONTROLLER_TOPIC}: ${error.message}`)
      return
    }
    console.log(`Subscribed to ${GATEWAY_TO_CONTROLLER_TOPIC}`)
  })

  publishHeartbeat(client)
  if (!ONCE) {
    setInterval(() => publishHeartbeat(client), HEARTBEAT_INTERVAL_MS)
  }
})

client.on('message', (topic, payloadBuf) => {
  if (topic !== GATEWAY_TO_CONTROLLER_TOPIC) {
    return
  }

  let command
  try {
    command = JSON.parse(payloadBuf.toString())
  } catch (error) {
    console.error(`[ERR] invalid command payload: ${error.message}`)
    return
  }

  const result = applyCommand(command)
  if (!result) {
    console.log(`[SKIP] command is not for node ${CONTROLLER.id}`)
    return
  }

  console.log(
    `[CMD] node=${CONTROLLER.id} seq=${result.seq} device=${result.device} state=${result.state} result=${result.result} exec_ms=${result.execMs}`
  )
  publishStatusEvent(client, command, result)
})

client.on('error', (error) => {
  console.error(`MQTT error: ${error.message}`)
  process.exitCode = 1
})

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0))
})
