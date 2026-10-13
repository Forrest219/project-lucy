import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { negotiateEncoding, parseAcceptEncoding, serveStaticAsset } from "../static-assets";
import { precompressAssets } from "../../scripts/precompress-assets.mjs";

let dist: string;
let app: FastifyInstance;
const script = `console.log(${JSON.stringify("x".repeat(4000))});\n`;

beforeEach(async () => {
  dist = await mkdtemp(path.join(os.tmpdir(), "lucy-static-"));
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), "<!doctype html><html><body><script type=\"module\" src=\"/assets/index-AbCdEf12.js\"></script></body></html>", "utf8");
  await writeFile(path.join(dist, "assets", "index-AbCdEf12.js"), script, "utf8");
  await writeFile(path.join(dist, "assets", "index-AbCdEf12.css"), `body{color:red}${" ".repeat(2000)}`, "utf8");
  await writeFile(path.join(dist, "assets", "logo.svg"), "<svg/>", "utf8");
  await writeFile(path.join(dist, "favicon.ico"), "ico", "utf8");
  await precompressAssets(path.join(dist, "assets"));
  app = Fastify();
  app.get("/api/x", async () => ({ ok: true }));
  app.setNotFoundHandler(async (request, reply) => serveStaticAsset(request, reply, dist));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(dist, { recursive: true, force: true });
});

describe("Spec 174 T4 — static asset negotiation (SC-11)", () => {
  it("parses q-values and honours q=0", () => {
    expect(parseAcceptEncoding("gzip;q=0.5, br;q=0, *;q=0.1").get("br")).toBe(0);
    expect(negotiateEncoding("gzip, br", ["identity", "br", "gzip"])).toBe("br");
    expect(negotiateEncoding("gzip;q=1, br;q=0.5", ["identity", "br", "gzip"])).toBe("gzip");
    expect(negotiateEncoding("gzip;q=0", ["identity", "gzip"])).toBe("identity");
    expect(negotiateEncoding(undefined, ["identity", "gzip"])).toBe("identity");
    expect(negotiateEncoding("identity;q=0", ["identity"])).toBeNull();
    expect(negotiateEncoding("*", ["identity", "br"])).toBe("br");
  });

  it("serves br / gzip / identity with Vary, MIME, Content-Length and immutable caching", async () => {
    const br = await app.inject({ method: "GET", url: "/assets/index-AbCdEf12.js", headers: { "accept-encoding": "br, gzip" } });
    expect(br.statusCode).toBe(200);
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers["vary"]).toBe("Accept-Encoding");
    expect(br.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(br.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(Number(br.headers["content-length"])).toBe(br.rawPayload.byteLength);
    expect(brotliDecompressSync(br.rawPayload).toString("utf8")).toBe(script);

    const gz = await app.inject({ method: "GET", url: "/assets/index-AbCdEf12.js", headers: { "accept-encoding": "gzip" } });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.rawPayload).toString("utf8")).toBe(script);
    expect(gz.headers["etag"]).not.toBe(br.headers["etag"]);

    const identity = await app.inject({ method: "GET", url: "/assets/index-AbCdEf12.js", headers: { "accept-encoding": "gzip;q=0" } });
    expect(identity.headers["content-encoding"]).toBeUndefined();
    expect(identity.body).toBe(script);
    expect(Number(identity.headers["content-length"])).toBe(Buffer.byteLength(script));

    const css = await app.inject({ method: "GET", url: "/assets/index-AbCdEf12.css", headers: { "accept-encoding": "gzip" } });
    expect(css.headers["content-type"]).toMatch(/^text\/css/);
  });

  it("answers HEAD and conditional requests per representation", async () => {
    const head = await app.inject({ method: "HEAD", url: "/assets/index-AbCdEf12.js", headers: { "accept-encoding": "gzip" } });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-encoding"]).toBe("gzip");
    const etag = String(head.headers["etag"]);
    const notModified = await app.inject({ method: "GET", url: "/assets/index-AbCdEf12.js", headers: { "accept-encoding": "gzip", "if-none-match": etag } });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers["vary"]).toBe("Accept-Encoding");
    const otherRepresentation = await app.inject({ method: "GET", url: "/assets/index-AbCdEf12.js", headers: { "accept-encoding": "br", "if-none-match": etag } });
    expect(otherRepresentation.statusCode).toBe(200);
  });

  it("never falls back to cached HTML for missing, escaping or badly encoded assets", async () => {
    for (const url of ["/assets/missing-00000000.js", "/assets/index-AbCdEf12.js.gz"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["cache-control"], url).toBe("no-store");
      expect(res.body, url).not.toContain("<!doctype html>");
    }
    // inject normalizes dot segments; send the raw encoded traversal over a socket.
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const raw = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const { hostname, port } = new URL(address);
      const req = http.request({ hostname, port, path: "/assets/%2e%2e/index.html", method: "GET" }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
    expect(raw.status).toBe(404);
    expect(raw.body).not.toContain("<!doctype html>");
    const bad = await app.inject({ method: "GET", url: "/assets/%E0%A4%A.js" });
    expect(bad.statusCode).toBe(400);
  });

  it("serves the SPA shell for deep links with no-cache, unhashed files without immutable", async () => {
    const deep = await app.inject({ method: "GET", url: "/catalog/c/s/t?x=1" });
    expect(deep.statusCode).toBe(200);
    expect(deep.headers["content-type"]).toMatch(/^text\/html/);
    expect(deep.headers["cache-control"]).toBe("no-cache");
    expect(deep.headers["etag"]).toBeTruthy();
    const svg = await app.inject({ method: "GET", url: "/assets/logo.svg" });
    expect(svg.headers["cache-control"]).toBe("no-cache");
    expect(svg.headers["content-encoding"]).toBeUndefined();
    const ico = await app.inject({ method: "GET", url: "/favicon.ico" });
    expect(ico.statusCode).toBe(200);
    expect(ico.headers["content-type"]).toBe("image/x-icon");
    const api = await app.inject({ method: "GET", url: "/api/x" });
    expect(api.headers["cache-control"]).toBeUndefined();
  });
});
