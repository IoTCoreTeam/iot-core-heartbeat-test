# heartbeat_test

MQTT heartbeat simulator for the flow: controller gateway server.

## Structure

```
heartbeat_test/
test_controller.js   # Controller heartbeat sender
test_gateway.js      # Gateway relay + heartbeat
package.json
```

## Topics / Flow

- Controller  `esp32/gateway/controller`
- Gateway      `esp32/controllers/heartbeat`
- Gateway HB   `esp32/heartbeat`

## Install

```bash
cd heartbeat_test
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
export NODE_ID=node-001
export DIGITAL_DEVICE=pump
export ANALOG_DEVICE=fan_speed
export INTERVAL_MS=5000
```

## Gateway env

```bash
export GATEWAY_TO_SERVER_TOPIC=esp32/controllers/heartbeat
export GATEWAY_HEARTBEAT_TOPIC=esp32/heartbeat
export GATEWAY_ID=gateway-01
export GW_HEARTBEAT_INTERVAL_MS=5000
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