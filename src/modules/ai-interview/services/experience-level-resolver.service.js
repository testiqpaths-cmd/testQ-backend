import {
  EXPERIENCE_BANDS,
  BAND_ORDER,
  bandForYears,
  bandIndex,
  parseExperienceLevel,
} from "../constants/experience-bands.js";

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const MAX_CAREER_YEARS = 45;

/** "Mar 2021", "03/2021", "2021" -> fractional year (2021.17), or null. */
function parseDatePoint(token, now) {
  const t = String(token || "").trim().toLowerCase();
  if (!t) return null;
  if (/^(present|current|now|till date|today|ongoing)$/.test(t)) {
    return now.getFullYear() + now.getMonth() / 12;
  }
  let m = t.match(/^([a-z]{3,9})\.?\s*,?\s*(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)];
    return month == null ? Number(m[2]) : Number(m[2]) + month / 12;
  }
  m = t.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m) return Number(m[2]) + (Math.min(12, Math.max(1, Number(m[1]))) - 1) / 12;
  m = t.match(/^(\d{4})$/);
  if (m) return Number(m[1]);
  return null;
}

const DATE_TOKEN = "(?:[A-Za-z]{3,9}\\.?\\s*,?\\s*\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4}|present|current|now|till date|today|ongoing)";
const RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until)\\s*(${DATE_TOKEN})`, "i");

/**
 * Duration of one work-history entry in years. Reads explicit ranges
 * ("Jan 2021 – Present", "2019 - 2022") and "N years M months" phrases from
 * the entry's duration field (or, for the deterministic parser, which leaves
 * duration empty, from its first few lines).
 */
export function parseDurationYears(text, now = new Date()) {
  const s = String(text || "");
  if (!s.trim()) return null;

  const range = s.match(RANGE_RE);
  if (range) {
    const start = parseDatePoint(range[1], now);
    const end = parseDatePoint(range[2], now);
    if (start != null && end != null && end >= start && start > 1970) {
      // A bare "2019 - 2020" means at least part of a year; count a minimum month.
      return Math.min(MAX_CAREER_YEARS, Math.max(1 / 12, end - start));
    }
  }

  const yrs = s.match(/(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)/i);
  const mos = s.match(/(\d+)\s*(?:months?|mos?)/i);
  if (yrs || mos) {
    return Math.min(MAX_CAREER_YEARS, (yrs ? Number(yrs[1]) : 0) + (mos ? Number(mos[1]) / 12 : 0));
  }
  return null;
}

/** Total professional years from resume work history (entries summed, capped). */
export function workHistoryYears(experience = [], now = new Date()) {
  if (!Array.isArray(experience) || experience.length === 0) return null;
  let total = 0;
  let parsedAny = false;
  for (const entry of experience) {
    const source = entry?.duration
      ? entry.duration
      : [entry?.role, entry?.company, ...(entry?.responsibilities || []).slice(0, 2)].join(" ");
    const y = parseDurationYears(source, now);
    if (y != null) {
      total += y;
      parsedAny = true;
    }
  }
  return parsedAny ? Math.min(MAX_CAREER_YEARS, Math.round(total * 10) / 10) : null;
}

/** Rough project complexity signal (0-1) from what the resume actually claims. */
function projectComplexity(projects = []) {
  if (!Array.isArray(projects) || projects.length === 0) return 0;
  const scores = projects.slice(0, 5).map((p) => {
    let s = 0;
    if ((p.technologies || []).length >= 3) s += 0.35;
    if (p.architecture) s += 0.35;
    if ((p.contributions || []).length >= 2) s += 0.3;
    return s;
  });
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}

/**
 * Determines the effective experience band for interview planning.
 *
 * Inputs are kept as-is on the returned profile (selectedLevel, resumeYears,
 * workHistoryYears) so reports can show both sides of a disagreement.
 *
 * Reconciliation:
 *  - Only one source → use it.
 *  - Both agree within one band → trust the selection (the candidate chose
 *    the level they're preparing for; resume dates are often incomplete).
 *  - They differ by two or more bands → don't silently pick either: start
 *    at the band between them (rounded down) and flag `conflict`. The
 *    adaptive engine then moves difficulty from there on real answers.
 *  - Neither → JUNIOR, the least presumptive default for someone who chose
 *    no level and whose resume shows no dates.
 */
export class ExperienceLevelResolverService {
  resolve({ selectedLevel = null, extracted = null, now = new Date() } = {}) {
    const selectedYears = parseExperienceLevel(selectedLevel);
    const selectedBand = selectedYears != null ? bandForYears(selectedYears) : null;

    const detected = Number(extracted?.detectedExperienceYears);
    const statedYears = Number.isFinite(detected) && detected > 0 ? detected : null;
    const historyYears = workHistoryYears(extracted?.experience, now);
    const resumeYears =
      statedYears != null || historyYears != null
        ? Math.max(statedYears ?? 0, historyYears ?? 0)
        : null;
    const resumeBand = resumeYears != null ? bandForYears(resumeYears) : null;

    let band;
    let effectiveYears;
    let source;
    let conflict = false;
    let note = null;

    if (selectedBand && resumeBand) {
      const gap = Math.abs(bandIndex(selectedBand) - bandIndex(resumeBand));
      if (gap <= 1) {
        band = selectedBand;
        effectiveYears = selectedYears;
        source = "SELECTED";
      } else {
        const mid = Math.floor((bandIndex(selectedBand) + bandIndex(resumeBand)) / 2);
        band = BAND_ORDER[mid];
        effectiveYears = (selectedYears + resumeYears) / 2;
        source = "RECONCILED";
        conflict = true;
        note = `Selected level (${selectedLevel}) and resume (~${resumeYears} years) disagree; starting at ${band} and adapting to answers.`;
      }
    } else if (selectedBand) {
      band = selectedBand;
      effectiveYears = selectedYears;
      source = "SELECTED";
    } else if (resumeBand) {
      band = resumeBand;
      effectiveYears = resumeYears;
      source = "RESUME";
    } else {
      band = EXPERIENCE_BANDS.JUNIOR;
      effectiveYears = null;
      source = "DEFAULT";
    }

    return {
      band,
      effectiveYears: effectiveYears != null ? Math.round(effectiveYears * 10) / 10 : null,
      source,
      conflict,
      note,
      selectedLevel: selectedLevel ?? null,
      selectedBand,
      resumeYears,
      resumeBand,
      workHistoryYears: historyYears,
      workHistoryCount: Array.isArray(extracted?.experience) ? extracted.experience.length : 0,
      projectCount: Array.isArray(extracted?.projects) ? extracted.projects.length : 0,
      projectComplexity: projectComplexity(extracted?.projects),
    };
  }
}

export const experienceLevelResolverService = new ExperienceLevelResolverService();
export default experienceLevelResolverService;
