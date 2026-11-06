import redisClient from '../../config/redis.js';

export const blacklistToken = async (token, exp) => {
  const ttl = exp - Math.floor(Date.now() / 1000);
  if (ttl <= 0) return;
  await redisClient.set(`bl_${token}`, '1', {
    EX: ttl,
  });
};
