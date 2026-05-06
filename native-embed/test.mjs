// Smoke test for the native embedder.
// First call pays model-load cost; second call is hot.

import { embedQuery, warmup } from "./index.js";

console.log("[test] warming up...");
const t0 = Date.now();
const dim = await warmup();
console.log(`[test] warmup took ${Date.now() - t0}ms, dim=${dim}`);

const t1 = Date.now();
const v1 = await embedQuery("stripe billing webhook");
console.log(`[test] cold embed took ${Date.now() - t1}ms, len=${v1.length}`);

const t2 = Date.now();
const v2 = await embedQuery("design system component library");
console.log(`[test] hot embed took ${Date.now() - t2}ms, len=${v2.length}`);

const t3 = Date.now();
const v3 = await embedQuery("another query");
console.log(`[test] hot embed 2 took ${Date.now() - t3}ms, len=${v3.length}`);
