# Testagram TV — Bunny Live + Firebase metadata

## Runtime contract

- Bunny Stream Live is the only public live-video delivery provider.
- YouTube OAuth is not used.
- Cloudflare is not in the video delivery path.
- Firebase Firestore stores TV metadata/control state.
- Live video is not uploaded to Firebase.
- Bunny live streams are created with `recordVod=false` and `dvrEnabled=false`.
- The browser sends a WebM contribution to the Testagram Bunny ingest bridge; FFmpeg forwards it to Bunny RTMP.
- Viewers receive Bunny's HLS playback URL.
- When a stream ends, Bunny's live event is stopped and no VOD is created by Testagram.

## Required Bunny configuration

1. Create/enable a Bunny Stream video library with Live Stream access.
2. Set the server secret:
   - `BUNNY_STREAM_LIBRARY_ID`
   - `BUNNY_STREAM_API_KEY`
3. Keep the Bunny API key server-side only.

Bunny's current Live Stream API uses `https://video.bunnycdn.com`, creates live events under `/library/{libraryId}/live`, returns an RTMP ingest URL + stream key + HLS playback URL, and supports explicit start/stop/status operations. The implementation sets `recordVod=false` and `dvrEnabled=false`.

## Required Firebase configuration

1. Create/enable Cloud Firestore in the Firebase/Google Cloud project.
2. Create a service account with the minimum required Firestore data-access role (`roles/datastore.user`).
3. Store the service-account JSON as the server secret:
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
4. Deploy `firestore.rules`. The TV metadata collection is intentionally server-only.

The Edge control plane authenticates to Firestore with a service-account OAuth token and the datastore scope. It writes documents under:

`tv_live_streams/{testagramStreamId}`

The Bunny stream key is stored in that server-only document so the browser never receives the Bunny management API key.

## Required backend runtime

`api/tv-bunny-ingest.ts` needs a long-lived Node runtime with FFmpeg and WebSocket support. It is not a static/browser endpoint. The public application routes WebSocket traffic to this service at:

`/api/tv-bunny-ingest`

Do not put Bunny API keys or Firebase service-account JSON in browser-exposed environment variables.

## Validation

The branch includes `.github/workflows/bunny-tv-validation.yml`, which runs the frontend typecheck/build and rejects active YouTube/Cloudflare TV runtime references.
