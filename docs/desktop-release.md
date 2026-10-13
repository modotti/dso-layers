# Desktop release guide

## Local candidate

From `frontend`, run `npm ci`, `npm run desktop:pack`, and `npm run desktop:verify`. The unpacked Apple Silicon application is written to `release/mac-arm64/Paralastro.app`. `npm run desktop:dist` additionally creates DMG and ZIP artifacts.

Unsigned candidates are only for local smoke tests. Public macOS releases require an Apple Developer ID Application certificate and notarization credentials.

## CI secrets

Configure protected repository secrets:

- `CSC_LINK`: base64-encoded or private URL/path to the Developer ID `.p12` certificate.
- `CSC_KEY_PASSWORD`: certificate password.
- `APPLE_API_KEY`: path populated by CI from an App Store Connect `.p8` secret.
- `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`: App Store Connect identifiers.

Electron Builder signs nested executables and notarizes when those credentials are present. Never commit certificates, API keys, passwords, or notarization profiles.

## Release procedure

1. Run frontend and backend tests and package verification on the intended architecture.
2. Validate import, scene construction, saved preferences, and representative video exports from the packaged app.
3. Confirm third-party notices and provide the corresponding FFmpeg source obligation described in `third-party-notices.md`.
4. Create a tag matching `v*`; the desktop release workflow builds the signed candidate and produces checksums.
5. On a clean Mac, run `codesign --verify --deep --strict`, `spctl --assess --type execute`, and `xcrun stapler validate` before publishing.

Intel macOS and Windows artifacts require native runners and matching backend/FFmpeg binaries. They are intentionally not emitted by the initial Apple Silicon workflow.
