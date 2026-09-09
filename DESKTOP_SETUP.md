# Windows desktop setup

AgentOS Desktop is a Tauri shell around the same statically exported React client used by Android. It uses the existing Express API and Supabase Auth; it does not package any provider credential or task runner.

Prerequisites: Node 20+, Rust/Cargo, Windows build tools, WebView2, and Tauri's Windows prerequisites.

```powershell
cd desktop
npm install
npm run build
```

The installer is emitted by Tauri beneath `desktop/src-tauri/target/release/bundle/`.

Before enabling automatic updates, configure a Tauri updater public key and HTTPS update endpoint at release time. Keep the private signing key exclusively in GitHub Secrets.
