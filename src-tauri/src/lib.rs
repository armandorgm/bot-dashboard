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

    let parent_port = env::var("PARENT_API_PORT").unwrap_or_else(|_| "8000".to_string());
    let listen_key_url = format!("http://127.0.0.1:{}/api/orders/listen-key", parent_port);

    loop {
        let _ = app_handle.emit("binance-rust-log", format!("[Rust WS] Solicitando listenKey mediante Proxy Python local a {}...", listen_key_url));

        let res = match client.get(&listen_key_url)
            .send()
            .await 
        {
            Ok(r) => r,
            Err(e) => {
                let err_msg = format!("[Rust WS] ERROR al pedir listenKey por Proxy: {}. ¿El bot de Python está encendido? Reintentando en 10s...", e);
                eprintln!("{}", err_msg);
                let _ = app_handle.emit("binance-rust-log", err_msg);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            let err_msg = format!("[Rust WS] ERROR HTTP de listenKey mediante Proxy ({}): {}. Reintentando en 10s...", status, body);
            eprintln!("{}", err_msg);
            let _ = app_handle.emit("binance-rust-log", err_msg);
            sleep(Duration::from_secs(10)).await;
            continue;
        }

        #[derive(serde::Deserialize)]
        struct ListenKeyResponse {
            #[serde(rename = "listenKey")]
            listen_key: String,
            is_testnet: bool,
        }

        let lk_res: ListenKeyResponse = match res.json().await {
            Ok(json) => json,
            Err(e) => {
                let err_msg = format!("[Rust WS] ERROR al deserializar listenKey JSON del Proxy: {}. Reintentando en 10s...", e);
                eprintln!("{}", err_msg);
                let _ = app_handle.emit("binance-rust-log", err_msg);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        let listen_key = lk_res.listen_key;
        let is_testnet = lk_res.is_testnet;

        let ws_base = if is_testnet {
            "wss://testnet.binancefuture.com/ws"
        } else {
            "wss://fstream.binance.com/ws"
        };

        let init_msg = format!("[Rust WS] Inicializando flujo privado en {} (is_testnet={})", ws_base, is_testnet);
        println!("{}", init_msg);
        let _ = app_handle.emit("binance-rust-log", init_msg);

        let success_lk = format!("[Rust WS] listenKey obtenido con éxito: {}...", &listen_key[..std::cmp::min(10, listen_key.len())]);
        println!("{}", success_lk);
        let _ = app_handle.emit("binance-rust-log", success_lk);

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

        let disc_msg = "[Rust WS] Desconectado. Reconectando en 5s...".to_string();
        println!("{}", disc_msg);
        let _ = app_handle.emit("binance-rust-log", disc_msg);
        sleep(Duration::from_secs(5)).await;
    }
}

#[tauri::command]
fn start_private_stream(app_handle: AppHandle) {
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        start_binance_private_stream(handle).await;
    });

    // ── Diagnostic Simulator (Mitad B) ──
    // Emits a mock Binance payload to the frontend every 10 seconds 
    // to isolate and verify the IPC event boundary.
    let handle_sim = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(10)).await;
            let mock_payload = r#"{
                "e": "ORDER_TRADE_UPDATE",
                "E": 1672531199000,
                "o": {
                    "s": "1000PEPEUSDC",
                    "c": "test_client_order_id",
                    "S": "BUY",
                    "o": "LIMIT",
                    "f": "GTC",
                    "q": "1000",
                    "p": "0.0028800",
                    "ap": "0.0028800",
                    "sp": "0.0000000",
                    "x": "NEW",
                    "X": "NEW",
                    "i": 999999,
                    "l": "0",
                    "z": "0",
                    "L": "0",
                    "n": "0",
                    "N": "USDT",
                    "T": 1672531199000,
                    "t": -1,
                    "b": "2.88",
                    "a": "2.88",
                    "m": false,
                    "R": false,
                    "wt": "CONTRACT_PRICE",
                    "ot": "LIMIT",
                    "ps": "LONG",
                    "cp": false,
                    "rp": "0"
                }
            }"#;
            let _ = handle_sim.emit("binance-rust-log", "[Rust Sim] Emitiendo evento ORDER_TRADE_UPDATE ficticio de prueba...".to_string());
            let _ = handle_sim.emit("binance-private-event", mock_payload.to_string());
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_instance_config, start_private_stream])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
