# Release process

Run the preflight from the repository root before attempting a release:

```powershell
.\scripts\release-preflight.ps1
.\scripts\release-preflight.ps1 -RequireLiveRelease
```

The preflight intentionally fails when native build tools, signing material, or live release credentials are unavailable. It never reads secret values into output.

1. Run backend, frontend, and deployed staging release suites.
2. Apply database migrations to staging and verify `/ready` plus worker recovery.
3. Set `APP_VERSION` and the matching `desktop`/`mobile` package versions.
4. Build the static frontend bundle with `Push-Location frontend; npm run build:static; Pop-Location`, providing `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Build and sign the Tauri Windows installer and Capacitor Android APK/AAB in CI.
6. Upload signed artifacts to a GitHub Release. Publish Tauri updater metadata only after signing.
7. Set backend platform version/download metadata and run the cross-device acceptance test.

Required CI secrets include the Tauri updater private key, Windows signing certificate where used, Android keystore and passwords, plus deployment credentials. No signing material belongs in this repository.

## Current environment status

- Static frontend export: **verified locally** after marking the manifest route static; it requires the production environment variables above.
- Tauri installer: **blocked** until Rust/Cargo, Windows build prerequisites, and signing credentials are available.
- Android APK/AAB: **blocked** until Android SDK/Gradle, a release keystore, and signing credentials are available.
- GitHub Release/deployment: **blocked** until repository release and deployment credentials are configured.
- Tauri auto-update: **disabled** until an official HTTPS updater endpoint and matching public key are supplied.
- Cross-device acceptance: **blocked** until staging is deployed and two test-user tokens are supplied to the E2E suite.
