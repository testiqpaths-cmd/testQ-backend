import { z } from "zod";
import { INTEGRITY_SIGNAL_TYPES } from "../schemas/integrity-signal.schema.js";

const signal = z.object({
  signalType: z.enum(INTEGRITY_SIGNAL_TYPES),
  detectedAt: z.coerce.date().optional(),
  metadata: z.any().optional(),
});

export const integritySignalsSchema = z.object({
  signals: z.array(signal).min(1).max(50),
});

export default integritySignalsSchema;
