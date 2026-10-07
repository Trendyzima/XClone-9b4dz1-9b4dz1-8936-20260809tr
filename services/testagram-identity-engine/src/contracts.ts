export type DocumentAnalysis = {
  valid: boolean;
  idNumber: string;
  dateOfBirth: string;
  confidence: number;
  tamperScore: number;
  frontBackMatch: boolean;
};

export type LivenessAnalysis = {
  score: number;
  passed: boolean;
};

export type FaceMatchAnalysis = {
  score: number;
  passed: boolean;
};

export interface DocumentAnalyzer {
  analyze(front: Uint8Array, back: Uint8Array): Promise<DocumentAnalysis>;
}

export interface LivenessAnalyzer {
  analyze(video: Uint8Array, selfie: Uint8Array): Promise<LivenessAnalysis>;
}

export interface FaceMatcher {
  compare(documentPortrait: Uint8Array, selfie: Uint8Array): Promise<FaceMatchAnalysis>;
}

export interface IdentityEngine {
  readonly modelVersion: string;
  verify(input: {
    idFront: Uint8Array;
    idBack: Uint8Array;
    selfie: Uint8Array;
    livenessVideo: Uint8Array;
    expectedBirthDate: string;
  }): Promise<{
    document: DocumentAnalysis;
    liveness: LivenessAnalysis;
    face: FaceMatchAnalysis;
    ageOk: boolean;
    duplicateOk: boolean;
  }>;
}
