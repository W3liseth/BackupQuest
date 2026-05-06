import { useMemo, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  Loader2,
  Power,
  RefreshCw,
  Rocket,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppConfig } from "./types";
import { ToggleOption } from "./viewShared";

type UpdateStatus = "idle" | "checking" | "available" | "none" | "downloading" | "installed" | "error";

export function OptionsView({
  config,
  oauthBusy,
  oauthMessage,
  onConnectGoogle,
  onDisconnectGoogle,
  onSetCloseToTray,
  onSetStartOnLogin,
}: {
  config: AppConfig;
  oauthBusy: boolean;
  oauthMessage: string;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
  onSetCloseToTray: (enabled: boolean) => void;
  onSetStartOnLogin: (enabled: boolean) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Application</h2>
        <p className="mt-2 text-sm text-[#a3a3a3]">
          Controle le comportement de BackupQuest avec Windows et la zone de notification.
        </p>
        <div className="mt-4 grid gap-2">
          <ToggleOption
            active={config.startOnLogin}
            icon={Power}
            label="Demarrer avec le systeme"
            onClick={() => onSetStartOnLogin(!config.startOnLogin)}
          />
          <ToggleOption
            active={config.closeToTray}
            icon={X}
            label="Fermer dans le system tray"
            onClick={() => onSetCloseToTray(!config.closeToTray)}
          />
        </div>
      </section>

      <UpdaterPanel />

      <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Authentification Google</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
          <GoogleDrivePanel
            config={config}
            oauthBusy={oauthBusy}
            oauthMessage={oauthMessage}
            onConnectGoogle={onConnectGoogle}
            onDisconnectGoogle={onDisconnectGoogle}
          />
        </div>
      </section>
    </div>
  );
}

function UpdaterPanel() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [message, setMessage] = useState("Verifie les releases GitHub de BackupQuest.");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);

  const percent = useMemo(() => {
    if (!contentLength || contentLength <= 0) {
      return status === "installed" ? 100 : 0;
    }
    return Math.max(0, Math.min(100, Math.round((downloadedBytes / contentLength) * 100)));
  }, [contentLength, downloadedBytes, status]);

  const checkForUpdate = async () => {
    setStatus("checking");
    setMessage("Recherche d'une nouvelle release GitHub...");
    setPendingUpdate(null);
    setDownloadedBytes(0);
    setContentLength(null);

    try {
      const update = await check({ timeout: 30_000 });
      if (!update) {
        setStatus("none");
        setMessage("BackupQuest est deja a jour.");
        return;
      }

      setPendingUpdate(update);
      setStatus("available");
      setMessage(`Version ${update.version} disponible.`);
    } catch (error) {
      setStatus("error");
      setMessage(toUpdaterError(error));
    }
  };

  const installUpdate = async () => {
    if (!pendingUpdate) {
      return;
    }

    let downloaded = 0;
    setStatus("downloading");
    setMessage(`Telechargement de la version ${pendingUpdate.version}...`);
    setDownloadedBytes(0);
    setContentLength(null);

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          downloaded = 0;
          setDownloadedBytes(0);
          setContentLength(event.data.contentLength ?? null);
          return;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setDownloadedBytes(downloaded);
          return;
        }

        setStatus("installed");
        setMessage("Mise a jour installee. Redemarrage de BackupQuest...");
      });

      setStatus("installed");
      setMessage("Mise a jour installee. Redemarrage de BackupQuest...");
      await relaunch();
    } catch (error) {
      setStatus("error");
      setMessage(toUpdaterError(error));
    }
  };

  const busy = status === "checking" || status === "downloading";
  const hasUpdate = status === "available" && pendingUpdate;

  return (
    <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Mises a jour</h2>
          <p className="mt-2 text-sm text-[#a3a3a3]">
            BackupQuest peut installer automatiquement une nouvelle release publiee sur GitHub.
          </p>
        </div>
        <Rocket className="size-5 shrink-0 text-[#ffffff]" />
      </div>

      <div className="mt-4 rounded-md border border-[#2f2f2f] bg-[#111111] p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {status === "none" || status === "installed" ? (
            <CheckCircle2 className="size-4 text-[#86efac]" />
          ) : status === "checking" || status === "downloading" ? (
            <Loader2 className="size-4 animate-spin text-[#ffffff]" />
          ) : (
            <RefreshCw className="size-4 text-[#ffffff]" />
          )}
          <span>{statusLabel(status)}</span>
        </div>
        <p className="mt-2 text-sm text-[#a3a3a3]">{message}</p>
        {pendingUpdate?.body && (
          <p className="mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-[#050505] p-3 text-xs text-[#c7c7c7]">
            {pendingUpdate.body}
          </p>
        )}

        {status === "downloading" && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-[#a3a3a3]">
              <span>Telechargement</span>
              <span>{contentLength ? `${percent}%` : "En cours"}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1f1f1f]">
              <div
                className="h-full rounded-full bg-[#ffffff] transition-all duration-300"
                style={{ width: `${contentLength ? percent : 35}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          className="bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
          disabled={busy}
          onClick={() => void checkForUpdate()}
          type="button"
        >
          {status === "checking" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Verifier
        </Button>

        <Button
          className="bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
          disabled={!hasUpdate || busy}
          onClick={() => void installUpdate()}
          type="button"
        >
          {status === "downloading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Installer
        </Button>
      </div>
    </section>
  );
}

function statusLabel(status: UpdateStatus) {
  if (status === "checking") {
    return "Verification";
  }
  if (status === "available") {
    return "Mise a jour disponible";
  }
  if (status === "none") {
    return "A jour";
  }
  if (status === "downloading") {
    return "Installation";
  }
  if (status === "installed") {
    return "Installee";
  }
  if (status === "error") {
    return "Erreur";
  }
  return "Pret";
}

function toUpdaterError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Recherche de mise a jour impossible.";
}

function GoogleDrivePanel({
  config,
  oauthBusy,
  oauthMessage,
  onConnectGoogle,
  onDisconnectGoogle,
}: {
  config: AppConfig;
  oauthBusy: boolean;
  oauthMessage: string;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
}) {
  const connected = Boolean(config.google.accessToken);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-md border border-[#2f2f2f] bg-[#111111] p-3 text-sm">
        {connected ? (
          <Cloud className="size-4 text-[#ffffff]" />
        ) : (
          <CloudOff className="size-4 text-[#b35039]" />
        )}
        <span>{connected ? "connecté" : "non connecté"}</span>
      </div>
      <Button
        className={`w-full ${
          connected
            ? "bg-[#c2413a] text-white hover:bg-[#a33632]"
            : "bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
        }`}
        disabled={oauthBusy}
        onClick={connected ? onDisconnectGoogle : onConnectGoogle}
        type="button"
      >
        {oauthBusy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : connected ? (
          <CloudOff className="size-4" />
        ) : (
          <Cloud className="size-4" />
        )}
        {connected ? "Se deconnecter" : "Se connecter"}
      </Button>
      {oauthMessage && <p className="text-xs text-[#a3a3a3]">{oauthMessage}</p>}
    </div>
  );
}
