import env from "./env.js";



const allowedOrigins = ["http://localhost:5173", 'https://test-q-frontend.vercel.app', env.CORS_ORIGIN];

export const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization"],
}
