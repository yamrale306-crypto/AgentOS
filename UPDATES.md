# Update policy

Windows uses Tauri's official updater with a signed release manifest and embedded public key. The updater remains disabled until release CI supplies its production endpoint and public key; unsigned updates must never be enabled.

Android Play Store builds use Play-managed updates. Direct APK distribution only checks `/api/app/version`, shows an official HTTPS download link, and leaves installation to Android's user-approved package installer. It must not silently install APKs.

The public version endpoint contains no credentials and is not an authorization source.
