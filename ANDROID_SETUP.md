# Android setup

The Android client is Capacitor over the same static React bundle. It calls the existing backend and authenticates through Supabase; no backend, database, or AI logic is packaged on-device.

Prerequisites: Node 20+, Android Studio, Android SDK platform/build tools, JDK 17, and a configured release keystore.

```powershell
cd mobile
npm install
# Only needed the first time / on a fresh checkout (generates the android/ project).
# The generated android/ directory is gitignored and regenerated on demand.
npx cap add android
npm run sync
cd android
./gradlew assembleRelease
./gradlew bundleRelease
```

The generated APK/AAB are under `mobile/android/app/build/outputs/`. Supply signing credentials through environment variables or GitHub Actions secrets; never commit a keystore or passwords.
