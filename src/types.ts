export type View = "dashboard" | "backup" | "restore" | "options";
export type StorageTarget = "local" | "googleDrive";
export type ActivityKind = "success" | "info" | "warning" | "error";

export type GoogleDriveConfig = {
  clientId: string;
  clientSecret: string;
  driveFolderName: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
};

export type AppConfig = {
  gameDir?: string | null;
  selectedVersions: string[];
  backupLocal: boolean;
  backupCloud: boolean;
  storageTarget: StorageTarget;
  localBackupDir?: string | null;
  backupRetention: number;
  cronEnabled: boolean;
  cronExpression: string;
  startOnLogin: boolean;
  closeToTray: boolean;
  google: GoogleDriveConfig;
};

export type CandidateGameDir = {
  path: string;
  source: string;
  versionsCount: number;
};

export type GameVersion = {
  id: string;
  name: string;
  path: string;
  hasInterface: boolean;
  hasWtf: boolean;
  hasFonts: boolean;
  sizeBytes: number;
  lastModified?: string | null;
};

export type BackupArchive = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
  versions: string[];
  target: StorageTarget;
  status: string;
};

export type BackupResult = {
  archive: BackupArchive;
  message: string;
};

export type BackupProgress = {
  phase: string;
  percent: number;
  processedFiles: number;
  totalFiles: number;
};

export type OAuthFlow = {
  flowId: string;
  authUrl: string;
  redirectUri: string;
};

export type OAuthPoll = {
  completed: boolean;
  token?: GoogleTokenResponse | null;
  error?: string | null;
};

export type GoogleTokenResponse = {
  accessToken: string;
  refreshToken?: string | null;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
};

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  timestamp: Date;
};
