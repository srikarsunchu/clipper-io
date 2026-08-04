import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders Clipwire editor metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Clipwire Studio/i);
  assert.match(html, /AI Short-Form Video Editor/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
});

test("keeps the editor split into production surfaces", async () => {
  const [page, timeline, assetPanel, preview, inspector, math] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editor/timeline/Timeline.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editor/AssetPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editor/PreviewStage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editor/InspectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../shared/timeline-math.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<Timeline/);
  assert.match(page, /<AssetPanel/);
  assert.match(page, /<PreviewStage/);
  assert.match(page, /<InspectorPanel/);
  assert.match(timeline, /useTimelineGeometry|pxPerSecond|snapTime/);
  assert.match(timeline, /timeline-empty-lane/);
  assert.match(assetPanel, /Coming next/);
  assert.match(preview, /Add media to start/);
  assert.match(inspector, /Adjustments are planned/);
  assert.match(math, /mapCuesToEditTime/);
});
