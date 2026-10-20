// Runs Postplan locally with in-memory stand-ins for Postgres (PGlite) and S3,
// so upgrades and serving changes can be checked in a browser without Docker.
// The bootstrap account has full access. Upload with:
//   POSTPLAN_API_URL=http://localhost:3000 POSTPLAN_API_KEY=dev-key node bin/postplan.js upload page.html
import http from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const pgPort = 15432;
const s3Port = 15433;

const db = await PGlite.create();
await new PGLiteSocketServer({ db, port: pgPort, maxConnections: 10 }).start();

// Path-style PUT and GET are all Postplan's storage layer uses.
const objects = new Map();
http
  .createServer(async (req, res) => {
    const key = new URL(req.url, "http://s3").pathname;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.method === "PUT") {
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"dev"' }).end();
    } else if (req.method === "GET" && objects.has(key)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(objects.get(key));
    } else {
      res.writeHead(404).end();
    }
  })
  .listen(s3Port, "127.0.0.1");

const defaults = {
  PORT: "3000",
  DATABASE_URL: `postgres://postgres@127.0.0.1:${pgPort}/postgres`,
  AWS_ENDPOINT_URL: `http://127.0.0.1:${s3Port}`,
  AWS_ACCESS_KEY_ID: "dev",
  AWS_SECRET_ACCESS_KEY: "dev",
  AWS_S3_BUCKET_NAME: "postplan",
  // The stand-in stores raw bodies, so keep the SDK from chunk-encoding them.
  AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
  AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
  POSTPLAN_BOOTSTRAP_API_KEY: "dev-key",
  POSTPLAN_FULL_ACCESS_ACCOUNTS: "acct_bootstrap"
};
for (const [name, value] of Object.entries(defaults)) process.env[name] ??= value;

// Config is read at import time, so the server loads after the environment is set.
await import("../src/server.js");
