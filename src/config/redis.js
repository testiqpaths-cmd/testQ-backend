import { createClient } from 'redis';
import logger from "./logger.js";

const client = createClient({
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  }
});

client.on('error', (err) => logger.error(`Redis Client Error: ${err.message}`));
client.on('connect', () => logger.info('Redis connected'));

await client.connect();

export default client;
