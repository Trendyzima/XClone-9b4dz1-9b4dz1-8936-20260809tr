import { DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, PutBucketCorsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_MEDIA_BUCKET"];\n\n// GitHub Actions secrets can accidentally contain trailing newlines/whitespace.\n// Never pass those bytes into HTTP authorization headers.\nfor (const name of required) {\n  if (process.env[name]) process.env[name] = process.env[name].trim();\n}
for (const name of required) {
  if (!process.env[name]) throw new Error("Missing required R2 configuration: " + name);
}

const endpoint = "https://" + process.env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com";
const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.R2_MEDIA_BUCKET;
const appOrigin = process.env.APP_ORIGIN || "https://kooone-9b4dz1-9b4dz1-8936-20260809tr.vercel.app";
const probeKey = "._testagram-r2-connection-probe/" + crypto.randomUUID();
const probeBody = Buffer.from("testagram-r2-connection-ok");

await client.send(new HeadBucketCommand({ Bucket: bucket }));
await client.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedOrigins: [appOrigin, "http://localhost:5173"],
      AllowedMethods: ["GET", "PUT", "HEAD", "DELETE"],
      AllowedHeaders: ["authorization", "content-type", "content-length", "x-amz-content-sha256", "x-amz-date", "x-amz-meta-*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    }],
  },
}));
const listedBefore = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
await client.send(new PutObjectCommand({ Bucket: bucket, Key: probeKey, Body: probeBody, ContentType: "text/plain" }));
const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: probeKey }));
if (Number(head.ContentLength ?? 0) !== probeBody.length) throw new Error("R2 write/read-back probe returned an unexpected object size");
await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: probeKey }));
console.log(JSON.stringify({ R2_API: "CONNECTED", bucket, endpoint, object_probe: "WRITE_READ_DELETE_OK", cors: { configured: true, origin: appOrigin }, object_count_sample: listedBefore.KeyCount ?? 0, SECRETS_EXPOSED: "NO" }));