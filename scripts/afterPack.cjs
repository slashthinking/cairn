// Ad-hoc sign the .app after electron-builder packs it but before dmg.
// Required for Apple Silicon — unsigned arm64 binaries refuse to launch.
// Sign-with-dash signs with no identity (still triggers Gatekeeper "unidentified
// developer" the first time, but the app actually runs).

const { spawnSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  // Universal builds run afterPack three times: once for x64-temp, once for
  // arm64-temp, once for the final merged universal output. If we sign the
  // per-arch temps, electron-builder's universalApp merger fails with
  // "Expected all non-binary files to have identical SHAs" because each
  // per-arch CodeResources has different hashes. Sign only the final output.
  if (context.appOutDir.endsWith("-temp")) {
    console.log(`[afterPack] skipping intermediate ${context.appOutDir}`);
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  const r = spawnSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", appPath],
    { stdio: "inherit" },
  );
  if (r.status !== 0) {
    throw new Error(`codesign failed with status ${r.status}`);
  }
  // Verify
  const v = spawnSync("codesign", ["--verify", "--deep", appPath], {
    stdio: "inherit",
  });
  if (v.status !== 0) {
    throw new Error(`codesign verify failed`);
  }
};
