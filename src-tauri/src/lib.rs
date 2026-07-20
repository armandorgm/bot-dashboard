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
    let backend_env = std::path::Path::new("..").join("backend").join(".env");
    if backend_env.exists() {
        return dotenvy::from_path(&backend_env).map(|_| backend_env);
    }
    let local_backend_env = std::path::Path::new("backend").join(".env");
    if local_backend_env.exists() {
        return dotenvy::from_path(&local_backend_env).map(|_| local_backend_env);
    }
    dotenvy::dotenv()
}

async fn start_binance_private_stream(app_handle: AppHandle) {
    let _ = load_env();

    let api_key = match env::var("BINANCE_API_KEY2") {
        Ok(val) => val,
        Err(_) => {
            eprintln!("[Rust WS] BINANCE_API_KEY2 not found in env. Private stream aborted.");
            return;
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

    println!("[Rust WS] Initializing Binance private user stream (testnet={})...", is_testnet);

    let client = reqwest::Client::new();

    loop {
        let listen_key_url = format!("{}/fapi/v1/listenKey", rest_base);
        let res = match client.post(&listen_key_url)
            .header("X-MBX-APIKEY", &api_key)
            .send()
            .await 
        {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[Rust WS] Failed to request listenKey: {}. Retrying in 10s...", e);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            eprintln!("[Rust WS] listenKey HTTP error ({}): {}. Retrying in 10s...", status, body);
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
                eprintln!("[Rust WS] Failed to parse listenKey JSON: {}. Retrying in 10s...", e);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        let listen_key = lk_res.listen_key;
        println!("[Rust WS] Got listenKey: {}...", &listen_key[..std::cmp::min(10, listen_key.len())]);

        let client_clone = client.clone();
        let api_key_clone = api_key.clone();
        let listen_key_clone = listen_key.clone();
        let listen_key_url_clone = listen_key_url.clone();
        
        let keep_alive_handle = tauri::async_runtime::spawn(async move {
            loop {
                sleep(Duration::from_secs(30 * 60)).await;
                println!("[Rust WS] Sending listenKey keepalive ping...");
                let ping_res = client_clone.put(&listen_key_url_clone)
                    .header("X-MBX-APIKEY", &api_key_clone)
                    .query(&[("listenKey", &listen_key_clone)])
                    .send()
                    .await;
                match ping_res {
                    Ok(r) if r.status().is_success() => {
                        println!("[Rust WS] listenKey keepalive successful.");
                    }
                    Ok(r) => {
                        eprintln!("[Rust WS] listenKey keepalive returned error code: {}", r.status());
                    }
                    Err(e) => {
                        eprintln!("[Rust WS] listenKey keepalive request failed: {}", e);
                    }
                }
            }
        });

        let ws_url = format!("{}/{}", ws_base, listen_key);
        println!("[Rust WS] Connecting to private stream at {}...", ws_url);

        let ws_stream = match connect_async(&ws_url).await {
            Ok((stream, _)) => stream,
            Err(e) => {
                eprintln!("[Rust WS] WebSocket connection failed: {}. Retrying in 10s...", e);
                keep_alive_handle.abort();
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        println!("[Rust WS] Connected to Binance User Data Stream!");
        let (_, mut read) = ws_stream.split();

        while let Some(message) = read.next().await {
            match message {
                Ok(msg) => {
                    if msg.is_text() || msg.is_binary() {
                        if let Ok(text) = msg.to_text() {
                            let _ = app_handle.emit("binance-private-event", text.to_string());
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[Rust WS] WebSocket connection error: {}. Reconnecting...", e);
                    break;
                }
            }
        }

        keep_alive_handle.abort();
        println!("[Rust WS] Disconnected. Reconnecting to private stream in 5s...");
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
