# Desktop distribution plan

## Objective

Turn the current Electron development shell into a self-contained desktop product without disrupting the existing web and desktop development workflows.

The first production target is macOS. The packaging architecture must avoid assumptions that would prevent a later Windows release.

## Current state

The application already provides:

- An Angular production build served by the Electron main process.
- A local FastAPI backend started by Electron.
- A background render worker with a narrow, versioned IPC protocol.
- Deterministic frame streaming to FFmpeg.
- Native MP4 save dialogs and local-only source image processing.

The current desktop shell is not yet portable because it depends on:

- `backend/.venv/bin/python` inside the source repository.
- Python packages installed on the developer machine.
- `ffmpeg` being available on the system `PATH`.
- Backend and effect assets being available through repository-relative paths.
- Fixed local ports without production-grade collision and readiness handling.

## Guiding constraints

- Keep `npm start` and backend development commands unchanged.
- Keep `npm run desktop:start` fast and debuggable.
- Packaging must consume production builds; it must not replace development tooling.
- Source images and rendered videos remain local by default.
- The packaged application must not require Python, Node.js, FFmpeg, or the repository to be installed separately.
- Electron renderer code must not gain direct filesystem or process access.
- Platform-specific behavior must stay behind the preload/main-process boundary.

## Target workflows

```text
npm start                 Web frontend development
npm run desktop:start     Electron development shell
npm run desktop:pack      Unpacked local application for smoke testing
npm run desktop:dist      Installable release artifact
npm run desktop:verify    Installed-package smoke and dependency checks
```

## Target packaged architecture

```text
Paralastro.app
├── Electron main process
├── Angular production assets
├── Native backend executable
├── Platform FFmpeg executable
├── Video-effect resources
└── Render worker
```

At startup, Electron resolves resources through `process.resourcesPath`, starts the backend on an available loopback port, waits for a health check, starts the render worker with the bundled FFmpeg path, and only then opens the application window.

## Phase 1 — packaging foundation

- Choose and configure `electron-builder` or Electron Forge. Prefer one tool for packaging, signing, and publishing.
- Add stable application metadata:
  - Product name: Paralastro.
  - Bundle identifier.
  - Version sourced from one canonical location.
  - macOS and Windows icons.
  - Copyright and publisher information.
- Separate development paths from packaged resource paths using `app.isPackaged`.
- Add `desktop:pack` and `desktop:dist` scripts.
- Package the Angular build and Electron files into an unpacked macOS application.

Acceptance criteria:

- `desktop:start` still runs from source.
- `desktop:pack` creates an application that opens outside the repository.
- The renderer retains context isolation, sandboxing, and disabled Node integration.

## Phase 2 — standalone backend

- Create a backend entry point intended for desktop execution.
- Add a `/health` or equivalent readiness endpoint.
- Package the FastAPI application and its Python dependencies as a native executable, initially with PyInstaller.
- Include processing modules and required runtime data explicitly in the packaged binary.
- Resolve backend paths using explicit environment variables supplied by Electron.
- Capture stdout/stderr into rotating application logs.
- Surface startup failures in a native error dialog instead of opening a broken UI.

Development remains unchanged: Electron uses the virtual environment when `app.isPackaged` is false and the bundled executable when it is true.

Acceptance criteria:

- The packaged application runs on a clean Mac without Python installed.
- Scene creation, depth processing, and media serving work outside the repository.
- Backend startup has a bounded timeout and a clear failure message.
- Closing the application terminates the backend process.

## Phase 3 — bundled FFmpeg

- Select reproducible FFmpeg builds for each supported architecture.
- Review redistribution terms and the codec/license configuration, especially H.264 and `libx264`.
- Store platform binaries as packaging resources rather than inside the application archive when execution requires it.
- Pass the resolved FFmpeg path to the render worker instead of relying on `PATH`.
- Validate the binary and required encoders at application startup.
- Bundle the soft-reflections asset and resolve it through the same resource layer.

Acceptance criteria:

- Video export works on a machine with no system FFmpeg.
- Draft, final, portrait, landscape, and soft-reflections exports complete successfully.
- Cancellation removes incomplete output files.
- Missing or incompatible binaries produce actionable errors.

## Phase 4 — desktop lifecycle and reliability

- Enforce a single application instance.
- Replace hard-coded backend ports with an available-port handshake.
- Preserve a stable renderer origin or move preferences to an Electron-managed settings store so persistence does not depend on a port.
- Wait for backend readiness before loading the UI.
- Add bounded retries for backend startup.
- Handle worker and backend crashes independently.
- Shut down child processes during normal exit, reload, update, and unexpected window closure.
- Store logs under the operating system's application-data directory.
- Add a diagnostic action that reveals or exports logs without exposing source images.

Acceptance criteria:

- Launching the application twice focuses the existing instance.
- Settings persist across updates and restarts.
- Port conflicts do not prevent startup.
- No Python, FFmpeg, worker, or temporary-render process remains after exit.

## Phase 5 — macOS release packaging

- Produce universal binaries where dependencies support both Apple Silicon and Intel; otherwise publish architecture-specific artifacts.
- Configure application category, minimum supported macOS version, entitlements, and Hardened Runtime.
- Sign every executable included in the bundle, including backend and FFmpeg binaries.
- Notarize the application with Apple and staple the notarization result.
- Generate a signed `.dmg` or `.zip` release artifact.
- Verify Gatekeeper behavior on a clean machine that has not trusted a development build.

External requirements:

- Apple Developer Program membership.
- Developer ID Application certificate.
- App Store Connect issuer/key credentials or an approved notarization credential flow.

Acceptance criteria:

- The downloaded application opens without an unidentified-developer warning.
- `codesign`, `spctl`, and notarization checks pass.
- Scene creation and video export work from the installed application.

## Phase 6 — Windows preparation

- Build and test the backend and FFmpeg resources for Windows x64 and, if justified, ARM64.
- Replace POSIX-only path and process assumptions.
- Generate an NSIS or MSIX installer.
- Add Authenticode signing when release credentials are available.
- Validate Windows Defender and SmartScreen behavior.

Windows artifacts must be built on Windows CI or a controlled Windows build machine. macOS signing and notarization must likewise run in a macOS environment.

## Phase 7 — release automation

- Add CI jobs that run frontend tests, backend tests, production builds, worker integration tests, and packaging checks.
- Build release artifacts from version tags.
- Generate checksums and a concise release manifest.
- Keep signing credentials only in protected CI secrets.
- Upload artifacts to the selected distribution channel.
- Add automatic updates only after manual installation and rollback are proven reliable.

Recommended release flow:

```text
feature work → main → release candidate build → clean-machine validation
             → version tag → signed/notarized artifacts → publish
```

## Validation matrix

Test packaged builds, not only development mode:

- Fresh installation and first launch.
- Relaunch with saved preferences.
- Upgrade over an existing installation.
- Application path containing spaces and non-ASCII characters.
- User account without administrator privileges.
- Offline operation after installation.
- Scene creation with PNG and TIFF inputs.
- Automatic and imported depth maps.
- 1080p and 4K exports.
- Landscape, square, and portrait exports.
- DOF, captions, Nebula Warp, and light effects.
- Cancellation during processing, rendering, and encoding.
- Low disk space and denied output-folder access.
- Backend and render-worker crash recovery.
- Complete process cleanup after exit.

## Security checklist

- Keep `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- Validate every IPC message and filesystem path in the main process.
- Limit save and resource operations to known render outputs and packaged assets.
- Bind internal servers only to loopback.
- Do not expose arbitrary process execution through preload.
- Do not include development credentials, source images, temporary renders, or local logs in release artifacts.
- Run dependency and packaged-artifact scans before releases.

## Distribution decisions still required

- macOS architectures: universal or separate Apple Silicon/Intel builds.
- Minimum supported macOS version.
- Direct download, GitHub Releases, or another update channel.
- FFmpeg build and its redistribution/license obligations.
- Whether automatic updates are required for the first public release.
- Whether Windows is part of version 0.8 or a later milestone.

## Definition of done

- Development commands remain fast and unchanged in intent.
- A clean Mac can install and run Paralastro without developer tools.
- Python and FFmpeg are included and validated by the application.
- Settings persist between launches and upgrades.
- Scene processing and deterministic export pass the packaged validation matrix.
- Child processes and temporary outputs are cleaned reliably.
- The macOS artifact is signed, notarized, and reproducible from a version tag.
- Release instructions and known platform limitations are documented.

## Recommended implementation order

1. Packaging foundation and unpacked `.app`.
2. Standalone backend executable.
3. Bundled FFmpeg and resource resolver.
4. Startup, port, logging, and process lifecycle hardening.
5. Clean-machine packaged validation.
6. macOS signing and notarization.
7. CI release automation.
8. Windows packaging.

This order keeps the product usable throughout development and exposes portability problems before signing and release automation add complexity.
