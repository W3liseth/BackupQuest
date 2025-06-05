const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const ElectronStore = require('electron-store');
const backupManager = require('../utils/backup');
const googleAuth = require('../utils/googleAuth');
const autoLaunch = require('auto-launch');

// Vérifier si une instance est déjà en cours d'exécution
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Une instance est déjà en cours d\'exécution');
  app.quit();
  return;
}

// Gérer le lancement d'une seconde instance
app.on('second-instance', (event, commandLine, workingDirectory) => {
  // Quelqu'un a essayé de lancer une seconde instance, on devrait se concentrer sur notre fenêtre
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

// Set application name and icon
app.setName('BackupQuest');
app.setAppUserModelId('com.backupquest.app');

// Configuration de l'encodage pour Windows
if (process.platform === 'win32') {
  process.env.LANG = 'fr_FR.UTF-8';
}

const store = new ElectronStore();
let mainWindow;
let tray = null;

const appLauncher = new autoLaunch({
    name: 'BackupQuest',
    isHidden: true,
});

function createTray() {
    // Créer l'icône du tray
    tray = new Tray(path.join(__dirname, '../../src/renderer/logo.ico'));
    
    // Créer le menu contextuel
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Afficher BackupQuest',
            click: () => {
                mainWindow.show();
            }
        },
        {
            label: 'Quitter',
            click: () => {
                if (tray) {
                    tray.destroy();
                }
                app.exit(0);
            }
        }
    ]);

    // Définir le menu contextuel
    tray.setToolTip('BackupQuest');
    tray.setContextMenu(contextMenu);

    // Gérer le clic sur l'icône
    tray.on('click', () => {
        mainWindow.show();
    });
}

function createWindow() {
  console.log('Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    show: false, // Ne pas montrer la fenêtre immédiatement
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    title: 'BackupQuest - WoW Backup Manager',
    autoHideMenuBar: true, // Masquer automatiquement la barre de menu
    menu: null, // Supprimer la barre de menu
    frame: false, // Supprimer le cadre de fenêtre par default
    icon: path.join(__dirname, '../../src/renderer/logo.ico'), // Définit l'icône de l'application
    appId: 'com.backupquest.app', // Ajout de l'ID de l'application
    resizable: false // Ajouter cette option pour rendre la fenêtre non redimensionnable
  });

  const htmlPath = path.join(__dirname, '../renderer/index.html');
  console.log('HTML file path:', htmlPath);
  
  mainWindow.loadFile(htmlPath);
  
  // Développement uniquement
  //mainWindow.webContents.openDevTools();

  mainWindow.on('ready-to-show', () => {
    console.log('Window ready to be displayed');
    mainWindow.show(); // Afficher la fenêtre une fois qu'elle est prête
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Loading error:', errorCode, errorDescription);
  });

  // Passer les webContents au backupManager après la création de la fenêtre
  backupManager.setWebContents(mainWindow.webContents);

  // Créer le tray après la création de la fenêtre
  createTray();
}

app.whenReady().then(() => {
  console.log('Application ready');
  createWindow();

  // Handle minimize to tray on close
  mainWindow.on('close', (event) => {
    const minimizeToTray = store.get('minimizeToTray', false);
    if (minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Handle app activation when minimized to tray
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });

}).catch(err => {
  console.error('Error during startup:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
        if (tray) {
            tray.destroy();
        }
    app.quit();
  }
});

// Gestionnaire pour minimiser la fenêtre
ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

// Gestionnaire pour fermer la fenêtre
ipcMain.handle('close-window', () => {
    if (mainWindow) {
        const minimizeToTray = store.get('minimizeToTray', false);
        if (minimizeToTray) {
            mainWindow.hide();
        } else {
            if (tray) {
                tray.destroy();
            }
            app.quit();
        }
  }
});

// Gestionnaire pour sélectionner le dossier WoW
ipcMain.handle('select-wow-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Sélectionner le dossier World of Warcraft'
  });
  
  if (!result.canceled) {
    store.set('wowPath', result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

// Gestionnaire pour sélectionner le dossier de backup
ipcMain.handle('select-backup-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Sélectionner le dossier de backup'
  });
  
  if (!result.canceled) {
    store.set('backupPath', result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

// Gestionnaire pour démarrer une sauvegarde
ipcMain.handle('start-backup', async (event, options) => {
  console.log('Received start-backup IPC call in main process with options:', options);
  try {
    // Envoyer un événement de progression initial
    event.sender.send('backup-progress', { progress: 0, status: 'Démarrage de la sauvegarde..' });
    
    const result = await backupManager.createBackup(options, (progress, status) => {
      // Envoyer les mises à jour de progression au rendu
      event.sender.send('backup-progress', { progress, status });
    });
    
    // Envoyer un événement de progression final
    event.sender.send('backup-progress', { progress: 100, status: 'Backup terminé !' });
    return result;
  } catch (error) {
    throw new Error(`Backup error: ${error.message}`);
  }
});

// Gestionnaire pour restaurer une sauvegarde
ipcMain.handle('restore-backup', async (event, options) => {
  try {
    // Envoyer un événement de progression initial
    event.sender.send('restore-progress', { progress: 0, status: 'Démarrage de la restauration...' });
    
    await backupManager.restoreBackup(options, (progress, status) => {
      // Envoyer les mises à jour de progression au rendu
      event.sender.send('restore-progress', { progress, status });
    });
    
    // Envoyer un événement de progression final
    event.sender.send('restore-progress', { progress: 100, status: 'Restauration terminée !' });
  } catch (error) {
    throw new Error(`Restoration error: ${error.message}`);
  }
});

// Gestionnaire pour obtenir la liste des sauvegardes
ipcMain.handle('get-backup-list', async (event, options) => {
  try {
    return await backupManager.getBackupList(options);
  } catch (error) {
    throw new Error(`Error retrieving backup list: ${error.message}`);
  }
});

// Gestionnaire pour configurer la planification
ipcMain.handle('set-schedule', async (event, scheduleConfig) => {
  console.log('Main: Received set-schedule IPC call with config:', scheduleConfig);
  try {
    backupManager.setSchedule(scheduleConfig);
  } catch (error) {
    throw new Error(`Error configuring schedule: ${error.message}`);
  }
});

// Gestionnaire pour effacer la planification
ipcMain.handle('clear-schedule', async () => {
  try {
    backupManager.clearSchedule();
  } catch (error) {
    throw new Error(`Error clearing schedule: ${error.message}`);
  }
});

// Gestionnaire pour obtenir l'URL d'authentification Google
ipcMain.handle('get-google-auth-url', async () => {
  try {
    return await googleAuth.authenticate();
  } catch (error) {
    throw new Error(`Error generating authentication URL: ${error.message}`);
  }
});

// Gestionnaire pour valider le code d'authentification Google
ipcMain.handle('validate-google-auth', async (event, code) => {
  try {
    await googleAuth.handleAuthCode(code);
    return true;
  } catch (error) {
    throw new Error(`Error validating authentication: ${error.message}`);
  }
});

// Gestionnaire pour vérifier l'état de l'authentification Google
ipcMain.handle('check-google-auth', async () => {
  try {
    return await googleAuth.isAuthenticated();
  } catch (error) {
    return false;
  }
});

// Gestionnaire pour supprimer une sauvegarde
ipcMain.handle('delete-backup', async (event, options, backupId) => {
  try {
    await backupManager.deleteBackup(options, backupId);
    return { success: true };
  } catch (error) {
    throw new Error(`Error deleting backup: ${error.message}`);
  }
});

// Gestionnaire pour la déconnexion Google
ipcMain.handle('google-logout', async () => {
    try {
        await googleAuth.logout();
        return { success: true };
    } catch (error) {
        throw new Error(`Google logout failed: ${error.message}`);
    }
});

// Gestionnaire pour activer/désactiver le lancement au démarrage
ipcMain.handle('set-auto-launch', async (event, enable) => {
    try {
        if (enable) {
            await appLauncher.enable();
            console.log('Auto launch enabled');
        } else {
            try {
                await appLauncher.disable();
                console.log('Auto launch disabled');
            } catch (disableError) {
                // Si l'erreur est liée à une clé de registre manquante, on considère que c'est déjà désactivé
                if (disableError.message && disableError.message.includes('n\'a pas trouvé la clé')) {
                    console.log('Auto launch was already disabled');
                    return { success: true };
                }
                throw disableError;
            }
        }
        return { success: true };
    } catch (error) {
        console.error(`Failed to set auto launch to ${enable ? 'enabled' : 'disabled'}:`, error);
        return { success: false, error: error.message };
    }
});

// Gestionnaires IPC pour les options
ipcMain.handle('get-options', async () => {
    console.log('Handling get-options');
    const options = {
        autoLaunch: store.get('autoLaunch', false),
        minimizeToTray: store.get('minimizeToTray', false),
        limitBackups: store.get('limitBackups', false),
        backupLimitCount: store.get('backupLimitCount', 7) // Valeur par défaut 7
    };
    console.log('Returning options:', options);
    return options;
});

ipcMain.handle('set-options', async (event, options) => {
    console.log('Handling set-options', options);
    store.set('autoLaunch', options.autoLaunch);
    store.set('minimizeToTray', options.minimizeToTray);
    store.set('limitBackups', options.limitBackups);
    store.set('backupLimitCount', options.backupLimitCount);
    console.log('Options saved to store.');
});
