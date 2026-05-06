use std::{collections::HashMap, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let env_paths = [manifest_dir.join("../.env"), manifest_dir.join(".env")];

    for path in &env_paths {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    let env_values = env_paths
        .iter()
        .find_map(|path| fs::read_to_string(path).ok())
        .map(|content| parse_env_file(&content))
        .unwrap_or_default();

    let client_id = env_values
        .get("BACKUPQUEST_GOOGLE_CLIENT_ID")
        .or_else(|| env_values.get("GOOGLE_OAUTH_CLIENT_ID"))
        .cloned()
        .unwrap_or_default();
    let client_secret = env_values
        .get("BACKUPQUEST_GOOGLE_CLIENT_SECRET")
        .or_else(|| env_values.get("GOOGLE_OAUTH_CLIENT_SECRET"))
        .cloned()
        .unwrap_or_default();

    println!("cargo:rustc-env=BACKUPQUEST_GOOGLE_CLIENT_ID={client_id}");
    println!("cargo:rustc-env=BACKUPQUEST_GOOGLE_CLIENT_SECRET={client_secret}");

    tauri_build::build()
}

fn parse_env_file(content: &str) -> HashMap<String, String> {
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }

            let (key, value) = line.split_once('=')?;
            let value = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            Some((key.trim().to_string(), value))
        })
        .collect()
}
