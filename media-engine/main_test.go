package main

import (
  "crypto/hmac"
  "crypto/sha256"
  "encoding/base64"
  "encoding/json"
  "net/http/httptest"
  "os"
  "testing"
  "time"
)

func testToken(t *testing.T, role, stream string, exp int64, secret string) string {
  t.Helper()
  enc := func(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }
  h := enc([]byte("testagram-media-v1"))
  p, _ := json.Marshal(claims{Role: role, StreamID: stream, Exp: exp})
  payload := enc(p)
  mac := hmac.New(sha256.New, []byte(secret))
  _, _ = mac.Write(p)
  return h + "." + payload + "." + enc(mac.Sum(nil))
}

func TestVerifyTokenAcceptsValidClaim(t *testing.T) {
  token := testToken(t, "viewer", "stream-1", time.Now().Add(time.Minute).Unix(), "secret")
  got, err := verifyToken(token, "secret")
  if err != nil { t.Fatalf("verifyToken returned error: %v", err) }
  if got.Role != "viewer" || got.StreamID != "stream-1" { t.Fatalf("unexpected claims: %#v", got) }
}

func TestVerifyTokenRejectsTamperingAndExpiry(t *testing.T) {
  valid := testToken(t, "host", "stream-1", time.Now().Add(time.Minute).Unix(), "secret")
  parts := []byte(valid)
  parts[len(parts)-2] ^= 1
  if _, err := verifyToken(string(parts), "secret"); err == nil { t.Fatal("tampered token was accepted") }

  expired := testToken(t, "viewer", "stream-1", time.Now().Add(-time.Minute).Unix(), "secret")
  if _, err := verifyToken(expired, "secret"); err == nil { t.Fatal("expired token was accepted") }
}

func TestVerifyTokenRejectsUnknownRole(t *testing.T) {
  token := testToken(t, "admin", "stream-1", time.Now().Add(time.Minute).Unix(), "secret")
  if _, err := verifyToken(token, "secret"); err == nil { t.Fatal("unknown role was accepted") }
}

func TestAllowedOrigin(t *testing.T) {
  previous := os.Getenv("MEDIA_ENGINE_ALLOWED_ORIGINS")
  t.Cleanup(func() { _ = os.Setenv("MEDIA_ENGINE_ALLOWED_ORIGINS", previous) })

  _ = os.Setenv("MEDIA_ENGINE_ALLOWED_ORIGINS", "https://testagram.example,https://studio.testagram.example")
  allowed := httptest.NewRequest("GET", "https://media.testagram.example/ws", nil)
  allowed.Header.Set("Origin", "https://studio.testagram.example")
  if !checkOrigin(allowed) { t.Fatal("configured origin was rejected") }

  denied := httptest.NewRequest("GET", "https://media.testagram.example/ws", nil)
  denied.Header.Set("Origin", "https://evil.example")
  if checkOrigin(denied) { t.Fatal("unconfigured origin was accepted") }
}
