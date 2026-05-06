// Direct loader for the local-built .node binary. Bypasses the
// @napi-rs/cli generated platform-package indirection (no need to
// publish/install per-arch subpackages for a private workspace crate).

const path = require("node:path");
const native = require(path.join(__dirname, "cairn-embed.darwin-arm64.node"));
module.exports = native;
