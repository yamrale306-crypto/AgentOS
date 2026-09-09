fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_notification::init())
    // Updater endpoints and the public key are release configuration, never source secrets.
    .plugin(tauri_plugin_updater::Builder::new().build())
    .run(tauri::generate_context!())
    .expect("error while running AgentOS desktop");
}
