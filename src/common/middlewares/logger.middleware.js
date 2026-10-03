import logger from "../../config/logger.js";

export const requestLogger = (req, res, next) => {
  const { method, url, headers, body, params, query } = req;

  // Log request info
  logger.info(`\n📥 API REQUEST`);
  logger.info(`Method: ${method}`);
  logger.info(`URL: ${url}`);
  
  // Log headers (exclude sensitive ones)

  // Log body (omit large base64/image payloads to prevent CPU event-loop lockup and disk exhaustion)
  if (body && typeof body === "object" && Object.keys(body).length > 0) {
    if (url.includes("detect-phone") || body.image) {
      const sanitized = { ...body };
      if (sanitized.image) {
        sanitized.image = `[Base64 Image Omitted - ${Math.round(String(body.image).length / 1024)} KB]`;
      }
      logger.info(`Body: ${JSON.stringify(sanitized, null, 2)}`);
    } else {
      logger.info(`Body: ${JSON.stringify(body, null, 2)}`);
    }
  }

  // Log params
  if (Object.keys(params || {}).length > 0) {
    logger.info(`Params: ${JSON.stringify(params, null, 2)}`);
  }

  // Log query
  if (Object.keys(query || {}).length > 0) {
    logger.info(`Query: ${JSON.stringify(query, null, 2)}`);
  }

  // Log response when it's sent
  const originalSend = res.send;
  res.send = function (data) {
    logger.info(`\n📤 API RESPONSE`);
    logger.info(`Status: ${res.statusCode}`);
    
    // Try to parse and log response data
    try {
      if (typeof data === "string") {
        const parsed = JSON.parse(data);
        logger.info(`Response: ${JSON.stringify(parsed, null, 2)}`);
      } else if (typeof data === "object") {
        logger.info(`Response: ${JSON.stringify(data, null, 2)}`);
      } else {
        logger.info(`Response: ${data}`);
      }
    } catch (e) {
      logger.info(`Response: ${data}`);
    }

    return originalSend.call(this, data);
  };

  next();
};
