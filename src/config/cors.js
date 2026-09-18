// Configurable via CORS_ALLOWED_ORIGINS (comma-separated) so production
// domains can be added at deploy time without a code change — falls back to
// the local dev + current prod origins if unset.
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:5173", "https://test-q-frontend.vercel.app", "https://testq.iqpaths.com"];

export const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization"],
}
