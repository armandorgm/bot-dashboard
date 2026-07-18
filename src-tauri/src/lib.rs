use serde::Serialize;

#[derive(Serialize)]
pub struct InstanceConfig {
    pub instance_id: String,
    pub symbol: String,
    pub port: String,
    pub parent_api_port: String,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn get_instance_config() -> InstanceConfig {
    InstanceConfig {
        instance_id: std::env::var("INSTANCE_ID").unwrap_or_else(|_| "0".to_string()),
        symbol: std::env::var("INSTANCE_SYMBOL").unwrap_or_else(|_| "UNKNOWN".to_string()),
        port: std::env::var("DASHBOARD_PORT").unwrap_or_else(|_| "12001".to_string()),
        parent_api_port: std::env::var("PARENT_API_PORT").unwrap_or_else(|_| "8000".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_instance_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
