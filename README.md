# heartbeat

MQTT heartbeat simulator for the flow: controller gateway server.

## Structure

```
heartbeat/
test_controller.js   # Controller heartbeat sender
test_gateway.js      # Gateway relay + heartbeat
test_sensor.js       # Sensor data + node heartbeat sender
package.json
```

## Topics / Flow

- Controller  `esp32/gateway/controller`
- Gateway      `esp32/controllers/heartbeat`
- Gateway HB   `esp32/heartbeat`

## Install

```bash
cd heartbeat
npm install
```

## Run

```bash
node test_gateway.js
node test_controller.js
```

Run once:

```bash
node test_controller.js --once
```

## MQTT Broker

```bash
export MQTT_BROKER=mqtt://localhost:1883
```

## Controller env

```bash
export CONTROLLER_TO_GATEWAY_TOPIC=esp32/gateway/controller
export GATEWAY_ID=TEST_GW_001
export GATEWAY_NAME='[TEST] Gateway Simulator 001'
export NODE_ID=test-node-control-001
export NODE_NAME='[TEST] Control Node 001'
export DIGITAL_DEVICE=test_pump
export ANALOG_DEVICE=fan_speed
export INTERVAL_MS=5000
```

## Gateway env

```bash
export GATEWAY_TO_SERVER_TOPIC=esp32/controllers/heartbeat
export GATEWAY_HEARTBEAT_TOPIC=esp32/heartbeat
export GATEWAY_ID=TEST_GW_001
export GATEWAY_NAME='[TEST] Gateway Simulator 001'
export GW_HEARTBEAT_INTERVAL_MS=5000
```

## Sensor env

```bash
export GATEWAY_ID=TEST_GW_001
export GATEWAY_NAME='[TEST] Gateway Simulator 001'
export NODE_ID=test-node-sensor-001
export NODE_NAME='[TEST] Sensor Node 001'
export SENSOR_ID=test-sensor-env-01
```

## Test

```bash
mosquitto
node test_gateway.js
node test_controller.js
```

## Notes

- Local testing only
- Not for production
- Default IDs/names are prefixed with `TEST` / `[TEST]` to avoid confusion with real devices
