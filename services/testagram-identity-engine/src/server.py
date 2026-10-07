import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import pytesseract
from fastapi import FastAPI, File, Header, HTTPException, UploadFile

ENGINE_SECRET = os.environ.get("IDENTITY_ENGINE_SECRET", "")
MODEL_VERSION = os.environ.get("ENGINE_MODEL_VERSION", "testagram-native-v1")
FACE_DETECTOR = os.environ.get("FACE_DETECTOR_MODEL", "/var/lib/testagram/identity-engine/models/face_detection.onnx")
FACE_RECOGNIZER = os.environ.get("FACE_RECOGNIZER_MODEL", "/var/lib/testagram/identity-engine/models/face_recognition.onnx")
LIVENESS_MODEL = os.environ.get("LIVENESS_MODEL", "/var/lib/testagram/identity-engine/models/liveness.onnx")

app = FastAPI(title="Testagram Identity Engine", docs_url=None, redoc_url=None)

def decode_image(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "INVALID_IMAGE")
    return image

def ocr_document(image: np.ndarray) -> tuple[str, float]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    text = pytesseract.image_to_string(threshold, config="--oem 1 --psm 6")
    confidence_rows = pytesseract.image_to_data(threshold, config="--oem 1 --psm 6", output_type=pytesseract.Output.DICT)["conf"]
    values = [float(x) for x in confidence_rows if str(x).strip() not in ("", "-1")]
    confidence = max(0.0, min(1.0, (sum(values) / len(values) / 100.0) if values else 0.0))
    return text, confidence

def id_candidates(text: str) -> list[str]:
    return list(dict.fromkeys(x for x in __import__("re").findall(r"(?<!\d)\d{7,9}(?!\d)", text)))

def face_engine():
    if not Path(FACE_DETECTOR).is_file() or not Path(FACE_RECOGNIZER).is_file():
        raise RuntimeError("FACE_MODELS_NOT_INSTALLED")
    detector = cv2.FaceDetectorYN.create(FACE_DETECTOR, "", (320, 320), 0.9, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF.create(FACE_RECOGNIZER, "")
    return detector, recognizer

def detect_face(image: np.ndarray):
    detector, _ = face_engine()
    detector.setInputSize((image.shape[1], image.shape[0]))
    _, faces = detector.detect(image)
    if faces is None or len(faces) != 1:
        raise HTTPException(422, "EXACTLY_ONE_FACE_REQUIRED")
    return faces[0]

def face_match(document: np.ndarray, selfie: np.ndarray) -> float:
    detector, recognizer = face_engine()
    def one(img):
        detector.setInputSize((img.shape[1], img.shape[0]))
        _, faces = detector.detect(img)
        if faces is None or len(faces) != 1:
            raise HTTPException(422, "EXACTLY_ONE_FACE_REQUIRED")
        face = faces[0]
        aligned = recognizer.alignCrop(img, face)
        feature = recognizer.feature(aligned)
        return feature
    a, b = one(document), one(selfie)
    return float(recognizer.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))

def signed_payload(payload: dict) -> tuple[str, str]:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    signature = hmac.new(ENGINE_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return raw.decode(), "sha256=" + signature

@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "testagram-native",
        "model_version": MODEL_VERSION,
        "face_models_present": Path(FACE_DETECTOR).is_file() and Path(FACE_RECOGNIZER).is_file(),
        "liveness_model_present": Path(LIVENESS_MODEL).is_file(),
    }

@app.post("/v1/verify")
async def verify(
    session_id: str,
    id_front: UploadFile = File(...),
    id_back: UploadFile = File(...),
    selfie: UploadFile = File(...),
    liveness_video: UploadFile = File(...),
    x_engine_nonce: str | None = Header(default=None),
):
    if not ENGINE_SECRET:
        raise HTTPException(503, "ENGINE_SECRET_NOT_CONFIGURED")
    if not x_engine_nonce:
        raise HTTPException(401, "ENGINE_NONCE_REQUIRED")

    front = decode_image(await id_front.read())
    back = decode_image(await id_back.read())
    selfie_img = decode_image(await selfie.read())
    video_bytes = await liveness_video.read()

    front_text, front_ocr = ocr_document(front)
    back_text, back_ocr = ocr_document(back)
    candidates = list(dict.fromkeys(id_candidates(front_text) + id_candidates(back_text)))
    if not candidates:
        raise HTTPException(422, "ID_NUMBER_NOT_DETECTED")

    face_score = face_match(front, selfie_img)

    # Liveness is fail-closed until a locally installed, versioned liveness
    # model is present. No motion heuristic is allowed to approve an identity.
    if not Path(LIVENESS_MODEL).is_file():
        raise HTTPException(503, "LIVENESS_MODEL_NOT_INSTALLED")

    payload = {
        "session_id": session_id,
        "model_version": MODEL_VERSION,
        "document_valid": front_ocr >= 0.75 and back_ocr >= 0.75,
        "ocr_confidence": min(front_ocr, back_ocr),
        "id_number": candidates[0],
        "date_of_birth": "",
        "liveness_score": 0.0,
        "face_match_score": face_score,
        "tamper_score": 1.0,
        "cross_document_match": len(set(candidates)) == 1,
        "age_ok": False,
        "duplicate_ok": True,
        "nonce": x_engine_nonce,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    raw, signature = signed_payload(payload)
    return {"ok": True, "payload": json.loads(raw), "signature": signature, "engine": "testagram-native"}
