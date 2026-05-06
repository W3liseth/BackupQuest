use chrono::{DateTime, Local, Utc};
use notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    fs::{self, File},
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{
        mpsc::{self, Receiver, TryRecvError},
        Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{
    write::{SimpleFileOptions, ZipWriter},
    CompressionMethod, ZipArchive,
};

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Autostart(#[from] tauri_plugin_autostart::Error),
}

type AppResult<T> = Result<T, AppError>;

struct AppRuntime {
    oauth_flows: Mutex<HashMap<String, Receiver<Result<GoogleTokenResponse, String>>>>,
    game_dir_watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum StorageTarget {
    Local,
    #[serde(alias = "googleCloud")]
    GoogleDrive,
}

impl Default for StorageTarget {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveConfig {
    client_id: String,
    client_secret: String,
    #[serde(default = "default_drive_folder_name", alias = "bucket")]
    drive_folder_name: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
    token_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    game_dir: Option<String>,
    selected_versions: Vec<String>,
    #[serde(default = "default_true")]
    backup_local: bool,
    #[serde(default)]
    backup_cloud: bool,
    #[serde(default)]
    storage_target: StorageTarget,
    local_backup_dir: Option<String>,
    #[serde(default = "default_backup_retention")]
    backup_retention: usize,
    cron_enabled: bool,
    cron_expression: String,
    #[serde(default)]
    start_on_login: bool,
    #[serde(default = "default_true")]
    close_to_tray: bool,
    google: GoogleDriveConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            game_dir: None,
            selected_versions: Vec::new(),
            backup_local: true,
            backup_cloud: false,
            storage_target: StorageTarget::Local,
            local_backup_dir: default_backup_dir().map(path_to_string),
            backup_retention: default_backup_retention(),
            cron_enabled: false,
            cron_expression: "0 20 * * *".to_string(),
            start_on_login: false,
            close_to_tray: true,
            google: GoogleDriveConfig {
                drive_folder_name: default_drive_folder_name(),
                ..GoogleDriveConfig::default()
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateGameDir {
    path: String,
    source: String,
    versions_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameVersion {
    id: String,
    name: String,
    path: String,
    has_interface: bool,
    has_wtf: bool,
    has_fonts: bool,
    size_bytes: u64,
    last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupArchive {
    id: String,
    name: String,
    path: String,
    created_at: String,
    size_bytes: u64,
    versions: Vec<String>,
    target: StorageTarget,
    status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupResult {
    archive: BackupArchive,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupProgress {
    phase: String,
    percent: u8,
    processed_files: u64,
    total_files: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreRequest {
    archive_path: String,
    game_dir: String,
    versions: Vec<String>,
    google: Option<GoogleDriveConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteBackupRequest {
    archive_path: String,
    google: Option<GoogleDriveConfig>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthFlow {
    flow_id: String,
    auth_url: String,
    redirect_uri: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthPoll {
    completed: bool,
    token: Option<GoogleTokenResponse>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    expires_in: u64,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenRaw {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct DriveFileList {
    files: Vec<DriveFile>,
}

#[derive(Debug, Deserialize)]
struct DriveFile {
    id: String,
    name: String,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    size: Option<String>,
    #[serde(rename = "createdTime")]
    created_time: Option<String>,
    #[serde(rename = "modifiedTime")]
    modified_time: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshTokenRequest {
    refresh_token: String,
}

#[derive(Debug, Clone)]
struct GoogleOAuthCredentials {
    client_id: &'static str,
    client_secret: &'static str,
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    into_command_result(read_config(&app))
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    into_command_result(write_config(&app, &config).map(|_| config))
}

#[tauri::command]
fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    into_command_result(if enabled {
        app.autolaunch().enable().map_err(AppError::from)
    } else {
        app.autolaunch().disable().map_err(AppError::from)
    })
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    into_command_result(app.autolaunch().is_enabled().map_err(AppError::from))
}

#[tauri::command]
async fn detect_game_directories() -> Result<Vec<CandidateGameDir>, String> {
    run_blocking(detect_game_directories_inner).await
}

#[tauri::command]
async fn list_game_versions(game_dir: String) -> Result<Vec<GameVersion>, String> {
    run_blocking(move || list_game_versions_inner(Path::new(&game_dir))).await
}

#[tauri::command]
fn watch_game_directory(
    app: tauri::AppHandle,
    runtime: State<'_, AppRuntime>,
    game_dir: Option<String>,
) -> Result<(), String> {
    into_command_result(watch_game_directory_inner(app, runtime, game_dir))
}

#[tauri::command]
async fn run_backup(
    app: tauri::AppHandle,
    config: AppConfig,
    manual: bool,
) -> Result<BackupResult, String> {
    run_blocking(move || run_backup_inner(app, config, manual)).await
}

#[tauri::command]
async fn is_selected_game_running(config: AppConfig) -> Result<bool, String> {
    run_blocking(move || is_selected_game_running_inner(&config)).await
}

#[tauri::command]
fn send_system_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    into_command_result(send_system_notification_inner(&app, &title, &body))
}

#[tauri::command]
async fn list_backups(local_backup_dir: Option<String>) -> Result<Vec<BackupArchive>, String> {
    run_blocking(move || list_backups_inner(local_backup_dir)).await
}

#[tauri::command]
async fn list_drive_backups(google: GoogleDriveConfig) -> Result<Vec<BackupArchive>, String> {
    run_blocking(move || list_drive_backups_inner(&google)).await
}

#[tauri::command]
async fn restore_backup(app: tauri::AppHandle, request: RestoreRequest) -> Result<String, String> {
    run_blocking(move || restore_backup_inner(app, request)).await
}

#[tauri::command]
async fn delete_backup(request: DeleteBackupRequest) -> Result<String, String> {
    run_blocking(move || delete_backup_inner(request)).await
}

#[tauri::command]
fn start_google_oauth(runtime: State<'_, AppRuntime>) -> Result<OAuthFlow, String> {
    into_command_result(start_google_oauth_inner(runtime))
}

#[tauri::command]
fn poll_google_oauth(runtime: State<'_, AppRuntime>, flow_id: String) -> Result<OAuthPoll, String> {
    let mut flows = runtime
        .oauth_flows
        .lock()
        .map_err(|_| "Impossible de lire l'etat OAuth.".to_string())?;

    let result = match flows.get(&flow_id) {
        Some(receiver) => match receiver.try_recv() {
            Ok(Ok(token)) => OAuthPoll {
                completed: true,
                token: Some(token),
                error: None,
            },
            Ok(Err(error)) => OAuthPoll {
                completed: true,
                token: None,
                error: Some(error),
            },
            Err(TryRecvError::Empty) => OAuthPoll {
                completed: false,
                token: None,
                error: None,
            },
            Err(TryRecvError::Disconnected) => OAuthPoll {
                completed: true,
                token: None,
                error: Some("Le flux OAuth a ete interrompu.".to_string()),
            },
        },
        None => OAuthPoll {
            completed: true,
            token: None,
            error: Some("Flux OAuth introuvable.".to_string()),
        },
    };

    if result.completed {
        flows.remove(&flow_id);
    }

    Ok(result)
}

#[tauri::command]
async fn refresh_google_token(request: RefreshTokenRequest) -> Result<GoogleTokenResponse, String> {
    run_blocking(move || refresh_google_token_inner(&request)).await
}

fn into_command_result<T>(result: AppResult<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}

async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || into_command_result(task()))
        .await
        .map_err(|error| format!("Tache interrompue: {error}"))?
}

fn default_true() -> bool {
    true
}

fn default_backup_retention() -> usize {
    5
}

fn default_drive_folder_name() -> String {
    "BackupQuest".to_string()
}

fn config_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(config_dir.join("config.json"))
}

fn read_config(app: &tauri::AppHandle) -> AppResult<AppConfig> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let content = fs::read_to_string(path)?;
    let mut config: AppConfig = serde_json::from_str(&content)?;
    if config.local_backup_dir.is_none() {
        config.local_backup_dir = default_backup_dir().map(path_to_string);
    }
    if config.backup_retention == 0 {
        config.backup_retention = default_backup_retention();
    }
    if config.google.drive_folder_name.trim().is_empty() {
        config.google.drive_folder_name = default_drive_folder_name();
    }
    Ok(config)
}

fn write_config(app: &tauri::AppHandle, config: &AppConfig) -> AppResult<()> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(config)?)?;
    Ok(())
}

fn default_backup_dir() -> Option<PathBuf> {
    dirs::document_dir()
        .or_else(dirs::data_local_dir)
        .map(|path| path.join("BackupQuest"))
}

fn detect_game_directories_inner() -> AppResult<Vec<CandidateGameDir>> {
    let mut candidates: Vec<(PathBuf, String)> = Vec::new();

    for key in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
        if let Some(base) = env::var_os(key) {
            candidates.push((
                PathBuf::from(base).join("World of Warcraft"),
                format!("Variable {key}"),
            ));
        }
    }

    for drive in 'C'..='Z' {
        let root = PathBuf::from(format!("{drive}:\\"));
        if root.exists() {
            candidates.push((root.join("World of Warcraft"), format!(" {drive}:")));
            candidates.push((
                root.join("Games").join("World of Warcraft"),
                format!("Dossier Games sur {drive}:"),
            ));
            candidates.push((
                root.join("Jeux").join("World of Warcraft"),
                format!("Dossier Jeux sur {drive}:"),
            ));
        }
    }

    let mut seen = HashSet::new();
    let mut detected = Vec::new();

    for (path, source) in candidates {
        let canonical_key = path.to_string_lossy().to_lowercase();
        if !seen.insert(canonical_key) || !path.exists() {
            continue;
        }

        let versions = list_game_versions_inner(&path).unwrap_or_default();
        if versions.is_empty() {
            continue;
        }

        detected.push(CandidateGameDir {
            path: path_to_string(path),
            source,
            versions_count: versions.len(),
        });
    }

    Ok(detected)
}

fn list_game_versions_inner(game_dir: &Path) -> AppResult<Vec<GameVersion>> {
    if !game_dir.exists() {
        return Ok(Vec::new());
    }

    let mut versions = Vec::new();
    for entry in fs::read_dir(game_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().to_string();
        if !is_wow_version_dir(&id, &path) {
            continue;
        }

        let interface_path = path.join("Interface");
        let wtf_path = path.join("WTF");
        let has_interface = interface_path.is_dir();
        let has_wtf = wtf_path.is_dir();
        let payload_dirs = version_payload_dirs(&path);
        let has_fonts = payload_dirs
            .iter()
            .any(|(name, _)| is_font_payload_name(name));
        let payload_paths = payload_dirs
            .iter()
            .map(|(_, path)| path.clone())
            .collect::<Vec<_>>();
        let (size_bytes, last_modified) = version_payload_info(&payload_paths);

        versions.push(GameVersion {
            name: display_version_name(&id),
            id,
            path: path_to_string(path),
            has_interface,
            has_wtf,
            has_fonts,
            size_bytes,
            last_modified: last_modified.map(format_system_time),
        });
    }

    versions.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(versions)
}

fn watch_game_directory_inner(
    app: tauri::AppHandle,
    runtime: State<'_, AppRuntime>,
    game_dir: Option<String>,
) -> AppResult<()> {
    let mut watcher_slot = runtime.game_dir_watcher.lock().map_err(|_| {
        AppError::Message("Impossible de modifier la surveillance WoW.".to_string())
    })?;
    *watcher_slot = None;

    let Some(game_dir) = game_dir else {
        return Ok(());
    };
    let game_dir = PathBuf::from(game_dir);
    if !game_dir.is_dir() {
        return Ok(());
    }

    let app_for_event = app.clone();
    let mut watcher = recommended_watcher(move |result: notify::Result<notify::Event>| {
        if result.is_ok() {
            let _ = app_for_event.emit("game-folders-changed", ());
        }
    })
    .map_err(|error| AppError::Message(format!("Surveillance WoW impossible: {error}")))?;

    watcher
        .watch(&game_dir, RecursiveMode::NonRecursive)
        .map_err(|error| {
            AppError::Message(format!("Surveillance du dossier WoW impossible: {error}"))
        })?;

    for version in list_game_versions_inner(&game_dir)? {
        let version_path = PathBuf::from(version.path);
        if version_path.is_dir() {
            let _ = watcher.watch(&version_path, RecursiveMode::NonRecursive);
        }
    }

    *watcher_slot = Some(watcher);
    Ok(())
}

fn is_wow_version_dir(id: &str, path: &Path) -> bool {
    let known = matches!(
        id,
        "_retail_"
            | "_classic_"
            | "_classic_era_"
            | "_classic_ptr_"
            | "_ptr_"
            | "_beta_"
            | "_xptr_"
            | "_classic_beta_"
    );

    known || (id.starts_with('_') && id.ends_with('_') && (!version_payload_dirs(path).is_empty()))
}

fn version_payload_dirs(version_path: &Path) -> Vec<(String, PathBuf)> {
    let mut payloads = Vec::new();
    let mut seen = HashSet::new();

    for name in ["Interface", "WTF", "Fonts", "Font", "font"] {
        let path = version_path.join(name);
        if !path.is_dir() {
            continue;
        }

        let key = path
            .canonicalize()
            .unwrap_or_else(|_| path.clone())
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        if seen.insert(key) {
            payloads.push((name.to_string(), path));
        }
    }

    payloads
}

fn is_font_payload_name(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), "fonts" | "font")
}

fn display_version_name(id: &str) -> String {
    match id {
        "_retail_" => "Retail".to_string(),
        "_classic_" => "Classic".to_string(),
        "_classic_era_" => "Classic Era".to_string(),
        "_classic_ptr_" => "Classic PTR".to_string(),
        "_ptr_" => "PTR".to_string(),
        "_xptr_" => "Retail PTR".to_string(),
        "_beta_" => "Beta".to_string(),
        "_classic_beta_" => "Classic Beta".to_string(),
        other => other
            .trim_matches('_')
            .split('_')
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn version_payload_info(paths: &[PathBuf]) -> (u64, Option<SystemTime>) {
    let mut size = 0;
    let mut latest = None;

    for root in paths {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    size += metadata.len();
                }
                if let Ok(modified) = metadata.modified() {
                    latest = Some(match latest {
                        Some(current) if current > modified => current,
                        _ => modified,
                    });
                }
            }
        }
    }

    (size, latest)
}

fn run_backup_inner(
    app: tauri::AppHandle,
    config: AppConfig,
    manual: bool,
) -> AppResult<BackupResult> {
    let game_dir = config
        .game_dir
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| {
            AppError::Message("Aucun dossier World of Warcraft configure.".to_string())
        })?;

    if !game_dir.is_dir() {
        return Err(AppError::Message(format!(
            "Le dossier WoW configure n'existe pas: {}",
            game_dir.display()
        )));
    }

    if config.selected_versions.is_empty() {
        return Err(AppError::Message(
            "Selectionne au moins une version de WoW a sauvegarder.".to_string(),
        ));
    }
    if !config.backup_local && !config.backup_cloud {
        return Err(AppError::Message(
            "Choisis au moins une destination: local, Google Drive, ou les deux.".to_string(),
        ));
    }

    let timestamp = Local::now();
    let local_archive_root = if config.backup_local {
        config
            .local_backup_dir
            .as_deref()
            .map(PathBuf::from)
            .or_else(default_backup_dir)
            .ok_or_else(|| {
                AppError::Message("Aucun dossier de backup local disponible.".to_string())
            })?
    } else {
        env::temp_dir().join("BackupQuest")
    };
    let status = if manual { "Manuel" } else { "Automatique" }.to_string();
    let mut last_archive = None;
    let mut total_files_count = 0;

    for version in &config.selected_versions {
        let archive_name = format!(
            "BackupQuest_{}_{}.zip",
            timestamp.format("%Y%m%d_%H%M%S"),
            compact_versions_label(&[version.clone()])
        );
        let version_archive_dir = local_archive_root.join(version);
        fs::create_dir_all(&version_archive_dir)?;
        cleanup_incomplete_local_backups(&version_archive_dir)?;

        let archive_path = version_archive_dir.join(&archive_name);
        let partial_archive_path = version_archive_dir.join(format!("{archive_name}.incomplete"));
        emit_backup_progress(&app, "Analyse des fichiers", 2, 0, 0);
        let files_count =
            match create_backup_zip(&app, &game_dir, &[version.clone()], &partial_archive_path) {
                Ok(files_count) => files_count,
                Err(error) => {
                    let _ = fs::remove_file(&partial_archive_path);
                    return Err(error);
                }
            };
        fs::rename(&partial_archive_path, &archive_path)?;
        let size_bytes = fs::metadata(&archive_path)?.len();
        let created_at = timestamp.to_rfc3339();

        let mut archive = BackupArchive {
            id: archive_name.clone(),
            name: archive_name.clone(),
            path: path_to_string(&archive_path),
            created_at,
            size_bytes,
            versions: vec![version.clone()],
            target: StorageTarget::Local,
            status: status.clone(),
        };

        if config.backup_cloud {
            emit_backup_progress(&app, "Upload Google Drive", 92, files_count, files_count);
            let drive_file =
                upload_drive_archive(&config.google, &archive_path, &archive_name, version)?;
            archive = BackupArchive {
                id: drive_file.id.clone(),
                name: archive_name,
                path: format!("gdrive://{}", drive_file.id),
                created_at: drive_file
                    .created_time
                    .or(drive_file.modified_time)
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                size_bytes,
                versions: vec![version.clone()],
                target: StorageTarget::GoogleDrive,
                status: if config.backup_local {
                    "Local + Drive".to_string()
                } else {
                    status.clone()
                },
            };
        }

        if config.backup_cloud && !config.backup_local {
            let _ = fs::remove_file(&archive_path);
        }

        total_files_count += files_count;
        last_archive = Some(archive);
    }

    let retention = config.backup_retention.max(1);
    if config.backup_local {
        prune_local_backups(config.local_backup_dir.clone(), retention)?;
    }
    if config.backup_cloud {
        prune_drive_backups(&config.google, retention)?;
    }

    let archive = last_archive
        .ok_or_else(|| AppError::Message("Aucune archive n'a ete creee.".to_string()))?;
    emit_backup_progress(&app, "Termine", 100, total_files_count, total_files_count);
    Ok(BackupResult {
        archive,
        message: format!("{total_files_count} fichiers sauvegardes."),
    })
}

fn is_selected_game_running_inner(config: &AppConfig) -> AppResult<bool> {
    let selected_paths = config
        .game_dir
        .as_deref()
        .map(PathBuf::from)
        .map(|game_dir| {
            config
                .selected_versions
                .iter()
                .map(|version| normalize_path_for_compare(game_dir.join(version)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let processes = running_wow_processes()?;
    if processes.is_empty() {
        return Ok(false);
    }

    if selected_paths.is_empty() {
        return Ok(true);
    }

    Ok(processes.into_iter().any(|process| {
        process
            .executable_path
            .as_deref()
            .map(|path| {
                let normalized = normalize_path_for_compare(path);
                selected_paths
                    .iter()
                    .any(|version_path| normalized.starts_with(version_path))
            })
            .unwrap_or(true)
    }))
}

#[cfg(windows)]
const WINDOWS_NOTIFICATION_APP_ID: &str = "com.weliseth.backupquest";

#[cfg(windows)]
fn send_system_notification_inner(
    app: &tauri::AppHandle,
    title: &str,
    body: &str,
) -> AppResult<()> {
    use tauri_winrt_notification::{IconCrop, Toast};
    use windows_registry::CURRENT_USER;

    let display_icon = windows_notification_display_icon();
    let key = CURRENT_USER
        .create(format!(
            r"SOFTWARE\Classes\AppUserModelId\{WINDOWS_NOTIFICATION_APP_ID}"
        ))
        .map_err(|error| AppError::Message(format!("Registre notification: {error}")))?;
    key.set_string("DisplayName", "BackupQuest")
        .map_err(|error| AppError::Message(format!("Nom notification: {error}")))?;
    key.set_string("IconBackgroundColor", "0")
        .map_err(|error| AppError::Message(format!("Fond icone notification: {error}")))?;
    key.set_hstring("IconUri", &display_icon.as_path().into())
        .map_err(|error| AppError::Message(format!("Icone notification: {error}")))?;

    let mut toast = Toast::new(WINDOWS_NOTIFICATION_APP_ID)
        .title(title)
        .text1(body);
    if let Some(toast_icon) = windows_notification_toast_icon(app) {
        toast = toast.icon(&toast_icon, IconCrop::Square, "BackupQuest");
    }
    toast
        .show()
        .map_err(|error| AppError::Message(format!("Notification Windows impossible: {error}")))?;
    Ok(())
}

#[cfg(not(windows))]
fn send_system_notification_inner(
    _app: &tauri::AppHandle,
    _title: &str,
    _body: &str,
) -> AppResult<()> {
    Ok(())
}

#[cfg(windows)]
fn windows_notification_display_icon() -> PathBuf {
    env::current_exe().unwrap_or_else(|_| PathBuf::from("BackupQuest.exe"))
}

#[cfg(windows)]
fn windows_notification_toast_icon(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dev_icon = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("icons")
        .join("icon.png");
    if dev_icon.is_file() {
        return Some(dev_icon);
    }

    app.path()
        .resource_dir()
        .ok()
        .map(|path| path.join("icons").join("icon.png"))
        .filter(|path| path.is_file())
}

#[derive(Debug)]
struct RunningWowProcess {
    executable_path: Option<String>,
}

fn running_wow_processes() -> AppResult<Vec<RunningWowProcess>> {
    #[cfg(windows)]
    {
        let script = r#"
$names = @('Wow.exe','WowClassic.exe','WowClassicT.exe','WowB.exe')
Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name } | ForEach-Object {
  if ($_.ExecutablePath) { $_.ExecutablePath } else { $_.Name }
}
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output()?;

        if !output.status.success() {
            return Err(AppError::Message(
                "Detection du processus World of Warcraft impossible.".to_string(),
            ));
        }

        let text = String::from_utf8_lossy(&output.stdout);
        Ok(text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|line| RunningWowProcess {
                executable_path: if line.contains('\\') || line.contains('/') {
                    Some(line.to_string())
                } else {
                    None
                },
            })
            .collect())
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

fn normalize_path_for_compare(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase()
}

fn create_backup_zip(
    app: &tauri::AppHandle,
    game_dir: &Path,
    versions: &[String],
    archive_path: &Path,
) -> AppResult<u64> {
    let file = File::create(archive_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let dir_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o755);
    let mut files_count = 0;
    let total_files = count_backup_files(game_dir, versions)?;
    emit_backup_progress(app, "Compression", 5, 0, total_files);

    for version in versions {
        let version_path = game_dir.join(version);
        if !version_path.is_dir() {
            return Err(AppError::Message(format!(
                "Version introuvable dans le dossier WoW: {version}"
            )));
        }

        let payload_dirs = version_payload_dirs(&version_path);
        let mut found_payload = false;
        for (payload_dir, source) in &payload_dirs {
            found_payload = true;
            let zip_root = format!("{version}/{payload_dir}");
            zip.add_directory(format!("{zip_root}/"), dir_options)?;

            for entry in WalkDir::new(source).into_iter().filter_map(Result::ok) {
                let path = entry.path();
                let relative = path
                    .strip_prefix(source)
                    .map_err(|error| AppError::Message(error.to_string()))?;
                if relative.as_os_str().is_empty() {
                    continue;
                }

                let zip_name = format!(
                    "{}/{}",
                    zip_root,
                    relative.to_string_lossy().replace('\\', "/")
                );

                if entry.file_type().is_dir() {
                    zip.add_directory(format!("{zip_name}/"), dir_options)?;
                } else {
                    zip.start_file(zip_name, options)?;
                    let mut input = File::open(path)?;
                    io::copy(&mut input, &mut zip)?;
                    files_count += 1;
                    if files_count == total_files || files_count % 10 == 0 {
                        let percent = backup_zip_percent(files_count, total_files);
                        emit_backup_progress(app, "Compression", percent, files_count, total_files);
                    }
                }
            }
        }

        if !found_payload {
            return Err(AppError::Message(format!(
                "{version} ne contient aucun dossier Interface, WTF ou Fonts."
            )));
        }
    }

    zip.finish()?;
    emit_backup_progress(app, "Finalisation", 90, files_count, total_files);
    Ok(files_count)
}

fn count_backup_files(game_dir: &Path, versions: &[String]) -> AppResult<u64> {
    let mut total = 0;

    for version in versions {
        let version_path = game_dir.join(version);
        if !version_path.is_dir() {
            return Err(AppError::Message(format!(
                "Version introuvable dans le dossier WoW: {version}"
            )));
        }

        let payload_dirs = version_payload_dirs(&version_path);
        let mut found_payload = false;
        for (_, source) in payload_dirs {
            found_payload = true;
            total += WalkDir::new(source)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_file())
                .count() as u64;
        }

        if !found_payload {
            return Err(AppError::Message(format!(
                "{version} ne contient aucun dossier Interface, WTF ou Fonts."
            )));
        }
    }

    Ok(total)
}

fn backup_zip_percent(processed_files: u64, total_files: u64) -> u8 {
    if total_files == 0 {
        return 90;
    }
    let ratio = processed_files as f64 / total_files as f64;
    (5.0 + ratio * 85.0).round().clamp(5.0, 90.0) as u8
}

fn emit_backup_progress(
    app: &tauri::AppHandle,
    phase: impl Into<String>,
    percent: u8,
    processed_files: u64,
    total_files: u64,
) {
    let _ = app.emit(
        "backup-progress",
        BackupProgress {
            phase: phase.into(),
            percent: percent.min(100),
            processed_files,
            total_files,
        },
    );
}

fn emit_restore_progress(
    app: &tauri::AppHandle,
    phase: impl Into<String>,
    percent: u8,
    processed_files: u64,
    total_files: u64,
) {
    let _ = app.emit(
        "restore-progress",
        BackupProgress {
            phase: phase.into(),
            percent: percent.min(100),
            processed_files,
            total_files,
        },
    );
}

fn upload_drive_archive(
    google: &GoogleDriveConfig,
    archive_path: &Path,
    archive_name: &str,
    version: &str,
) -> AppResult<DriveFile> {
    let token = google_access_token(google)?;
    let root_folder_id = ensure_drive_folder(google, token)?;
    let folder_id = ensure_drive_child_folder(token, &root_folder_id, version)?;
    let boundary = format!("backupquest-{}", Uuid::new_v4());
    let metadata = serde_json::json!({
        "name": archive_name,
        "parents": [folder_id],
        "mimeType": "application/zip"
    })
    .to_string();
    let bytes = fs::read(archive_path)?;
    let mut body = Vec::new();
    write!(
        body,
        "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/zip\r\n\r\n"
    )?;
    body.extend_from_slice(&bytes);
    write!(body, "\r\n--{boundary}--\r\n")?;

    let response = reqwest::blocking::Client::new()
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime")
        .bearer_auth(token)
        .header("Content-Type", format!("multipart/related; boundary={boundary}"))
        .body(body)
        .send()?;

    if response.status().is_success() {
        Ok(response.json()?)
    } else {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        Err(AppError::Message(format!(
            "Upload Google Drive refuse ({status}): {body}"
        )))
    }
}

fn google_access_token(google: &GoogleDriveConfig) -> AppResult<&str> {
    google
        .access_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::Message("Connecte Google Drive via OAuth2 avant de continuer.".to_string())
        })
}

fn list_backups_inner(local_backup_dir: Option<String>) -> AppResult<Vec<BackupArchive>> {
    let backup_dir = local_backup_dir
        .as_deref()
        .map(PathBuf::from)
        .or_else(default_backup_dir)
        .ok_or_else(|| {
            AppError::Message("Aucun dossier de backup local disponible.".to_string())
        })?;

    if !backup_dir.is_dir() {
        return Ok(Vec::new());
    }
    cleanup_incomplete_local_backups(&backup_dir)?;

    let mut backups = collect_local_backups_from_dir(&backup_dir, None)?;
    for entry in fs::read_dir(&backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            cleanup_incomplete_local_backups(&path)?;
            let version = entry.file_name().to_string_lossy().to_string();
            backups.extend(collect_local_backups_from_dir(&path, Some(&version))?);
        }
    }

    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

fn collect_local_backups_from_dir(
    backup_dir: &Path,
    folder_version: Option<&str>,
) -> AppResult<Vec<BackupArchive>> {
    let mut backups = Vec::new();
    for entry in fs::read_dir(backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
            continue;
        }

        let metadata = fs::metadata(&path)?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let created_at = metadata
            .created()
            .or_else(|_| metadata.modified())
            .map(format_system_time)
            .unwrap_or_else(|_| Utc::now().to_rfc3339());

        let versions = match archive_versions(&path) {
            Ok(versions) if !versions.is_empty() => versions,
            Ok(_) => folder_version
                .map(|version| vec![version.to_string()])
                .unwrap_or_default(),
            Err(_) if is_backupquest_zip(&path) => {
                let _ = fs::remove_file(&path);
                continue;
            }
            Err(error) => return Err(error),
        };

        backups.push(BackupArchive {
            id: file_name.clone(),
            name: file_name,
            path: path_to_string(&path),
            created_at,
            size_bytes: metadata.len(),
            versions,
            target: StorageTarget::Local,
            status: "Disponible".to_string(),
        });
    }
    Ok(backups)
}

fn cleanup_incomplete_local_backups(backup_dir: &Path) -> AppResult<()> {
    if !backup_dir.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && is_incomplete_backup_path(&path) {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn is_incomplete_backup_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("BackupQuest_") && name.ends_with(".zip.incomplete"))
}

fn is_backupquest_zip(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("BackupQuest_") && name.ends_with(".zip"))
}

fn prune_local_backups(local_backup_dir: Option<String>, retention: usize) -> AppResult<()> {
    let backups = list_backups_inner(local_backup_dir)?;
    let mut by_version: HashMap<String, Vec<BackupArchive>> = HashMap::new();
    for backup in backups {
        for version in &backup.versions {
            by_version
                .entry(version.clone())
                .or_default()
                .push(backup.clone());
        }
    }

    let mut removed = HashSet::new();
    for mut version_backups in by_version.into_values() {
        version_backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        for backup in version_backups.into_iter().skip(retention) {
            if !removed.insert(backup.path.clone()) {
                continue;
            }
            let archive_path = PathBuf::from(&backup.path);
            if archive_path.extension().and_then(|ext| ext.to_str()) == Some("zip")
                && archive_path.is_file()
            {
                fs::remove_file(archive_path)?;
            }
        }
    }
    Ok(())
}

fn ensure_drive_folder(google: &GoogleDriveConfig, token: &str) -> AppResult<String> {
    let folder_name = google.drive_folder_name.trim();
    if folder_name.is_empty() {
        return Err(AppError::Message(
            "Renseigne le nom du dossier Google Drive.".to_string(),
        ));
    }

    let escaped_name = folder_name.replace('\\', "\\\\").replace('\'', "\\'");
    let query = format!(
        "name='{escaped_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&spaces=drive&fields=files(id,name)",
        urlencoding::encode(&query)
    );
    let client = reqwest::blocking::Client::new();
    let response = client.get(url).bearer_auth(token).send()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(AppError::Message(format!(
            "Recherche du dossier Google Drive refusee ({status}): {body}"
        )));
    }

    let list: DriveFileList = response.json()?;
    if let Some(folder) = list.files.into_iter().next() {
        return Ok(folder.id);
    }

    let response = client
        .post("https://www.googleapis.com/drive/v3/files?fields=id,name")
        .bearer_auth(token)
        .json(&serde_json::json!({
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder"
        }))
        .send()?;

    if response.status().is_success() {
        let folder: DriveFile = response.json()?;
        Ok(folder.id)
    } else {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        Err(AppError::Message(format!(
            "Creation du dossier Google Drive refusee ({status}): {body}"
        )))
    }
}

fn ensure_drive_child_folder(token: &str, parent_id: &str, folder_name: &str) -> AppResult<String> {
    let escaped_name = folder_name.replace('\\', "\\\\").replace('\'', "\\'");
    let query = format!(
        "'{parent_id}' in parents and name='{escaped_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&spaces=drive&fields=files(id,name,mimeType)",
        urlencoding::encode(&query)
    );
    let client = reqwest::blocking::Client::new();
    let response = client.get(url).bearer_auth(token).send()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(AppError::Message(format!(
            "Recherche du dossier de version Google Drive refusee ({status}): {body}"
        )));
    }

    let list: DriveFileList = response.json()?;
    if let Some(folder) = list.files.into_iter().next() {
        return Ok(folder.id);
    }

    let response = client
        .post("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType")
        .bearer_auth(token)
        .json(&serde_json::json!({
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id]
        }))
        .send()?;

    if response.status().is_success() {
        let folder: DriveFile = response.json()?;
        Ok(folder.id)
    } else {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        Err(AppError::Message(format!(
            "Creation du dossier de version Google Drive refusee ({status}): {body}"
        )))
    }
}

fn list_drive_backups_inner(google: &GoogleDriveConfig) -> AppResult<Vec<BackupArchive>> {
    let token = google_access_token(google)?;
    let folder_id = ensure_drive_folder(google, token)?;

    let query = format!("'{folder_id}' in parents and trashed=false");
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&spaces=drive&fields=files(id,name,mimeType,size,createdTime,modifiedTime)",
        urlencoding::encode(&query)
    );
    let response = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(AppError::Message(format!(
            "Lecture Google Drive refusee ({status}): {body}"
        )));
    }

    let payload: DriveFileList = response.json()?;
    let mut backups = Vec::new();
    for file in payload.files {
        if file.mime_type.as_deref() == Some("application/vnd.google-apps.folder") {
            backups.extend(list_drive_backups_in_folder(
                token,
                &file.id,
                Some(&file.name),
            )?);
        } else if file.name.ends_with(".zip") {
            backups.push(drive_file_to_backup(file, None));
        }
    }

    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

fn list_drive_backups_in_folder(
    token: &str,
    folder_id: &str,
    version: Option<&str>,
) -> AppResult<Vec<BackupArchive>> {
    let query = format!("'{folder_id}' in parents and trashed=false");
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&spaces=drive&fields=files(id,name,mimeType,size,createdTime,modifiedTime)",
        urlencoding::encode(&query)
    );
    let response = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(AppError::Message(format!(
            "Lecture Google Drive refusee ({status}): {body}"
        )));
    }

    let payload: DriveFileList = response.json()?;
    Ok(payload
        .files
        .into_iter()
        .filter(|file| file.name.ends_with(".zip"))
        .map(|file| drive_file_to_backup(file, version))
        .collect())
}

fn drive_file_to_backup(file: DriveFile, version: Option<&str>) -> BackupArchive {
    BackupArchive {
        id: file.id.clone(),
        name: file.name,
        path: format!("gdrive://{}", file.id),
        created_at: file
            .created_time
            .or(file.modified_time)
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        size_bytes: file
            .size
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or_default(),
        versions: version
            .map(|value| vec![value.to_string()])
            .unwrap_or_default(),
        target: StorageTarget::GoogleDrive,
        status: "Drive".to_string(),
    }
}

fn prune_drive_backups(google: &GoogleDriveConfig, retention: usize) -> AppResult<()> {
    let backups = list_drive_backups_inner(google)?;
    let mut by_version: HashMap<String, Vec<BackupArchive>> = HashMap::new();
    for backup in backups {
        for version in &backup.versions {
            by_version
                .entry(version.clone())
                .or_default()
                .push(backup.clone());
        }
    }

    let mut removed = HashSet::new();
    for mut version_backups in by_version.into_values() {
        version_backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        for backup in version_backups.into_iter().skip(retention) {
            if removed.insert(backup.path.clone()) {
                delete_drive_archive(google, &backup.path)?;
            }
        }
    }
    Ok(())
}

fn archive_versions(path: &Path) -> AppResult<Vec<String>> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut versions = HashSet::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        let Some(enclosed) = file.enclosed_name() else {
            continue;
        };
        if let Some(Component::Normal(version)) = enclosed.components().next() {
            versions.insert(version.to_string_lossy().to_string());
        }
    }

    let mut versions = versions.into_iter().collect::<Vec<_>>();
    versions.sort();
    Ok(versions)
}

fn restore_backup_inner(app: tauri::AppHandle, request: RestoreRequest) -> AppResult<String> {
    let mut downloaded_archive = None;
    let archive_path = if request.archive_path.starts_with("gdrive://") {
        emit_restore_progress(&app, "Telechargement Google Drive", 3, 0, 0);
        let google = request.google.as_ref().ok_or_else(|| {
            AppError::Message(
                "Configuration Google Drive absente pour cette restauration.".to_string(),
            )
        })?;
        let path = download_drive_archive(google, &request.archive_path)?;
        downloaded_archive = Some(path.clone());
        path
    } else {
        PathBuf::from(&request.archive_path)
    };
    let game_dir = PathBuf::from(&request.game_dir);
    if !archive_path.is_file() {
        return Err(AppError::Message(
            "Archive de backup introuvable.".to_string(),
        ));
    }
    if !game_dir.is_dir() {
        return Err(AppError::Message(
            "Dossier World of Warcraft introuvable.".to_string(),
        ));
    }

    let selected_versions = request.versions.into_iter().collect::<HashSet<_>>();
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;
    let total_files = count_restore_files(&mut archive, &selected_versions)?;
    let mut restored_files = 0;
    emit_restore_progress(&app, "Extraction", 5, 0, total_files);

    for index in 0..archive.len() {
        let mut zipped = archive.by_index(index)?;
        let Some(enclosed) = zipped.enclosed_name().map(PathBuf::from) else {
            continue;
        };

        if !is_restore_entry_allowed(&enclosed, &selected_versions) {
            continue;
        }

        let destination = game_dir.join(&enclosed);
        if zipped.is_dir() {
            fs::create_dir_all(destination)?;
            continue;
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = File::create(destination)?;
        io::copy(&mut zipped, &mut output)?;
        restored_files += 1;
        if restored_files == total_files || restored_files % 10 == 0 {
            emit_restore_progress(
                &app,
                "Extraction",
                restore_percent(restored_files, total_files),
                restored_files,
                total_files,
            );
        }
    }

    if let Some(path) = downloaded_archive {
        let _ = fs::remove_file(path);
    }

    emit_restore_progress(
        &app,
        "Restauration terminee",
        100,
        restored_files,
        total_files,
    );
    Ok(format!("{restored_files} fichiers restaures."))
}

fn count_restore_files(
    archive: &mut ZipArchive<File>,
    selected_versions: &HashSet<String>,
) -> AppResult<u64> {
    let mut total = 0;
    for index in 0..archive.len() {
        let zipped = archive.by_index(index)?;
        let Some(enclosed) = zipped.enclosed_name().map(PathBuf::from) else {
            continue;
        };
        if !zipped.is_dir() && is_restore_entry_allowed(&enclosed, selected_versions) {
            total += 1;
        }
    }
    Ok(total)
}

fn restore_percent(processed_files: u64, total_files: u64) -> u8 {
    if total_files == 0 {
        return 100;
    }
    let ratio = processed_files as f64 / total_files as f64;
    (5.0 + ratio * 95.0).round().clamp(5.0, 100.0) as u8
}

fn delete_backup_inner(request: DeleteBackupRequest) -> AppResult<String> {
    if request.archive_path.starts_with("gdrive://") {
        let google = request.google.as_ref().ok_or_else(|| {
            AppError::Message(
                "Configuration Google Drive absente pour cette suppression.".to_string(),
            )
        })?;
        delete_drive_archive(google, &request.archive_path)?;
        return Ok("Backup Google Drive supprime.".to_string());
    }

    let archive_path = PathBuf::from(&request.archive_path);
    if archive_path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
        return Err(AppError::Message(
            "Seules les archives ZIP peuvent etre supprimees.".to_string(),
        ));
    }
    if !archive_path.is_file() {
        return Err(AppError::Message(
            "Archive de backup introuvable.".to_string(),
        ));
    }

    fs::remove_file(archive_path)?;
    Ok("Backup local supprime.".to_string())
}

fn download_drive_archive(google: &GoogleDriveConfig, drive_path: &str) -> AppResult<PathBuf> {
    let file_id = parse_drive_path(drive_path)?;
    let token = google_access_token(google)?;
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?alt=media",
        urlencoding::encode(&file_id)
    );
    let response = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(AppError::Message(format!(
            "Telechargement Google Drive refuse ({status}): {body}"
        )));
    }

    let temp_dir = env::temp_dir().join("BackupQuest");
    fs::create_dir_all(&temp_dir)?;
    let temp_path = temp_dir.join(format!("restore-{}-backupquest-drive.zip", Uuid::new_v4()));
    fs::write(&temp_path, response.bytes()?)?;
    Ok(temp_path)
}

fn delete_drive_archive(google: &GoogleDriveConfig, drive_path: &str) -> AppResult<()> {
    let file_id = parse_drive_path(drive_path)?;
    let token = google_access_token(google)?;
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}",
        urlencoding::encode(&file_id)
    );
    let response = reqwest::blocking::Client::new()
        .delete(url)
        .bearer_auth(token)
        .send()?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        Err(AppError::Message(format!(
            "Suppression Google Drive refusee ({status}): {body}"
        )))
    }
}

fn parse_drive_path(drive_path: &str) -> AppResult<String> {
    let file_id = drive_path
        .strip_prefix("gdrive://")
        .ok_or_else(|| AppError::Message("Chemin Google Drive invalide.".to_string()))?;
    if file_id.is_empty() {
        return Err(AppError::Message(
            "Chemin Google Drive incomplet.".to_string(),
        ));
    }
    Ok(file_id.to_string())
}

fn is_restore_entry_allowed(path: &Path, selected_versions: &HashSet<String>) -> bool {
    let mut components = path.components();
    let version = match components.next() {
        Some(Component::Normal(value)) => value.to_string_lossy().to_string(),
        _ => return false,
    };
    let payload = match components.next() {
        Some(Component::Normal(value)) => value.to_string_lossy().to_string(),
        _ => return false,
    };

    (selected_versions.is_empty() || selected_versions.contains(&version))
        && matches!(
            payload.to_ascii_lowercase().as_str(),
            "interface" | "wtf" | "fonts" | "font"
        )
}

fn start_google_oauth_inner(runtime: State<'_, AppRuntime>) -> AppResult<OAuthFlow> {
    let credentials = google_oauth_credentials()?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let flow_id = Uuid::new_v4().to_string();
    let csrf_state = Uuid::new_v4().to_string();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth2/callback");
    let scope = "https://www.googleapis.com/auth/drive.file";
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={}&redirect_uri={}&scope={}&access_type=offline&prompt=consent&state={}",
        urlencoding::encode(credentials.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
        urlencoding::encode(&csrf_state)
    );

    let (sender, receiver) = mpsc::channel();
    runtime
        .oauth_flows
        .lock()
        .map_err(|_| AppError::Message("Impossible de preparer le flux OAuth.".to_string()))?
        .insert(flow_id.clone(), receiver);

    let callback_redirect_uri = redirect_uri.clone();
    thread::spawn(move || {
        let result =
            wait_for_google_callback(listener, credentials, callback_redirect_uri, csrf_state);
        let _ = sender.send(result.map_err(|error| error.to_string()));
    });

    Ok(OAuthFlow {
        flow_id,
        auth_url,
        redirect_uri,
    })
}

fn wait_for_google_callback(
    listener: TcpListener,
    credentials: GoogleOAuthCredentials,
    redirect_uri: String,
    csrf_state: String,
) -> AppResult<GoogleTokenResponse> {
    listener.set_nonblocking(true)?;
    let started = Instant::now();

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let callback_result =
                    handle_oauth_callback(&mut stream, credentials, &redirect_uri, &csrf_state);
                write_oauth_response(&mut stream, callback_result.is_ok())?;
                return callback_result;
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if started.elapsed() > Duration::from_secs(300) {
                    return Err(AppError::Message(
                        "Le flux OAuth a expire apres 5 minutes.".to_string(),
                    ));
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(error) => return Err(AppError::Io(error)),
        }
    }
}

fn handle_oauth_callback(
    stream: &mut TcpStream,
    credentials: GoogleOAuthCredentials,
    redirect_uri: &str,
    csrf_state: &str,
) -> AppResult<GoogleTokenResponse> {
    let mut buffer = [0; 8192];
    let read = stream.read(&mut buffer)?;
    let request_text = String::from_utf8_lossy(&buffer[..read]);
    let first_line = request_text
        .lines()
        .next()
        .ok_or_else(|| AppError::Message("Reponse OAuth invalide.".to_string()))?;
    let path = first_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| AppError::Message("Callback OAuth invalide.".to_string()))?;
    let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
    let params = parse_query(query);

    if params.get("state") != Some(&csrf_state.to_string()) {
        return Err(AppError::Message("Etat OAuth invalide.".to_string()));
    }
    if let Some(error) = params.get("error") {
        return Err(AppError::Message(format!(
            "Google a refuse l'autorisation: {error}"
        )));
    }

    let code = params
        .get("code")
        .ok_or_else(|| AppError::Message("Code OAuth absent.".to_string()))?;
    exchange_google_code(credentials, redirect_uri, code)
}

fn write_oauth_response(stream: &mut TcpStream, success: bool) -> AppResult<()> {
    let (title, body) = if success {
        (
            "BackupQuest est connecte",
            "Tu peux revenir dans l'application.",
        )
    } else {
        (
            "Connexion BackupQuest impossible",
            "Reviens dans l'application pour voir le detail.",
        )
    };
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head><body style=\"font-family:system-ui;margin:48px;background:#f7f3ec;color:#16130f\"><h1>{title}</h1><p>{body}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes())?;
    Ok(())
}

fn exchange_google_code(
    credentials: GoogleOAuthCredentials,
    redirect_uri: &str,
    code: &str,
) -> AppResult<GoogleTokenResponse> {
    let response = reqwest::blocking::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code),
            ("client_id", credentials.client_id),
            ("client_secret", credentials.client_secret),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()?;
    parse_google_token_response(response)
}

fn refresh_google_token_inner(request: &RefreshTokenRequest) -> AppResult<GoogleTokenResponse> {
    let credentials = google_oauth_credentials()?;
    let response = reqwest::blocking::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", credentials.client_id),
            ("client_secret", credentials.client_secret),
            ("refresh_token", request.refresh_token.trim()),
            ("grant_type", "refresh_token"),
        ])
        .send()?;
    parse_google_token_response(response)
}

fn google_oauth_credentials() -> AppResult<GoogleOAuthCredentials> {
    let client_id = option_env!("BACKUPQUEST_GOOGLE_CLIENT_ID")
        .unwrap_or("")
        .trim();
    let client_secret = option_env!("BACKUPQUEST_GOOGLE_CLIENT_SECRET")
        .unwrap_or("")
        .trim();

    if client_id.is_empty() || client_secret.is_empty() {
        return Err(AppError::Message(
            "Identifiants Google OAuth2 absents. Cree un fichier .env avec BACKUPQUEST_GOOGLE_CLIENT_ID et BACKUPQUEST_GOOGLE_CLIENT_SECRET, puis recompile l'application.".to_string(),
        ));
    }

    Ok(GoogleOAuthCredentials {
        client_id,
        client_secret,
    })
}

fn parse_google_token_response(
    response: reqwest::blocking::Response,
) -> AppResult<GoogleTokenResponse> {
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(AppError::Message(format!(
            "Google OAuth a retourne {status}: {body}"
        )));
    }

    let raw: GoogleTokenRaw = response.json()?;
    Ok(GoogleTokenResponse {
        access_token: raw.access_token,
        refresh_token: raw.refresh_token,
        token_type: raw.token_type,
        expires_in: raw.expires_in,
        expires_at: (Utc::now() + chrono::Duration::seconds(raw.expires_in as i64)).to_rfc3339(),
    })
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            let key = urlencoding::decode(key).ok()?.into_owned();
            let value = urlencoding::decode(value).ok()?.into_owned();
            Some((key, value))
        })
        .collect()
}

fn compact_versions_label(versions: &[String]) -> String {
    let label = versions
        .iter()
        .map(|version| version.trim_matches('_'))
        .filter(|version| !version.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if label.is_empty() {
        "wow".to_string()
    } else {
        label
    }
}

fn format_system_time(time: SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339()
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Ouvrir BackupQuest", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("BackupQuest")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn should_close_to_tray(app: &tauri::AppHandle) -> bool {
    read_config(app)
        .map(|config| config.close_to_tray)
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppRuntime {
            oauth_flows: Mutex::new(HashMap::new()),
            game_dir_watcher: Mutex::new(None),
        })
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("BackupQuest")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if should_close_to_tray(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            set_autostart_enabled,
            is_autostart_enabled,
            detect_game_directories,
            list_game_versions,
            watch_game_directory,
            is_selected_game_running,
            send_system_notification,
            run_backup,
            list_backups,
            list_drive_backups,
            delete_backup,
            restore_backup,
            start_google_oauth,
            poll_google_oauth,
            refresh_google_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
