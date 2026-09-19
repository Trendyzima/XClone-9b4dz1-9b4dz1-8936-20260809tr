import { HeadBucketCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_MEDIA_BUCKET"];
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
await client.send(new HeadBucketCommand({ Bucket: bucket }));
const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
console.log(JSON.stringify({ R2_API: "CONNECTED", bucket, endpoint, object_probe: "OK", object_count_sample: listed.KeyCount ?? 0, SECRETS_EXPOSED: "NO" }));