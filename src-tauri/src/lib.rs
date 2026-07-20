use serde::Serialize;
use tauri::{AppHandle, Emitter};
use std::env;
use std::time::Duration;
use tokio::time::sleep;
use futures_util::StreamExt;
use tokio_tungstenite::connect_async;

#[derive(Serialize, Clone)]
pub struct InstanceConfig {
    pub instance_id: String,
    pub symbol: String,
    pub port: String,
    pub parent_api_port: String,
}

#[tauri::command]
fn get_instance_config() -> InstanceConfig {
    let _ = load_env();
    InstanceConfig {
        instance_id: env::var("INSTANCE_ID").unwrap_or_else(|_| "0".to_string()),
        symbol: env::var("INSTANCE_SYMBOL").unwrap_or_else(|_| "UNKNOWN".to_string()),
        port: env::var("DASHBOARD_PORT").unwrap_or_else(|_| "12001".to_string()),
        parent_api_port: env::var("PARENT_API_PORT").unwrap_or_else(|_| "8000".to_string()),
    }
}

fn load_env() -> Result<std::path::PathBuf, dotenvy::Error> {
    if let Ok(p) = dotenvy::dotenv() {
        return Ok(p);
    }
    // Search upwards to find backend/.env
    if let Ok(current_dir) = std::env::current_dir() {
        let mut dir = current_dir;
        loop {
            let backend_env = dir.join("backend").join(".env");
            if backend_env.exists() {
                println!("[Rust WS] .env file loaded from path: {:?}", backend_env);
                return dotenvy::from_path(&backend_env).map(|_| backend_env);
            }
            let parent_backend_env = dir.join("..").join("backend").join(".env");
            if parent_backend_env.exists() {
                println!("[Rust WS] .env file loaded from parent path: {:?}", parent_backend_env);
                return dotenvy::from_path(&parent_backend_env).map(|_| parent_backend_env);
            }
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            } else {
                break;
            }
        }
    }
    dotenvy::dotenv()
}

async fn start_binance_private_stream(app_handle: AppHandle) {
    let _ = load_env();

    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build() 
    {
        Ok(c) => c,
        Err(_) => reqwest::Client::new(),
    };

    loop {
        let api_key = match env::var("BINANCE_API_KEY2") {
            Ok(val) => val,
            Err(_) => {
                let err_msg = "[Rust WS] ERROR: BINANCE_API_KEY2 no encontrada en .env. Verifica que el archivo .env exista en la raiz de bot-dashboard y tenga esta clave. Reintentando verificar en 5s...".to_string();
                eprintln!("{}", err_msg);
                let _ = app_handle.emit("binance-rust-log", err_msg);
                sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        let is_testnet = env::var("TESTNET")
            .unwrap_or_else(|_| "false".to_string())
            .trim()
            .to_lowercase() == "true";

    let rest_base = if is_testnet {
        "https://testnet.binancefuture.com"
    } else {
        "https://fstream.binance.com"
    };

    let ws_base = if is_testnet {
        "wss://testnet.binancefuture.com/ws"
    } else {
        "wss://fstream.binance.com/ws"
    };

    let init_msg = format!("[Rust WS] Inicializando flujo privado en {} (Testnet={})", rest_base, is_testnet);
    println!("{}", init_msg);
    let _ = app_handle.emit("binance-rust-log", init_msg);

    let listen_key_url = format!("{}/fapi/v1/listenKey", rest_base);
    let _ = app_handle.emit("binance-rust-log", format!("[Rust WS] Solicitando listenKey a {}...", listen_key_url));

        let res = match client.post(&listen_key_url)
            .header("X-MBX-APIKEY", &api_key)
            .send()
            .await 
        {
            Ok(r) => r,
            Err(e) => {
                let err_msg = format!("[Rust WS] ERROR al pedir listenKey: {}. Reintentando en 10s...", e);
                eprintln!("{}", err_msg);
                let _ = app_handle.emit("binance-rust-log", err_msg);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            let err_msg = format!("[Rust WS] ERROR HTTP de listenKey ({}): {}. Reintentando en 10s...", status, body);
            eprintln!("{}", err_msg);
            let _ = app_handle.emit("binance-rust-log", err_msg);
            sleep(Duration::from_secs(10)).await;
            continue;
        }

        #[derive(serde::Deserialize)]
        struct ListenKeyResponse {
            #[serde(rename = "listenKey")]
            listen_key: String,
        }

        let lk_res: ListenKeyResponse = match res.json().await {
            Ok(json) => json,
            Err(e) => {
                let err_msg = format!("[Rust WS] ERROR al deserializar listenKey JSON: {}. Reintentando en 10s...", e);
                eprintln!("{}", err_msg);
                let _ = app_handle.emit("binance-rust-log", err_msg);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        let listen_key = lk_res.listen_key;
        let success_lk = format!("[Rust WS] listenKey obtenido con éxito: {}...", &listen_key[..std::cmp::min(10, listen_key.len())]);
        println!("{}", success_lk);
        let _ = app_handle.emit("binance-rust-log", success_lk);

        let client_clone = client.clone();
        let api_key_clone = api_key.clone();
        let listen_key_clone = listen_key.clone();
        let listen_key_url_clone = listen_key_url.clone();
        
        let app_handle_ping = app_handle.clone();
        let keep_alive_handle = tauri::async_runtime::spawn(async move {
            loop {
                sleep(Duration::from_secs(30 * 60)).await;
                let _ = app_handle_ping.emit("binance-rust-log", "[Rust WS] Enviando keepalive ping de listenKey...".to_string());
                let ping_res = client_clone.put(&listen_key_url_clone)
                    .header("X-MBX-APIKEY", &api_key_clone)
                    .query(&[("listenKey", &listen_key_clone)])
                    .send()
                    .await;
                match ping_res {
                    Ok(r) if r.status().is_success() => {
                        let _ = app_handle_ping.emit("binance-rust-log", "[Rust WS] Keepalive de listenKey exitoso.".to_string());
                    }
                    Ok(r) => {
                        let _ = app_handle_ping.emit("binance-rust-log", format!("[Rust WS] ADVERTENCIA: keepalive falló con estado: {}", r.status()));
                    }
                    Err(e) => {
                        let _ = app_handle_ping.emit("binance-rust-log", format!("[Rust WS] ADVERTENCIA: keepalive falló por red: {}", e));
                    }
                }
            }
        });

        let ws_url = format!("{}/{}", ws_base, listen_key);
        let connect_msg = format!("[Rust WS] Conectando al WebSocket de usuario: {}...", ws_url);
        println!("{}", connect_msg);
        let _ = app_handle.emit("binance-rust-log", connect_msg);

        let ws_stream = match connect_async(&ws_url).await {
            Ok((stream, _)) => stream,
            Err(e) => {
                let err_msg = format!("[Rust WS] ERROR al conectar WebSocket: {}. Reintentando en 10s...", e);
                eprintln!("{}", err_msg);
                let _ = app_handle.emit("binance-rust-log", err_msg);
                keep_alive_handle.abort();
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        let established_msg = "[Rust WS] Conectado exitosamente al User Data Stream de Binance!".to_string();
        println!("{}", established_msg);
        let _ = app_handle.emit("binance-rust-log", established_msg);

        let (_, mut read) = ws_stream.split();

        while let Some(message) = read.next().await {
            match message {
                Ok(msg) => {
                    if msg.is_text() || msg.is_binary() {
                        if let Ok(text) = msg.to_text() {
                            let _ = app_handle.emit("binance-rust-log", format!("[Rust WS] Payload crudo recibido ({} bytes)", text.len()));
                            let _ = app_handle.emit("binance-private-event", text.to_string());
                        }
                    }
                }
                Err(e) => {
                    let err_msg = format!("[Rust WS] ERROR de conexión de WebSocket: {}. Reconectando...", e);
                    eprintln!("{}", err_msg);
                    let _ = app_handle.emit("binance-rust-log", err_msg);
                    break;
                }
            }
        }

        keep_alive_handle.abort();
        let disc_msg = "[Rust WS] Desconectado. Reconectando en 5s...".to_string();
        println!("{}", disc_msg);
        let _ = app_handle.emit("binance-rust-log", disc_msg);
        sleep(Duration::from_secs(5)).await;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_instance_config])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                start_binance_private_stream(handle).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
