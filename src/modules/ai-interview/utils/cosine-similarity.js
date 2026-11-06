/**
 * Cosine similarity + nearest-duplicate search for question embeddings.
 *
 * Deliberately brute-force: it only ever runs against a single candidate's
 * own prior questions (a small set, capped further by the caller), so a
 * vector index would be overkill.
 */

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * @param {number[]} embedding
 * @param {Array<{ embedding: number[], question: string }>} priorTurns
 * @param {number} threshold - cosine similarity at/above which it's a duplicate
 * @returns {{ isDuplicate: boolean, closestMatch: object|null, similarity: number }}
 */
export function findClosestDuplicate(embedding, priorTurns = [], threshold = 0.92) {
  let best = { similarity: -1, match: null };

  for (const turn of priorTurns) {
    if (!turn?.embedding) continue;
    const sim = cosineSimilarity(embedding, turn.embedding);
    if (sim > best.similarity) best = { similarity: sim, match: turn };
  }

  return {
    isDuplicate: best.similarity >= threshold,
    closestMatch: best.match,
    similarity: best.similarity < 0 ? 0 : best.similarity,
  };
}

export default { cosineSimilarity, findClosestDuplicate };
