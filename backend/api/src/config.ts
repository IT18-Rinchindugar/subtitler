import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: "24h",
  db: { url: required("DATABASE_URL") },
  s3: {
    endpoint: required("S3_ENDPOINT"),
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? required("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: required("S3_BUCKET"),
    accessKey: required("S3_ACCESS_KEY"),
    secretKey: required("S3_SECRET_KEY"),
  },
  transcriber: {
    url: required("TRANSCRIBER_URL"),
  },
  internalSecret: required("INTERNAL_SECRET"),
};
