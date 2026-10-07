# Testagram Native Identity Engine

Native Linux service. No Docker and no identity-verification vendor runtime.

## Pipeline

1. Decode and validate evidence.
2. OCR Kenyan ID front/back with local Tesseract.
3. Normalize candidate ID fields.
4. Detect exactly one face in document portrait and selfie.
5. Compare local face embeddings with OpenCV's local face-recognition model.
6. Run the locally installed liveness model.
7. Cross-check document fields, age and one-person-one-account fingerprint.
8. Send one signed, minimal result to Testagram's `identity-engine-result` function.

The engine fails closed when a required model is absent. A missing liveness model can never become an automatic approval.

## Model custody

Production model files belong under `/var/lib/testagram/identity-engine/models` and must be pinned by SHA-256 in the deployment manifest before activation. The application does not download models at runtime.

## Current state

OCR implementation is present. Face detection/recognition is implemented against local ONNX models. Liveness is intentionally blocked until a locally benchmarked liveness ONNX model is installed and its thresholds are validated against the Testagram anti-spoofing test set.
