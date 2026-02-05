import env  from "./env.js";

export const accessCookieOptions = {
  httpOnly: true,
  secure: false,
  sameSite: env.COOKIE_SAME_SITE,
  maxAge: 15 * 60 * 1000, // 15 minutes
  domain: env.COOKIE_DOMAIN,
};

export const refreshCookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  domain: env.COOKIE_DOMAIN,
};
