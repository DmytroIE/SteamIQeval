import { Mqtt as Protocol } from "azure-iot-device-mqtt";
import { Client } from "azure-iot-device";

import { logger } from "./logger";

const createIotHubMqttClient = (connStr: string): Client => {
  const client: Client = Client.fromConnectionString(connStr, Protocol);
  client.on("connect", () => {
    logger.info("IoT Hub client connected");
  });
  client.on("error", (err: Error) => {
    logger.error(`IoT Hub client has an error: ${err.message}`);
  });
  client.on("disconnect", () => {
    logger.info("IoT Hub client disconnected");
  });
  client.on("message", () => {
    logger.info("IoT Hub client sent a message");
  });
  return client;
};

export { createIotHubMqttClient };
