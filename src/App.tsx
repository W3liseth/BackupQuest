import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkUpdate, type Update } from "@tauri-apps/plugin-updater";
import {
  Archive,
  Check,
  ChevronRight,
  Cloud,
  FolderOpen,
  Gauge,
  HardDrive,
  History,
  Home,
  Loader2,
  Minus,
  Play,
  Radio,
  RotateCcw,
  Settings,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackupView } from "./Backup";
import { OptionsView } from "./Options";
import { RestoreView } from "./Restore";
import appIconUrl from "../src-tauri/icons/icon.png";
import type {
  ActivityItem,
  ActivityKind,
  AppConfig,
  BackupArchive,
  BackupProgress,
  BackupResult,
  CandidateGameDir,
  GameVersion,
  GoogleDriveConfig,
  GoogleTokenResponse,
  OAuthFlow,
  OAuthPoll,
  UpdateState,
  View,
  WowProcessStatus,
} from "./types";
import {
  EmptyState,
  destinationLabel,
  formatBytes,
  formatDate,
  scheduleSummary,
  StatusPill,
} from "./viewShared";
import "./App.css";

const EMPTY_CONFIG: AppConfig = {
  gameDir: null,
  selectedVersions: [],
  backupLocal: true,
  backupCloud: false,
  storageTarget: "local",
  localBackupDir: null,
  backupRetention: 5,
  cronEnabled: false,
  cronExpression: "0 20 * * *",
  startOnLogin: false,
  closeToTray: true,
  autoCheckUpdates: true,
  google: {
    clientId: "",
    clientSecret: "",
    driveFolderName: "BackupQuest",
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
  },
};

const navigation = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "backup", label: "Backup", icon: Archive },
  { id: "restore", label: "Restauration", icon: RotateCcw },
  { id: "options", label: "Options", icon: Settings },
] satisfies Array<{ id: View; label: string; icon: typeof Home }>;

function App() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
  const [versions, setVersions] = useState<GameVersion[]>([]);
  const [candidates, setCandidates] = useState<CandidateGameDir[]>([]);
  const [backups, setBackups] = useState<BackupArchive[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [runningBackup, setRunningBackup] = useState(false);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<BackupProgress | null>(null);
  const [deletingBackupPath, setDeletingBackupPath] = useState("");
  const [selectedRestore, setSelectedRestore] = useState<string>("");
  const [restoreVersions, setRestoreVersions] = useState<string[]>([]);
  const [wowProcessStatus, setWowProcessStatus] = useState<WowProcessStatus>({
    running: false,
    processes: [],
  });
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string>("");
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: "idle",
    message: "Verifie les releases GitHub de BackupQuest.",
    body: null,
    downloadedBytes: 0,
    contentLength: null,
  });
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const configRef = useRef<AppConfig>(EMPTY_CONFIG);
  const runningBackupRef = useRef(false);
  const updateBusyRef = useRef(false);
  const startupUpdateCheckedRef = useRef(false);
  const lastCronKeyRef = useRef("");
  const pendingAutoBackupRef = useRef(false);
  const pendingGameClosedAtRef = useRef<number | null>(null);
  const schedulerBusyRef = useRef(false);
  const versionRefreshBusyRef = useRef(false);
  const versionRefreshTimeoutRef = useRef<number | null>(null);

  const selectedVersions = useMemo(
    () =>
      versions.filter((version) =>
        config.selectedVersions.includes(version.id),
      ),
    [config.selectedVersions, versions],
  );

  const selectedVersionLabels = useMemo(
    () =>
      selectedVersions.length > 0
        ? selectedVersions.map((version) => version.name).join(", ")
        : "Aucune version",
    [selectedVersions],
  );

  const selectedBackup = useMemo(
    () => backups.find((backup) => backup.path === selectedRestore),
    [backups, selectedRestore],
  );

  const pushActivity = useCallback(
    (kind: ActivityKind, title: string, detail: string) => {
      setActivities((current) => [
        {
          id: crypto.randomUUID(),
          kind,
          title,
          detail,
          timestamp: new Date(),
        },
        ...current,
      ].slice(0, 10));
    },
    [],
  );

  const checkForUpdates = useCallback(
    async (source: "startup" | "manual" | "automatic" = "manual") => {
      if (updateBusyRef.current) {
        return;
      }

      updateBusyRef.current = true;
      setPendingUpdate(null);
      setUpdateState({
        status: "checking",
        message:
          source === "startup"
            ? "Verification obligatoire des mises a jour au demarrage..."
            : "Recherche d'une nouvelle release GitHub...",
        body: null,
        downloadedBytes: 0,
        contentLength: null,
      });

      try {
        const update = await checkUpdate({ timeout: 30_000 });
        if (!update) {
          setUpdateState({
            status: "none",
            message: "BackupQuest est deja a jour.",
            body: null,
            downloadedBytes: 0,
            contentLength: null,
          });
          if (source === "manual") {
            pushActivity("success", "BackupQuest a jour", "Aucune nouvelle release disponible.");
          }
          return;
        }

        setPendingUpdate(update);
        setUpdateState({
          status: "available",
          message: `Version ${update.version} disponible.`,
          body: update.body,
          downloadedBytes: 0,
          contentLength: null,
        });
        pushActivity(
          "info",
          "Mise a jour disponible",
          `La version ${update.version} peut etre installee depuis Options.`,
        );
      } catch (error) {
        const message = toUpdaterError(error);
        setUpdateState({
          status: "error",
          message,
          body: null,
          downloadedBytes: 0,
          contentLength: null,
        });
        pushActivity("warning", "Verification des mises a jour impossible", message);
      } finally {
        updateBusyRef.current = false;
      }
    },
    [pushActivity],
  );

  const installUpdate = useCallback(async () => {
    if (!pendingUpdate || updateBusyRef.current) {
      return;
    }

    updateBusyRef.current = true;
    let downloaded = 0;
    setUpdateState((current) => ({
      ...current,
      status: "downloading",
      message: `Telechargement de la version ${pendingUpdate.version}...`,
      downloadedBytes: 0,
      contentLength: null,
    }));

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          downloaded = 0;
          setUpdateState((current) => ({
            ...current,
            downloadedBytes: 0,
            contentLength: event.data.contentLength ?? null,
          }));
          return;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateState((current) => ({
            ...current,
            downloadedBytes: downloaded,
          }));
          return;
        }

        setUpdateState((current) => ({
          ...current,
          status: "installed",
          message: "Mise a jour installee. Redemarrage de BackupQuest...",
        }));
      });

      setUpdateState((current) => ({
        ...current,
        status: "installed",
        message: "Mise a jour installee. Redemarrage de BackupQuest...",
      }));
      pushActivity("success", "Mise a jour installee", "BackupQuest va redemarrer.");
      await relaunch();
    } catch (error) {
      const message = toUpdaterError(error);
      setUpdateState((current) => ({
        ...current,
        status: "error",
        message,
      }));
      pushActivity("error", "Installation de la mise a jour impossible", message);
    } finally {
      updateBusyRef.current = false;
    }
  }, [pendingUpdate, pushActivity]);

  const persistConfig = useCallback(
    async (nextConfig: AppConfig) => {
      setConfig(nextConfig);
      configRef.current = nextConfig;
      await invoke<AppConfig>("save_config", { config: nextConfig });
    },
    [],
  );

  const loadBackups = useCallback(async (backupDir?: string | null, google?: GoogleDriveConfig | null) => {
    const localBackups = await invoke<BackupArchive[]>("list_backups", {
      localBackupDir: backupDir ?? null,
    });

    let cloudBackups: BackupArchive[] = [];
    if ((google?.accessToken || google?.refreshToken) && google.driveFolderName) {
      try {
        let googleConfig = await ensureFreshGoogleToken({
          ...configRef.current,
          google,
        });
        try {
          cloudBackups = await invoke<BackupArchive[]>("list_drive_backups", {
            google: googleConfig.google,
          });
        } catch (error) {
          if (!google.refreshToken || !isGoogleUnauthorizedError(error)) {
            pushActivity("warning", "Archives Google non chargees", toErrorMessage(error));
          } else {
            try {
              googleConfig = await ensureFreshGoogleToken(googleConfig, true);
              cloudBackups = await invoke<BackupArchive[]>("list_drive_backups", {
                google: googleConfig.google,
              });
            } catch (retryError) {
              pushActivity(
                "warning",
                "Google Drive a reconnecter",
                "La session Google Drive a expire. Deconnecte puis reconnecte le compte depuis Options.",
              );
              console.warn(retryError);
            }
          }
        }
      } catch (error) {
        if (isGoogleAuthError(error)) {
          pushActivity(
            "warning",
            "Google Drive a reconnecter",
            "La session Google Drive a expire. Deconnecte puis reconnecte le compte depuis Options.",
          );
        } else {
          pushActivity("warning", "Archives Google non chargees", toErrorMessage(error));
        }
      }
    }

    const allBackups = [...cloudBackups, ...localBackups].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setBackups(allBackups);
    setSelectedRestore((current) =>
      allBackups.some((backup) => backup.path === current)
        ? current
        : (allBackups[0]?.path ?? ""),
    );
  }, [pushActivity]);

  const loadVersions = useCallback(
    async (gameDir: string, currentConfig: AppConfig) => {
      const gameVersions = await invoke<GameVersion[]>("list_game_versions", {
        gameDir,
      });
      setVersions(gameVersions);

      const availableIds = new Set(gameVersions.map((version) => version.id));
      const keptSelection = currentConfig.selectedVersions.filter((id) =>
        availableIds.has(id),
      );
      const nextSelection =
        keptSelection.length > 0
          ? keptSelection
          : gameVersions.map((version) => version.id);

      if (nextSelection.join("|") !== currentConfig.selectedVersions.join("|")) {
        await persistConfig({
          ...currentConfig,
          selectedVersions: nextSelection,
        });
      }
    },
    [persistConfig],
  );

  const scanInstallations = useCallback(async () => {
    setScanning(true);
    try {
      const detected = await invoke<CandidateGameDir[]>(
        "detect_game_directories",
      );
      setCandidates(detected);
      if (detected.length === 0) {
        pushActivity(
          "warning",
          "Aucune installation detectee",
          "Choisis le dossier World of Warcraft manuellement.",
        );
      } else {
        pushActivity(
          "info",
          "Detection terminee",
          `${detected.length} dossier(s) WoW trouve(s).`,
        );
      }
      return detected;
    } catch (error) {
      pushActivity("error", "Detection impossible", toErrorMessage(error));
      return [];
    } finally {
      setScanning(false);
    }
  }, [pushActivity]);

  const scanAndRefreshVersions = useCallback(async () => {
    await scanInstallations();
    const currentConfig = configRef.current;
    if (!currentConfig.gameDir) {
      return;
    }

    try {
      await loadVersions(currentConfig.gameDir, currentConfig);
      pushActivity(
        "info",
        "Versions rafraichies",
        "Disponibilite des dossiers Interface, WTF et Fonts mise a jour.",
      );
    } catch (error) {
      pushActivity("error", "Rafraichissement impossible", toErrorMessage(error));
    }
  }, [loadVersions, pushActivity, scanInstallations]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const storedConfig = normalizeConfig(await invoke<AppConfig>("load_config"));
      try {
        storedConfig.startOnLogin = await invoke<boolean>("is_autostart_enabled");
      } catch (error) {
        pushActivity("warning", "Demarrage automatique indisponible", toErrorMessage(error));
      }
      const detected = await invoke<CandidateGameDir[]>(
        "detect_game_directories",
      );
      setCandidates(detected);

      const nextConfig =
        !storedConfig.gameDir && detected[0]
          ? { ...storedConfig, gameDir: detected[0].path }
          : storedConfig;

      setConfig(nextConfig);
      configRef.current = nextConfig;

      if (nextConfig.gameDir) {
        await loadVersions(nextConfig.gameDir, nextConfig);
      }
      await loadBackups(nextConfig.localBackupDir, nextConfig.google);
    } catch (error) {
      pushActivity("error", "Initialisation impossible", toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadBackups, loadVersions, pushActivity]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (loading || startupUpdateCheckedRef.current) {
      return;
    }

    startupUpdateCheckedRef.current = true;
    void checkForUpdates("startup");
  }, [checkForUpdates, loading]);

  useEffect(() => {
    if (loading || !config.autoCheckUpdates) {
      return;
    }

    const timer = window.setInterval(() => {
      void checkForUpdates("automatic");
    }, 6 * 60 * 60 * 1_000);

    return () => window.clearInterval(timer);
  }, [checkForUpdates, config.autoCheckUpdates, loading]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const gameDir = config.gameDir ?? null;
    void invoke("watch_game_directory", { gameDir });

    let unlisten: (() => void) | null = null;

    const refreshVersionsFromWatch = () => {
      if (versionRefreshTimeoutRef.current) {
        window.clearTimeout(versionRefreshTimeoutRef.current);
      }
      versionRefreshTimeoutRef.current = window.setTimeout(() => {
        versionRefreshTimeoutRef.current = null;
        if (!["dashboard", "backup", "restore"].includes(activeView)) {
          return;
        }

        const currentConfig = configRef.current;
        if (
          versionRefreshBusyRef.current ||
          scanning ||
          runningBackupRef.current ||
          restoring ||
          !currentConfig.gameDir
        ) {
          return;
        }

        versionRefreshBusyRef.current = true;
        void loadVersions(currentConfig.gameDir, currentConfig)
          .catch((error) => {
            console.warn("Supervision des dossiers WoW impossible", error);
          })
          .finally(() => {
            versionRefreshBusyRef.current = false;
            void invoke("watch_game_directory", {
              gameDir: configRef.current.gameDir ?? null,
            });
          });
      }, 250);
    };

    void listen("game-folders-changed", refreshVersionsFromWatch).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
      if (versionRefreshTimeoutRef.current) {
        window.clearTimeout(versionRefreshTimeoutRef.current);
        versionRefreshTimeoutRef.current = null;
      }
      void invoke("watch_game_directory", { gameDir: null });
    };
  }, [activeView, config.gameDir, loadVersions, loading, restoring, scanning]);

  useEffect(() => {
    let unlistenBackup: (() => void) | null = null;
    let unlistenRestore: (() => void) | null = null;

    void listen<BackupProgress>("backup-progress", (event) => {
      setBackupProgress(event.payload);
    }).then((cleanup) => {
      unlistenBackup = cleanup;
    });

    void listen<BackupProgress>("restore-progress", (event) => {
      setRestoreProgress(event.payload);
    }).then((cleanup) => {
      unlistenRestore = cleanup;
    });

    return () => {
      unlistenBackup?.();
      unlistenRestore?.();
    };
  }, []);

  const updateConfig = async (patch: Partial<AppConfig>) => {
    const nextConfig = { ...configRef.current, ...patch };
    await persistConfig(nextConfig);
  };

  const setStartOnLogin = async (startOnLogin: boolean) => {
    try {
      await invoke("set_autostart_enabled", { enabled: startOnLogin });
      await updateConfig({ startOnLogin });
      pushActivity(
        "success",
        "Option appliquee",
        startOnLogin
          ? "BackupQuest demarrera avec le systeme."
          : "BackupQuest ne demarrera plus avec le systeme.",
      );
    } catch (error) {
      pushActivity("error", "Option demarrage impossible", toErrorMessage(error));
    }
  };

  const chooseGameDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choisir le dossier World of Warcraft",
    });
    if (typeof selected !== "string") {
      return;
    }

    const nextConfig = { ...configRef.current, gameDir: selected };
    await persistConfig(nextConfig);
    await loadVersions(selected, nextConfig);
    pushActivity("success", "Dossier WoW configure", selected);
  };

  const chooseBackupDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choisir le dossier de sauvegarde",
    });
    if (typeof selected !== "string") {
      return;
    }
    await updateConfig({ localBackupDir: selected });
    await loadBackups(selected, configRef.current.google);
    pushActivity("success", "Destination locale configuree", selected);
  };

  const selectCandidate = async (candidate: CandidateGameDir) => {
    const nextConfig = { ...configRef.current, gameDir: candidate.path };
    await persistConfig(nextConfig);
    await loadVersions(candidate.path, nextConfig);
    pushActivity("success", "Installation WoW selectionnee", candidate.path);
  };

  const toggleVersion = async (versionId: string) => {
    const currentSelection = configRef.current.selectedVersions;
    const nextSelection = currentSelection.includes(versionId)
      ? currentSelection.filter((id) => id !== versionId)
      : [...currentSelection, versionId];

    await updateConfig({ selectedVersions: nextSelection });
  };

  async function ensureFreshGoogleToken(currentConfig: AppConfig, force = false) {
    if (!currentConfig.google.refreshToken) {
      return currentConfig;
    }

    const expiresAt = currentConfig.google.tokenExpiresAt
      ? new Date(currentConfig.google.tokenExpiresAt).getTime()
      : 0;
    const shouldRefresh =
      force ||
      !currentConfig.google.accessToken ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= 0 ||
      expiresAt - Date.now() < 90_000;

    if (!shouldRefresh) {
      return currentConfig;
    }

    const token = await invoke<GoogleTokenResponse>("refresh_google_token", {
      request: {
        refreshToken: currentConfig.google.refreshToken,
      },
    });
    const nextConfig = mergeGoogleToken(currentConfig, token);
    await persistConfig(nextConfig);
    return nextConfig;
  }

  const notifySystem = async (title: string, body: string) => {
    try {
      await invoke("send_system_notification", { title, body });
    } catch (error) {
      console.warn("Notification systeme indisponible", error);
    }
  };

  const isSelectedGameRunning = async () =>
    invoke<boolean>("is_selected_game_running", {
      config: configRef.current,
    });

  const refreshWowProcessStatus = useCallback(async () => {
    try {
      const status = await invoke<WowProcessStatus>("get_wow_process_status", {
        config: configRef.current,
      });
      setWowProcessStatus(status);
    } catch (error) {
      console.warn("Supervision WoW impossible", error);
    }
  }, []);

  useEffect(() => {
    void refreshWowProcessStatus();
    const timer = window.setInterval(() => {
      void refreshWowProcessStatus();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshWowProcessStatus]);

  const runBackup = async (manual: boolean) => {
    if (runningBackupRef.current) {
      return;
    }

    runningBackupRef.current = true;
    setRunningBackup(true);
    setBackupProgress({
      phase: "Preparation",
      percent: 0,
      processedFiles: 0,
      totalFiles: 0,
    });
    pushActivity(
      "info",
      manual ? "Backup manuel lance" : "Backup automatique lance",
      "Preparation de l'archive.",
    );
    void notifySystem(
      manual ? "Backup manuel lance" : "Backup automatique lance",
      "BackupQuest commence la sauvegarde.",
    );
    await wait(0);
    try {
      const freshConfig = await ensureFreshGoogleToken(configRef.current);
      const result = await invoke<BackupResult>("run_backup", {
        config: freshConfig,
        manual,
      });
      pushActivity(
        "success",
        manual ? "Backup manuel termine" : "Backup automatique termine",
        `${result.archive.name} - ${result.message}`,
      );
      void notifySystem(
        manual ? "Backup manuel termine" : "Backup automatique termine",
        result.message,
      );
      await loadBackups(freshConfig.localBackupDir, freshConfig.google);
    } catch (error) {
      pushActivity("error", "Backup impossible", toErrorMessage(error));
    } finally {
      runningBackupRef.current = false;
      setRunningBackup(false);
      window.setTimeout(() => setBackupProgress(null), 900);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (schedulerBusyRef.current || runningBackupRef.current) {
        return;
      }

      void (async () => {
        schedulerBusyRef.current = true;
        try {
          const currentConfig = configRef.current;
          if (!currentConfig.cronEnabled && !pendingAutoBackupRef.current) {
            return;
          }

          const gameRunning = await isSelectedGameRunning();

          if (pendingAutoBackupRef.current) {
            if (gameRunning) {
              pendingGameClosedAtRef.current = null;
              return;
            }

            if (!pendingGameClosedAtRef.current) {
              pendingGameClosedAtRef.current = Date.now();
              pushActivity(
                "info",
                "Jeu ferme detecte",
                "BackupQuest attend quelques secondes avant de lancer le backup automatique.",
              );
              return;
            }

            if (Date.now() - pendingGameClosedAtRef.current < 30_000) {
              return;
            }

            pendingAutoBackupRef.current = false;
            pendingGameClosedAtRef.current = null;
            await runBackup(false);
            return;
          }

          if (!currentConfig.cronEnabled) {
            return;
          }

          const now = new Date();
          if (!matchesCron(currentConfig.cronExpression, now)) {
            return;
          }

          const cronKey = formatCronMinuteKey(now);
          if (lastCronKeyRef.current === cronKey) {
            return;
          }

          lastCronKeyRef.current = cronKey;
          if (gameRunning) {
            pendingAutoBackupRef.current = true;
            pendingGameClosedAtRef.current = null;
            pushActivity(
              "warning",
              "Backup automatique reporte",
              "World of Warcraft est lance. La sauvegarde demarrera apres fermeture du jeu.",
            );
            return;
          }

          await runBackup(false);
        } catch (error) {
          pushActivity("warning", "Detection WoW impossible", toErrorMessage(error));
        } finally {
          schedulerBusyRef.current = false;
        }
      })();
    }, 5_000);

    return () => window.clearInterval(timer);
  });

  const connectGoogle = async () => {
    setOauthBusy(true);
    setOauthMessage("Ouverture de Google OAuth2...");
    try {
      const preparedConfig = {
        ...configRef.current,
        google: { ...configRef.current.google, driveFolderName: "BackupQuest" },
      };
      await persistConfig(preparedConfig);
      const flow = await invoke<OAuthFlow>("start_google_oauth");
      await openUrl(flow.authUrl);
      setOauthMessage(`En attente de connexion`);

      const token = await pollOAuthFlow(flow);
      const nextConfig = mergeGoogleToken(configRef.current, token);
      await persistConfig(nextConfig);
      await loadBackups(nextConfig.localBackupDir, nextConfig.google);
      setOauthMessage("Google Drive est connecte.");
      pushActivity("success", "Google Drive connecte", "OAuth2 est pret pour les uploads.");
    } catch (error) {
      const message = toErrorMessage(error);
      setOauthMessage(message);
      pushActivity("error", "Connexion Google impossible", message);
    } finally {
      setOauthBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    const nextConfig = {
      ...configRef.current,
      google: {
        ...configRef.current.google,
        driveFolderName: "BackupQuest",
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
      },
    };
    await persistConfig(nextConfig);
    await loadBackups(nextConfig.localBackupDir, nextConfig.google);
    setOauthMessage("Compte Google deconnecte.");
    pushActivity("info", "Google Drive deconnecte", "Les prochains backups Drive demanderont une nouvelle connexion.");
  };

  const restoreSelectedBackup = async () => {
    if (!selectedBackup || !config.gameDir) {
      return;
    }

    const fallbackRestoreVersion =
      selectedBackup.versions.length > 0
        ? versions.find((version) => selectedBackup.versions.includes(version.id))?.id
        : versions[0]?.id;
    const requestedVersions =
      restoreVersions.length > 0
        ? restoreVersions
        : (fallbackRestoreVersion ? [fallbackRestoreVersion] : []);

    setRestoring(true);
    setRestoreProgress({
      phase: "Preparation",
      percent: 0,
      processedFiles: 0,
      totalFiles: 0,
    });
    try {
      const message = await invoke<string>("restore_backup", {
        request: {
          archivePath: selectedBackup.path,
          gameDir: config.gameDir,
          versions: requestedVersions,
          google: config.google,
        },
      });
      pushActivity("success", "Restauration terminee", message);
    } catch (error) {
      pushActivity("error", "Restauration impossible", toErrorMessage(error));
    } finally {
      setRestoring(false);
      window.setTimeout(() => setRestoreProgress(null), 900);
    }
  };

  const deleteSelectedBackup = async (backup: BackupArchive) => {
    const confirmed = window.confirm(
      `Supprimer definitivement le backup "${backup.name}" ?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingBackupPath(backup.path);
    try {
      let requestGoogle = configRef.current.google;
      if (backup.target === "googleDrive") {
        const freshConfig = await ensureFreshGoogleToken(configRef.current);
        requestGoogle = freshConfig.google;
      }

      try {
        const message = await invoke<string>("delete_backup", {
          request: {
            archivePath: backup.path,
            google: backup.target === "googleDrive" ? requestGoogle : null,
          },
        });
        pushActivity("success", "Backup supprime", message);
      } catch (error) {
        if (backup.target !== "googleDrive" || !isGoogleUnauthorizedError(error)) {
          throw error;
        }
        const freshConfig = await ensureFreshGoogleToken(configRef.current, true);
        const message = await invoke<string>("delete_backup", {
          request: {
            archivePath: backup.path,
            google: freshConfig.google,
          },
        });
        pushActivity("success", "Backup supprime", message);
      }

      setRestoreVersions([]);
      await loadBackups(configRef.current.localBackupDir, configRef.current.google);
    } catch (error) {
      pushActivity("error", "Suppression impossible", toErrorMessage(error));
    } finally {
      setDeletingBackupPath("");
    }
  };

  const chooseRestoreVersion = (versionId: string) => {
    setRestoreVersions([versionId]);
  };

  if (loading) {
    return (
      <main className="flex h-screen flex-col overflow-hidden bg-[#030303] text-[#f5f5f5]">
        <CustomTitleBar />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#111111] px-5 py-4 shadow-sm">
            <AppBrandIcon className="size-8" />
            <Loader2 className="size-5 animate-spin text-[#ffffff]" />
            <span className="text-sm font-medium">Chargement de BackupQuest</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#030303] text-[#f5f5f5]">
      <CustomTitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-68 shrink-0 flex-col border-r border-[#2a2a2a] bg-[#030303] px-4 py-5 text-[#f5f5f5]">
          <nav className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${
                    isActive
                      ? "bg-[#2a2a2a] text-[#f5f5f5]"
                      : "text-[#d4d4d4] hover:bg-white/10 hover:text-white"
                  }`}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                >
                  <Icon className="size-4" />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-[#a3a3a3]">Statut</p>
            <div className="mt-3 flex items-center gap-2 text-sm">
              {config.backupCloud ? (
                <Cloud className="size-4 text-[#f5f5f5]" />
              ) : (
                <HardDrive className="size-4 text-[#ffffff]" />
              )}
              <span>
                {destinationLabel(config)}
              </span>
            </div>
            <p className="mt-2 text-xs text-[#a3a3a3]">
              {config.cronEnabled
                ? `Sauvegarde auto: ${scheduleSummary(config.cronExpression)}`
                : "Sauvegarde automatique desactivee"}
            </p>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-18 shrink-0 items-center justify-between border-b border-[#2a2a2a] bg-[#0b0b0b] px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a3a3a3]">
                {navigation.find((item) => item.id === activeView)?.label}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                {activeView === "dashboard" && "Vue d'ensemble"}
                {activeView === "backup" && "Sauvegardes"}
                {activeView === "restore" && "Restauration"}
                {activeView === "options" && "Options"}
              </h1>
            </div>
            <Button
              className="bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
              disabled={runningBackup}
              onClick={() => void runBackup(true)}
              type="button"
            >
              {runningBackup ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Backup manuel
            </Button>
          </header>

          {runningBackup && backupProgress && (
            <BackupProgressBar progress={backupProgress} />
          )}
          {restoring && restoreProgress && (
            <BackupProgressBar progress={restoreProgress} />
          )}

          <div className="backupquest-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-8 py-6">
            {activeView === "dashboard" && (
              <DashboardView
                activities={activities}
                backups={backups}
                config={config}
                onGoBackup={() => setActiveView("backup")}
                selectedVersionLabels={selectedVersionLabels}
                versions={versions}
                wowProcessStatus={wowProcessStatus}
              />
            )}

            {activeView === "backup" && (
              <BackupView
                candidates={candidates}
                config={config}
                onChooseBackupDir={() => void chooseBackupDir()}
                onChooseGameDir={() => void chooseGameDir()}
                onRefreshBackups={() => void loadBackups(config.localBackupDir, config.google)}
                onRunBackup={() => void runBackup(true)}
                onScan={() => void scanAndRefreshVersions()}
                onSelectCandidate={(candidate) => void selectCandidate(candidate)}
                onSetCronEnabled={(cronEnabled) => void updateConfig({ cronEnabled })}
                onSetCronExpression={(cronExpression) =>
                  void updateConfig({ cronExpression })
                }
                onSetBackupCloud={(backupCloud) =>
                  void updateConfig({ backupCloud, storageTarget: backupCloud ? "googleDrive" : "local" })
                }
                onSetBackupLocal={(backupLocal) =>
                  void updateConfig({ backupLocal, storageTarget: backupLocal ? "local" : "googleDrive" })
                }
                onSetBackupRetention={(backupRetention) =>
                  void updateConfig({ backupRetention })
                }
                onToggleVersion={(versionId) => void toggleVersion(versionId)}
                runningBackup={runningBackup}
                scanning={scanning}
                versions={versions}
                wowProcessStatus={wowProcessStatus}
              />
            )}

            {activeView === "restore" && (
              <RestoreView
                backups={backups}
                config={config}
                deletingBackupPath={deletingBackupPath}
                gameVersions={versions}
                onChooseRestoreVersion={chooseRestoreVersion}
                onDeleteBackup={(backup) => void deleteSelectedBackup(backup)}
                onRefresh={() => void loadBackups(config.localBackupDir, config.google)}
                onRestore={() => void restoreSelectedBackup()}
                onSelectBackup={(path) => {
                  setSelectedRestore(path);
                }}
                restoreVersions={restoreVersions}
                restoring={restoring}
                selectedBackup={selectedBackup}
              />
            )}

            {activeView === "options" && (
              <OptionsView
                config={config}
                oauthBusy={oauthBusy}
                oauthMessage={oauthMessage}
                onConnectGoogle={() => void connectGoogle()}
                onDisconnectGoogle={() => void disconnectGoogle()}
                onCheckForUpdates={() => void checkForUpdates("manual")}
                onInstallUpdate={() => void installUpdate()}
                onSetAutoCheckUpdates={(autoCheckUpdates) =>
                  void updateConfig({ autoCheckUpdates })
                }
                onSetCloseToTray={(closeToTray) => void updateConfig({ closeToTray })}
                onSetStartOnLogin={(startOnLogin) => void setStartOnLogin(startOnLogin)}
                updateState={updateState}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function DashboardView({
  activities,
  backups,
  config,
  onGoBackup,
  selectedVersionLabels,
  versions,
  wowProcessStatus,
}: {
  activities: ActivityItem[];
  backups: BackupArchive[];
  config: AppConfig;
  onGoBackup: () => void;
  selectedVersionLabels: string;
  versions: GameVersion[];
  wowProcessStatus: WowProcessStatus;
}) {
  const latestBackup = backups[0];
  const totalPayload = versions.reduce((total, version) => total + version.sizeBytes, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-4">
        <MetricTile
          icon={FolderOpen}
          label="Dossier WoW"
          value={config.gameDir ? "Detecte" : "A configurer"}
          detail={config.gameDir ?? "Aucun dossier selectionne"}
        />
        <MetricTile
          icon={Archive}
          label="Versions"
          value={`${config.selectedVersions.length}/${versions.length}`}
          detail={selectedVersionLabels}
        />
        <MetricTile
          icon={HardDrive}
          label="Taille totale"
          value={formatBytes(totalPayload)}
          detail="Interface et WTF detectes"
        />
        <MetricTile
          icon={Radio}
          label="World of Warcraft"
          value={wowProcessStatus.running ? "Lance" : "Ferme"}
          detail={wowProcessDetail(wowProcessStatus)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Versions suivies</h2>
              <p className="mt-1 text-sm text-[#a3a3a3]">
                Retail, Classic et autres dossiers installes sont listes depuis le dossier WoW.
              </p>
            </div>
            <Button variant="outline" onClick={onGoBackup} type="button">
              Configurer
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {versions.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="Aucune version detectee"
                detail="Selectionne le dossier World of Warcraft pour charger les versions disponibles."
              />
            ) : (
              versions.map((version) => (
                <VersionSummary
                  key={version.id}
                  selected={config.selectedVersions.includes(version.id)}
                  version={version}
                />
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <History className="size-5 text-[#ffffff]" />
            <h2 className="text-lg font-semibold">Activite recente</h2>
          </div>

          <div className="mt-5 space-y-3">
            {activities.length === 0 ? (
              <EmptyState
                icon={Gauge}
                title="Tout est calme"
                detail={
                  latestBackup
                    ? `Dernier backup local: ${formatDate(latestBackup.createdAt)}`
                    : "Lance un backup manuel ou active la sauvegarde automatique."
                }
              />
            ) : (
              activities.map((activity) => (
                <div
                  key={activity.id}
                  className="rounded-md border border-[#2f2f2f] bg-[#111111] p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{activity.title}</p>
                    <span className={activityClassName(activity.kind)}>
                      {activity.kind}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-sm text-[#a3a3a3]">
                    {activity.detail}
                  </p>
                  <p className="mt-2 text-xs text-[#8a8a8a]">
                    {formatDate(activity.timestamp.toISOString())}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CustomTitleBar() {
  const appWindow = getCurrentWindow();

  const startDrag = async (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    await appWindow.startDragging();
  };

  const toggleMaximize = async () => {
    if (await appWindow.isMaximized()) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  };

  return (
    <div
      className="flex h-12 shrink-0 select-none items-center border-b border-[#2a2a2a] bg-[#020202]"
      onMouseDown={(event) => void startDrag(event)}
      onDoubleClick={() => void toggleMaximize()}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <AppBrandIcon className="size-8" />
        <span className="truncate text-sm font-semibold text-[#f5f5f5]">BackupQuest</span>
        <span className="text-xs text-[#8a8a8a]">WoW Backup Manager</span>
      </div>

      <div className="flex h-full" onMouseDown={(event) => event.stopPropagation()}>
        <TitleBarButton label="Reduire" onClick={() => void appWindow.minimize()}>
          <Minus className="size-4" />
        </TitleBarButton>
        <TitleBarButton label="Agrandir" onClick={() => void toggleMaximize()}>
          <Square className="size-3.5" />
        </TitleBarButton>
        <TitleBarButton danger label="Fermer" onClick={() => void appWindow.close()}>
          <X className="size-4" />
        </TitleBarButton>
      </div>
    </div>
  );
}

function BackupProgressBar({ progress }: { progress: BackupProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const fileDetail =
    progress.totalFiles > 0
      ? `${progress.processedFiles}/${progress.totalFiles} fichiers`
      : "Preparation des fichiers";

  return (
    <div className="border-b border-[#2a2a2a] bg-[#050505] px-8 py-3">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-[#f5f5f5]">
          {progress.phase}
        </span>
        <span className="text-[#a3a3a3]">
          {fileDetail} - {percent}%
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1f1f1f]">
        <div
          className="h-full rounded-full bg-[#ffffff] transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function AppBrandIcon({ className }: { className: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`${className} rounded-lg object-contain`}
      draggable={false}
      src={appIconUrl}
    />
  );
}

function TitleBarButton({
  children,
  danger = false,
  label,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`flex h-12 w-12 items-center justify-center text-[#d4d4d4] transition ${
        danger ? "hover:bg-[#c2413a] hover:text-white" : "hover:bg-[#1f1f1f] hover:text-white"
      }`}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MetricTile({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: typeof Home;
  label: string;
  value: string;
}) {
  return (
    <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#a3a3a3]">
          {label}
        </p>
        <Icon className="size-5 text-[#ffffff]" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-normal">{value}</p>
      <p className="mt-2 truncate text-sm text-[#a3a3a3]" title={detail}>
        {detail}
      </p>
    </section>
  );
}

function VersionSummary({
  selected,
  version,
}: {
  selected: boolean;
  version: GameVersion;
}) {
  return (
    <div className="rounded-md border border-[#2f2f2f] bg-[#111111] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{version.name}</p>
          <p className="mt-1 text-xs text-[#a3a3a3]">{formatBytes(version.sizeBytes)}</p>
        </div>
        {selected ? (
          <span className="flex items-center gap-1 rounded-full bg-[#ffffff] px-2 py-1 text-xs font-medium text-[#030303]">
            <Check className="size-3" />
            actif
          </span>
        ) : (
          <span className="rounded-full bg-[#2a2a2a] px-2 py-1 text-xs text-[#a3a3a3]">
            ignore
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusPill active={version.hasInterface} label="Interface" />
        <StatusPill active={version.hasWtf} label="WTF" />
        <StatusPill active={version.hasFonts} label="Fonts" optional />
      </div>
    </div>
  );
}

async function pollOAuthFlow(flow: OAuthFlow) {
  const started = Date.now();

  while (Date.now() - started < 300_000) {
    await wait(1_000);
    const result = await invoke<OAuthPoll>("poll_google_oauth", {
      flowId: flow.flowId,
    });

    if (!result.completed) {
      continue;
    }
    if (result.token) {
      return result.token;
    }
    throw new Error(result.error || "OAuth Google interrompu.");
  }

  throw new Error("OAuth Google expire apres 5 minutes.");
}

function mergeGoogleToken(config: AppConfig, token: GoogleTokenResponse): AppConfig {
  return {
    ...config,
    google: {
      ...config.google,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? config.google.refreshToken,
      tokenExpiresAt: token.expiresAt,
    },
  };
}

function normalizeConfig(config: AppConfig): AppConfig {
  const legacyStorageTarget = config.storageTarget;
  return {
    ...EMPTY_CONFIG,
    ...config,
    backupLocal:
      typeof config.backupLocal === "boolean"
        ? config.backupLocal
        : legacyStorageTarget !== "googleDrive",
    backupCloud:
      typeof config.backupCloud === "boolean"
        ? config.backupCloud
        : legacyStorageTarget === "googleDrive",
    startOnLogin:
      typeof config.startOnLogin === "boolean"
        ? config.startOnLogin
        : EMPTY_CONFIG.startOnLogin,
    backupRetention:
      typeof config.backupRetention === "number" && Number.isFinite(config.backupRetention)
        ? Math.max(1, Math.min(99, Math.round(config.backupRetention)))
        : EMPTY_CONFIG.backupRetention,
    closeToTray:
      typeof config.closeToTray === "boolean"
        ? config.closeToTray
        : EMPTY_CONFIG.closeToTray,
    autoCheckUpdates:
      typeof config.autoCheckUpdates === "boolean"
        ? config.autoCheckUpdates
        : EMPTY_CONFIG.autoCheckUpdates,
    google: {
      ...EMPTY_CONFIG.google,
      ...config.google,
      driveFolderName: "BackupQuest",
    },
  };
}

function matchesCron(expression: string, date: Date) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    matchesCronField(minute, date.getMinutes(), 0, 59) &&
    matchesCronField(hour, date.getHours(), 0, 23) &&
    matchesCronField(dayOfMonth, date.getDate(), 1, 31) &&
    matchesCronField(month, date.getMonth() + 1, 1, 12) &&
    matchesCronField(dayOfWeek, date.getDay(), 0, 7)
  );
}

function matchesCronField(field: string, value: number, min: number, max: number) {
  return field.split(",").some((part) => {
    if (part === "*") {
      return true;
    }

    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return Number.isInteger(step) && step > 0 && (value - min) % step === 0;
    }

    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        value >= start &&
        value <= end &&
        start >= min &&
        end <= max
      );
    }

    const numeric = Number(part);
    if (max === 7 && numeric === 7) {
      return value === 0;
    }
    return Number.isInteger(numeric) && numeric === value && numeric >= min && numeric <= max;
  });
}

function formatCronMinuteKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}-${minute}`;
}

function activityClassName(kind: ActivityKind) {
  const base = "rounded-full px-2 py-0.5 text-xs font-medium";
  if (kind === "success") {
    return `${base} bg-[#f5f5f5] text-[#050505]`;
  }
  if (kind === "warning") {
    return `${base} bg-[#3d3318] text-[#f3c75f]`;
  }
  if (kind === "error") {
    return `${base} bg-[#3a2022] text-[#ff9f8d]`;
  }
  return `${base} bg-[#1f1f1f] text-[#f5f5f5]`;
}

function wowProcessDetail(status: WowProcessStatus) {
  if (!status.running) {
    return "Aucun client WoW detecte";
  }

  const labels = status.processes
    .map((process) => process.versionName || process.name)
    .filter(Boolean);

  return labels.length > 0 ? labels.join(", ") : "Client WoW en cours";
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Erreur inconnue.";
}

function toUpdaterError(error: unknown) {
  const message = toErrorMessage(error);
  if (message.includes("Could not fetch a valid release JSON")) {
    return "Manifest latest.json introuvable ou invalide sur GitHub. Publie une nouvelle release avec le workflow mis a jour.";
  }
  return message;
}

function isGoogleUnauthorizedError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("unauthenticated") ||
    message.includes("invalid credentials")
  );
}

function isGoogleAuthError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();
  return (
    isGoogleUnauthorizedError(error) ||
    message.includes("invalid_grant") ||
    message.includes("invalid token") ||
    message.includes("oauth")
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default App;
