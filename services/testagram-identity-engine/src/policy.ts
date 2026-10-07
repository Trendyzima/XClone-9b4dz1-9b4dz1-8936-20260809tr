export type IdentityScores = {
  documentValid: boolean;
  ocrConfidence: number;
  livenessScore: number;
  faceMatchScore: number;
  tamperScore: number;
  crossDocumentMatch: boolean;
  ageOk: boolean;
  duplicateOk: boolean;
};

export type IdentityDecision = "approved" | "rejected" | "manual_review";

export function decideIdentity(scores: IdentityScores): {
  decision: IdentityDecision;
  reason: string | null;
} {
  if (!scores.duplicateOk) return { decision: "rejected", reason: "IDENTITY_ALREADY_REGISTERED" };
  if (!scores.ageOk) return { decision: "rejected", reason: "AGE_RESTRICTION" };
  if (!scores.documentValid) return { decision: "rejected", reason: "DOCUMENT_INVALID" };
  if (!scores.crossDocumentMatch) return { decision: "rejected", reason: "DOCUMENT_FIELDS_MISMATCH" };

  if (
    scores.ocrConfidence < 0.75 ||
    scores.livenessScore < 0.80 ||
    scores.faceMatchScore < 0.80 ||
    scores.tamperScore > 0.30
  ) {
    return { decision: "rejected", reason: "BIOMETRIC_OR_DOCUMENT_QUALITY_FAILED" };
  }

  if (
    scores.ocrConfidence >= 0.90 &&
    scores.livenessScore >= 0.90 &&
    scores.faceMatchScore >= 0.92 &&
    scores.tamperScore <= 0.10
  ) {
    return { decision: "approved", reason: null };
  }

  return { decision: "manual_review", reason: "QUALITY_REVIEW_REQUIRED" };
}
