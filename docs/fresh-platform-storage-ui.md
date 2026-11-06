# Fresh Testagram client contract

The new frontend authenticates new accounts through Appwrite Auth and uses the fresh Go Backend for all product data. The Appwrite server API key is never included in Vite/mobile build variables.

Media uploads are initiated by the Backend. The client receives a short-lived, object-scoped upload capability and uploads only to the exact approved HTTPS destination. The client never receives B2/R2 secret keys. Private media uses short-lived owner-authorized retrieval; public media uses immutable versioned URLs delivered through Cloudflare.

Android Node B is a separate optional companion storage-node app, not the Testagram client upload destination. It may use only a user-selected removable SD card; phone internal storage must never be used as fallback. The client must not display SD-card capacity as durable pool capacity unless the control plane reports the node and replica as verified.

The legacy Supabase project is not a runtime dependency of the fresh frontend. Do not add legacy account linking, migration routes or legacy data import.
