const mqtt = require('mqtt');

let client = null;
let _connected = false;

function connect() {
  const host = process.env.MQTT_HOST || 'localhost';
  const port = Number(process.env.MQTT_PORT) || 1883;

  client = mqtt.connect(`mqtt://${host}:${port}`, {
    clientId: `factory-backend-${process.pid}`,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
  });

  client.on('connect', () => {
    _connected = true;
    console.log(`[MQTT] Connected to ${host}:${port}`);
  });
  client.on('close', () => { _connected = false; });
  client.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
  });

  return client;
}

function publish(topic, payload) {
  if (!client || !_connected) return;
  try {
    client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 0 });
  } catch (e) {
    console.error('[MQTT] publish error:', e.message);
  }
}

module.exports = { connect, publish, get connected() { return _connected; } };
