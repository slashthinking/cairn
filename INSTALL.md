# Cairn install (recipient guide)

> macOS 12.0 or newer · **Apple Silicon required** (M1 / M2 / M3 / M4)

## Quick install

1. Double-click `Cairn-0.1.0-arm64.dmg`
2. Drag the **Cairn** icon into the **Applications** folder
3. Eject the disk image

## First launch

This is a development build with no Apple Developer ID. Double-clicking it the first time will be blocked by Gatekeeper. Pick any of the three workarounds below.

### Option A — right-click open (recommended)

1. Open **Applications**
2. **Right-click** `Cairn` → **Open**
3. In the dialog, click **Open**

### Option B — System Settings (macOS 15+ commonly needs this)

1. Double-click Cairn once (it gets blocked — that's expected)
2. Open **System Settings → Privacy & Security**
3. Scroll to the bottom, you'll see "Cairn was blocked..."
4. Click **Open Anyway** → enter your password to confirm

### Option C — Terminal one-liner (cleanest)

```bash
xattr -dr com.apple.quarantine /Applications/Cairn.app
```

After that, double-click works permanently — no more warnings.

---

After the first launch, subsequent starts behave like a normal app.

## Hardware

- **Apple Silicon required.** Intel Macs are not supported in this build. The embedding model runs on Metal; on Intel CPU it takes 5–15 seconds per query (unusable). LanceDB also ships only `aarch64-apple-darwin` prebuilts for macOS.
- macOS 12 (Monterey) or newer.

## Troubleshooting

- **"App is damaged and can't be opened":** macOS aggressively quarantined the DMG download. Use Option C above.
- **Blank window after launch:** make sure `claude` (Claude Code CLI) is installed and reachable from your shell `PATH`. Cairn relies on it for AI rename and clustering.
- **First search is slow:** first query downloads the embedding model (~600MB) into `~/.cache/huggingface/`. After that warm queries are ~150ms.
- **Want to use a HF mirror (e.g. for users in mainland China):** set `HF_ENDPOINT=https://hf-mirror.com` in your shell before launching Cairn.
