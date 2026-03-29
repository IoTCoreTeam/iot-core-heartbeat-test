const mqtt = require('mqtt')

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883'
const GATEWAY_TO_CONTROLLER_TOPIC =
  process.env.GATEWAY_TO_CONTROLLER_TOPIC || 'esp32/gateway/control-command'
const CONTROLLER_TO_GATEWAY_TOPIC =
  process.env.CONTROLLER_TO_GATEWAY_TOPIC || 'esp32/gateway/controller-updates'
const HEARTBEAT_INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000)
const ONCE = process.argv.includes('--once')

const GATEWAY = {
  id: process.env.GATEWAY_ID || 'TEST_GW_001',
  name: process.env.GATEWAY_NAME || '[TEST] Gateway Simulator 001',
  ip: process.env.GATEWAY_IP || '192.168.1.249',
  mac: process.env.GATEWAY_MAC || '00:70:07:E6:7D:14'
}

const ROBOT = {
  id: process.env.NODE_ID || 'test-node-robot-001',
  name: process.env.NODE_NAME || '[TEST] Robot Node 001',
  mac: process.env.NODE_MAC || '24:6F:28:AA:CC:01',
  sensorId: process.env.DEVICE_ID || 'test-actuator-robot-001'
}

const DEVICES = {
  primary: process.env.ROBOT_DEVICE || 'ground-control'
}

const BASE_LAT = Number(process.env.GPS_LAT || 20.8459)
const BASE_LNG = Number(process.env.GPS_LNG || 106.6902)
const MOVE_STEP_METERS = Number(process.env.ROBOT_MOVE_STEP_METERS || 5)
const MOVE_STEPS_PER_HEARTBEAT = Number(process.env.ROBOT_MOVE_STEPS_PER_HEARTBEAT || 3)

let heartbeatSeq = 0
let eventSeq = 0
let fallbackCommandSeq = 0

let robotMode = 'digital'
let robotState = 'off' // for digital on/off status
let robotDirection = 'idle' // movement semantic for json command
let robotLat = BASE_LAT
let robotLng = BASE_LNG

function currentDeviceStates() {
  return [
    {
      device: DEVICES.primary,
      kind: 'json_command',
      state: robotState,
      value: robotDirection
    }
  ]
}

function buildStatusKv(states, commandMeta = null) {
  const parts = ['v=1', 'it=json_command']

  if (commandMeta) {
    parts.push(`cmd=${String(commandMeta.seq)}`)
    parts.push(`ce=${String(commandMeta.execMs)}`)
    parts.push(`cd=${String(commandMeta.device)}`)
    parts.push(`cm=${String(commandMeta.mode)}`)
    parts.push(`ct=${String(commandMeta.state)}`)
    parts.push(`cv=${String(commandMeta.value)}`)
    parts.push(`cr=${String(commandMeta.result)}`)
  }

  for (const state of states) {
    parts.push(`d=${state.device}`)
    parts.push(`k=${state.kind}`)
    if (state.kind === 'digital') {
      parts.push(`s=${state.state}`)
    } else {
      parts.push(`v=${String(state.value)}`)
    }
  }

  return parts.join(';')
}

function normalizeDigitalState(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'on') return 'on'
  if (normalized === 'off') return 'off'
  return null
}

function normalizeDirection(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (['forward', 'backward', 'left', 'right', 'stop'].includes(normalized)) {
    return normalized
  }
  return null
}

function moveRobot(direction) {
  if (direction === 'stop') return

  const meters = Number.isFinite(MOVE_STEP_METERS) && MOVE_STEP_METERS > 0
    ? MOVE_STEP_METERS
    : 2
  const latStep = meters / 111320
  const cosLat = Math.max(Math.cos((robotLat * Math.PI) / 180), 0.1)
  const lngStep = meters / (111320 * cosLat)

  if (direction === 'forward') {
    robotLat += latStep
  } else if (direction === 'backward') {
    robotLat -= latStep
  } else if (direction === 'right') {
    robotLng += lngStep
  } else if (direction === 'left') {
    robotLng -= lngStep
  }
}

function moveRobotByHeartbeat() {
  if (robotState !== 'on') return
  if (robotDirection === 'stop' || robotDirection === 'idle') return

  const steps = Number.isFinite(MOVE_STEPS_PER_HEARTBEAT) && MOVE_STEPS_PER_HEARTBEAT > 0
    ? Math.floor(MOVE_STEPS_PER_HEARTBEAT)
    : 1

  for (let i = 0; i < steps; i += 1) {
    moveRobot(robotDirection)
  }
}

function applyCommand(command) {
  if (!command || typeof command !== 'object') {
    return null
  }

  const nodeId = String(command.node_id || ROBOT.id)
  if (nodeId !== ROBOT.id) {
    return null
  }

  const startedAt = Date.now()
  const device = String(command.device || DEVICES.primary)
  const seq = Number(command.command_seq) > 0 ? Number(command.command_seq) : ++fallbackCommandSeq
  const payload = command.command_payload && typeof command.command_payload === 'object'
    ? command.command_payload
    : null

  let result = 'invalid_payload'
  let appliedMode = robotMode
  let appliedState = robotState
  let appliedValue = robotDirection

  if (device !== DEVICES.primary) {
    result = 'unknown_device'
  } else if (!payload) {
    result = 'missing_command_payload'
  } else {
    const mode = String(payload.mode || '').trim().toLowerCase()
    if (mode === 'digital') {
      const rawValue = String(payload.value ?? '').trim().toLowerCase()
      let direction = null

      if (['off', '0', 'false', 'stop', 'idle'].includes(rawValue)) {
        direction = 'stop'
      } else if (['forward', 'backward', 'left', 'right'].includes(rawValue)) {
        direction = rawValue
      } else {
        direction = normalizeDirection(payload.direction)
      }

      if (direction === null) {
        result = 'invalid_direction'
      } else {
        robotMode = 'digital'
        robotDirection = direction
        robotState = direction === 'stop' ? 'off' : 'on'
        moveRobot(direction)
        result = 'applied'
      }
    } else {
      result = 'invalid_mode'
    }

    appliedMode = robotMode
    appliedState = robotState
    appliedValue = robotDirection
  }

  const jitterMs = Math.floor(Math.random() * 40)
  const execMs = Date.now() - startedAt + jitterMs

  return {
    seq,
    device,
    mode: appliedMode,
    state: appliedState,
    value: appliedValue,
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
  moveRobotByHeartbeat()

  const now = new Date().toISOString()
  const controllerStates = currentDeviceStates()
  heartbeatSeq += 1
  const lat = robotLat
  const lng = robotLng
  const gps = {
    lat,
    lng,
    satellites: 8 + (heartbeatSeq % 4),
    hdop: 0.7 + ((heartbeatSeq % 6) * 0.05),
    timestamp: now
  }

  return {
    type: 'control',
    event_type: 'node_heartbeat',
    node_type: 'node-control',
    input_type: 'json_command',
    gateway_id: GATEWAY.id,
    gateway_name: GATEWAY.name,
    gateway_ip: GATEWAY.ip,
    gateway_mac: GATEWAY.mac,
    node_id: ROBOT.id,
    node_name: ROBOT.name,
    node_mac: ROBOT.mac,
    sensor_id: ROBOT.sensorId,
    status: 'online',
    uptime: Math.floor(process.uptime()),
    heartbeat_seq: heartbeatSeq,
    sensor_rssi: -45,
    gateway_timestamp: now,
    sensor_timestamp: now,
    gps,
    lat,
    lng,
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
    type: 'control',
    event_type: 'controller_status_event',
    node_type: 'node-control',
    input_type: 'json_command',
    gateway_id: command.gateway_id || GATEWAY.id,
    gateway_name: command.gateway_name || GATEWAY.name,
    gateway_ip: command.gateway_ip || GATEWAY.ip,
    gateway_mac: command.gateway_mac || GATEWAY.mac,
    node_id: ROBOT.id,
    node_mac: ROBOT.mac,
    sensor_id: ROBOT.sensorId,
    event_seq: eventSeq,
    sensor_rssi: -45,
    sensor_timestamp: now,
    gateway_timestamp: now,
    status_kv: buildStatusKv(controllerStates, commandResult),
    command_seq: commandResult.seq,
    command_device: commandResult.device,
    command_mode: commandResult.mode,
    command_state: commandResult.state,
    command_value: commandResult.value,
    command_direction: commandResult.value,
    command_result: commandResult.result,
    command_exec_ms: commandResult.execMs,
    requested_at: command.requested_at || null,
    requested_at_ms: command.requested_at_ms || null,
    response_deadline_at: command.response_deadline_at || null,
    command_payload: command.command_payload || null,
    controller_states: controllerStates
  }

  publishJson(client, CONTROLLER_TO_GATEWAY_TOPIC, payload)
}

const client = mqtt.connect(BROKER, {
  clientId: `robot_sim_${Math.random().toString(16).slice(2)}`,
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
    console.log(`[SKIP] command is not for node ${ROBOT.id}`)
    return
  }

  console.log(
    `[CMD] node=${ROBOT.id} seq=${result.seq} device=${result.device} mode=${result.mode} state=${result.state} value=${result.value} result=${result.result} exec_ms=${result.execMs}`
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
