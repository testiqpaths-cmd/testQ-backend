// Configurable via CORS_ALLOWED_ORIGINS or CORS_ORIGIN (comma-separated) so production
// domains can be added in .env at deploy time without code changes — always includes
// local dev + current prod origins as baseline defaults.
const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "https://test-q-frontend.vercel.app",
  "https://testq.iqpaths.com",
  "https://resume.iqpaths.com",
];

// Support both CORS_ALLOWED_ORIGINS and CORS_ORIGIN from .env (comma-separated or single)
const envOriginsRaw = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || "";
const envOrigins = envOriginsRaw
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Combine baseline default origins with any extra origins defined in environment variables
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

export const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // Exact match with configured origins
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Allow all Vercel preview deployments for this project
    if (/^https:\/\/test-q-frontend.*\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Blocked by CORS policy: origin ${origin} is not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization", "Content-Disposition"],
};
