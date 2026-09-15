/**
 * Tests fuer fetchMitTimeout() aus server/mistral.js: Timeout und der eine
 * Wiederholungsversuch bei transienten Fehlern. Laeuft gegen einen lokalen
 * HTTP-Server, kein Mistral-Key und kein DATABASE_URL noetig.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchMitTimeout } from "./mistral.js";

let server;
let basis;
let aufrufe = 0;
let modus = "ok";

before(async () => {
  server = http.createServer((req, res) => {
    aufrufe++;
    if (modus === "haengt") return; // Antwortet nie -> Timeout
    if (modus === "einmal_503" && aufrufe === 1) {
      res.writeHead(503).end("Service Unavailable");
      return;
    }
    if (modus === "immer_500") {
      res.writeHead(500).end("kaputt");
      return;
    }
    if (modus === "400") {
      res.writeHead(400).end("Bad Request");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
  });
  await new Promise((r) => server.listen(0, r));
  basis = `http://localhost:${server.address().port}`;
});

after(() => server?.close());

function starte(neuerModus) {
  modus = neuerModus;
  aufrufe = 0;
}

test("Erfolg beim ersten Versuch: genau ein Aufruf", async () => {
  starte("ok");
  const antwort = await fetchMitTimeout(basis, { method: "GET" }, "Test");
  assert.equal(antwort.status, 200);
  assert.equal(aufrufe, 1);
});

test("transienter 503 wird genau einmal wiederholt und geht dann durch", async () => {
  starte("einmal_503");
  const antwort = await fetchMitTimeout(basis, { method: "GET" }, "Test");
  assert.equal(antwort.status, 200);
  assert.equal(aufrufe, 2);
});

test("dauerhafter 5xx wird nach dem zweiten Versuch durchgereicht, nicht endlos wiederholt", async () => {
  starte("immer_500");
  const antwort = await fetchMitTimeout(basis, { method: "GET" }, "Test");
  assert.equal(antwort.status, 500);
  assert.equal(aufrufe, 2);
});

test("4xx wird sofort durchgereicht - Wiederholen aendert daran nichts", async () => {
  starte("400");
  const antwort = await fetchMitTimeout(basis, { method: "GET" }, "Test");
  assert.equal(antwort.status, 400);
  assert.equal(aufrufe, 1);
});

test("haengende Antwort laeuft in den Timeout und wirft nach dem zweiten Versuch", async () => {
  starte("haengt");
  process.env.MISTRAL_TIMEOUT_MS = "300";
  const { fetchMitTimeout: mitKurzemTimeout } = await import(`./mistral.js?timeout=${Date.now()}`);
  await assert.rejects(() => mitKurzemTimeout(basis, { method: "GET" }, "Test"), /Timeout nach 300ms/);
  assert.equal(aufrufe, 2);
  delete process.env.MISTRAL_TIMEOUT_MS;
});
