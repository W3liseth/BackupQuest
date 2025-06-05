const { ipcRenderer } = require('electron');
const ElectronStore = require('electron-store');
const store = new ElectronStore();

// Éléments DOM
const wowPathInput = document.getElementById('wowPath');
const backupPathInput = document.getElementById('backupPath');
const gameVersionSelect = document.getElementById('gameVersion');
const backupTypeSelect = document.getElementById('backupTypeSelect');
const localBackupSettings = document.getElementById('localBackupSettings');
const backupNowButton = document.getElementById('backupNow');
const restoreBackupButton = document.getElementById('restoreBackup');
const enableScheduleCheckbox = document.getElementById('enableSchedule');
const scheduleSettings = document.getElementById('scheduleSettings');
const scheduleFrequencySelect = document.getElementById('scheduleFrequency');
const scheduleTimeHourSelect = document.getElementById('scheduleTimeHour');
const scheduleTimeMinuteSelect = document.getElementById('scheduleTimeMinute');
const scheduleDaySelect = document.getElementById('scheduleDay');
const statusMessage = document.getElementById('statusMessage');
const progressBar = document.getElementById('progressBar');
const progressElement = progressBar.querySelector('.progress');

// Option elements (Declared here, initialized later)
let optionsModal;
let optionsCloseButton;
let autoLaunchCheckbox;
let minimizeToTrayCheckbox;
let googleLogoutButton;
let limitBackupsCheckbox;
let backupLimitCountSelect;

// Title bar elements (Initialized inside DOMContentLoaded)
let minimizeBtn;
let closeBtn;

// Charger les paramètres sauvegardés
async function loadSavedSettings() {
    const savedWowPath = store.get('wowPath');
    const savedBackupPath = store.get('backupPath');
    const savedGameVersion = store.get('gameVersion');
    const savedBackupType = store.get('backupType');
    const savedSchedule = store.get('schedule');

    console.log('Loading saved settings:', {
        wowPath: savedWowPath,
        backupPath: savedBackupPath,
        gameVersion: savedGameVersion,
        backupType: savedBackupType,
        schedule: savedSchedule
    });

    if (savedWowPath) wowPathInput.value = savedWowPath;
    if (savedBackupPath) backupPathInput.value = savedBackupPath;
    if (savedGameVersion) {
        console.log('Setting game version to:', savedGameVersion);
        gameVersionSelect.value = savedGameVersion;
    } else {
        console.log('No saved game version found, using default');
        gameVersionSelect.value = 'retail'; // Valeur par défaut
        store.set('gameVersion', 'retail');
    }
    if (savedBackupType) {
        console.log('Setting backup type to:', savedBackupType);
        backupTypeSelect.value = savedBackupType;
        await toggleBackupType(savedBackupType);
    } else {
        console.log('No saved backup type found, using default');
        backupTypeSelect.value = 'local'; // Valeur par défaut
        store.set('backupType', 'local');
        await toggleBackupType('local');
    }
    if (savedSchedule) {
        enableScheduleCheckbox.checked = true;
        scheduleSettings.classList.remove('hidden');
        if (scheduleFrequencySelect) scheduleFrequencySelect.value = savedSchedule.frequency;
        if (scheduleTimeHourSelect && scheduleTimeMinuteSelect && savedSchedule.time) {
            const [savedHour, savedMinute] = savedSchedule.time.split(':');
            scheduleTimeHourSelect.value = savedHour;
            scheduleTimeMinuteSelect.value = savedMinute;
        }
        if (scheduleDaySelect) scheduleDaySelect.value = savedSchedule.day;

        toggleScheduleDayVisibility();
    } else {
        toggleScheduleDayVisibility();
    }

    // Load saved options
    const savedAutoLaunch = store.get('autoLaunch', false);
    const savedMinimizeToTray = store.get('minimizeToTray', false);

    autoLaunchCheckbox.checked = savedAutoLaunch;
    minimizeToTrayCheckbox.checked = savedMinimizeToTray;
}

// Gestionnaires d'événements
document.getElementById('selectWowPath').addEventListener('click', async () => {
    const path = await ipcRenderer.invoke('select-wow-folder');
    if (path) {
        wowPathInput.value = path;
        store.set('wowPath', path);
    }
});

document.getElementById('selectBackupPath').addEventListener('click', async () => {
    const path = await ipcRenderer.invoke('select-backup-folder');
    if (path) {
        backupPathInput.value = path;
        store.set('backupPath', path);
    }
});

gameVersionSelect.addEventListener('change', () => {
    console.log('Game version changed to:', gameVersionSelect.value);
    store.set('gameVersion', gameVersionSelect.value);
});

backupTypeSelect.addEventListener('change', async (e) => {
    const selectedType = e.target.value;
    console.log('Backup type changed to:', selectedType);
    await toggleBackupType(selectedType);
    store.set('backupType', selectedType);
    // Sauvegarder également dans les options
    const currentOptions = store.get('options', {});
    store.set('options', { ...currentOptions, backupType: selectedType });
});

async function toggleBackupType(type) {
    console.log('Toggling backup type to:', type);
    localBackupSettings.style.display = type === 'local' ? 'block' : 'none';
    
    if (type === 'drive') {
        const isAuthenticated = await ipcRenderer.invoke('check-google-auth');
        if (!isAuthenticated) {
            await authenticateGoogle();
        }
    }
}

async function authenticateGoogle() {
    try {
        const authUrl = await ipcRenderer.invoke('get-google-auth-url');
        
        // Ouvrir une fenêtre de dialogue pour afficher l'URL
        const code = await new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'auth-dialog';
            dialog.innerHTML = `
                <div class="auth-content">
                    <h3>Authentification Google Drive</h3>
                    <p>1. Copiez cette URL et ouvrez-la dans votre navigateur :</p>
                    <input type="text" value="${authUrl}" readonly>
                    <p>2. Connectez-vous avec votre compte Google</p>
                    <p>3. Copiez le code d'autorisation et collez-le ci-dessous :</p>
                    <input type="text" id="authCode" placeholder="Code d'autorisation">
                    <div class="auth-buttons">
                        <button id="validateAuth">Valider</button>
                        <button id="cancelAuth">Annuler</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(dialog);
            
            const validateButton = document.getElementById('validateAuth');
            const authCodeInput = document.getElementById('authCode');
            
            validateButton.addEventListener('click', () => {
                const code = authCodeInput.value.trim();
                if (code) {
                    document.body.removeChild(dialog);
                    resolve(code);
                } else {
                    alert('Veuillez entrer le code d\'autorisation');
                }
            });
            
            document.getElementById('cancelAuth').addEventListener('click', () => {
                document.body.removeChild(dialog);
                resolve(null);
            });

            // Fermer la fenêtre en cliquant en dehors
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    document.body.removeChild(dialog);
                    resolve(null);
                }
            });

            // Permettre la validation avec la touche Entrée
            authCodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const code = authCodeInput.value.trim();
                    if (code) {
                        document.body.removeChild(dialog);
                        resolve(code);
                    } else {
                        alert('Veuillez entrer le code d\'autorisation');
                    }
                }
            });
        });
        
        if (code) {
            try {
                console.log('Attempting to validate Google Drive authentication code...');
                await ipcRenderer.invoke('validate-google-auth', code);
                console.log('Google Drive authentication successful!');
                statusMessage.textContent = 'Authentification Google Drive réussie !';
                await updateGoogleButtonText(); // Mettre à jour le texte du bouton après l'authentification
            } catch (error) {
                console.error('Error validating authentication code:', error);
                statusMessage.textContent = `Erreur lors de la validation du code : ${error.message}`;
            }
        } else {
            console.log('Google Drive authentication cancelled by user');
            statusMessage.textContent = 'Authentification annulée';
        }
    } catch (error) {
        statusMessage.textContent = `Erreur d'authentification: ${error.message}`;
    }
}

// Fonction pour mettre à jour la barre de progression
function updateProgress(progress, status) {
    progressBar.classList.remove('hidden');
    progressElement.style.width = `${progress}%`;
    statusMessage.textContent = status;
}

// Écouteurs d'événements pour la progression
ipcRenderer.on('backup-progress', (event, data) => {
    console.log('Received backup-progress IPC event:', data);
    updateProgress(data.progress, data.status);
});

ipcRenderer.on('restore-progress', (event, data) => {
    updateProgress(data.progress, data.status);
});

backupNowButton.addEventListener('click', async () => {
    if (!validateSettings()) return;

    try {
        console.log('Attempting to invoke start-backup with options:', {
            wowPath: wowPathInput.value,
            backupPath: backupPathInput.value,
            gameVersion: gameVersionSelect.value,
            backupType: backupTypeSelect.value
        });
        await ipcRenderer.invoke('start-backup', {
            wowPath: wowPathInput.value,
            backupPath: backupPathInput.value,
            gameVersion: gameVersionSelect.value,
            backupType: backupTypeSelect.value
        });
    } catch (error) {
        statusMessage.textContent = `Erreur: ${error.message}`;
        progressBar.classList.add('hidden');
    }
});

// Fonction utilitaire pour parser la date d'un backup local
function parseBackupDate(raw) {
    if (!raw) return 'Date inconnue';
    // Format attendu: 2024-03-14T12-34-56-789Z
    const match = raw.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
    if (match) {
        const [_, date, hours, minutes, seconds, milliseconds] = match;
        const iso = `${date}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
        const d = new Date(iso);
        if (!isNaN(d.getTime())) { // Vérifier si la date est valide
             return d.toLocaleString('fr-FR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
    // Si le format ne correspond pas ou si la date est invalide, retourner 'Date inconnue'
    return 'Date inconnue';
}

restoreBackupButton.addEventListener('click', async () => {
    if (!validateSettings()) return;

    try {
        const backupList = await ipcRenderer.invoke('get-backup-list', {
            backupPath: backupPathInput.value,
            gameVersion: gameVersionSelect.value,
            backupType: backupTypeSelect.value
        });

        if (backupList.length > 0) {
            // Afficher la liste des sauvegardes disponibles
            const backupSelect = document.createElement('div');
            backupSelect.className = 'backup-select-dialog';
            backupSelect.innerHTML = `
                <div class="backup-select-content">
                    <h3>Sélectionner une sauvegarde</h3>
                    <select id="backupSelect">
                        ${backupList.map(backup => {
                            let displayDate = backup.formattedDate;
                            if (!displayDate || displayDate === 'Invalid Date') {
                                const rawTimestamp = backup.name.split('_').pop().replace('.zip', '');
                                displayDate = parseBackupDate(rawTimestamp);
                            }
                            return `<option value="${backup.path}">${backup.name} (${displayDate})</option>`;
                        }).join('')}
                    </select>
                    <div class="backup-select-buttons">
                        <button id="confirmRestore">Restaurer</button>
                        <button id="cancelRestore">Annuler</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(backupSelect);
            
            document.getElementById('confirmRestore').addEventListener('click', async () => {
                const selectedPath = document.getElementById('backupSelect').value;
                document.body.removeChild(backupSelect);
                
                try {
                await ipcRenderer.invoke('restore-backup', {
                    backupPath: selectedPath,
                    wowPath: wowPathInput.value,
                    gameVersion: gameVersionSelect.value,
                        backupType: backupTypeSelect.value
                });
                } catch (error) {
                    statusMessage.textContent = `Erreur: ${error.message}`;
                progressBar.classList.add('hidden');
                }
            });
            
            document.getElementById('cancelRestore').addEventListener('click', () => {
                document.body.removeChild(backupSelect);
            });
        } else {
            statusMessage.textContent = 'Aucune sauvegarde trouvée';
        }
    } catch (error) {
        statusMessage.textContent = `Erreur: ${error.message}`;
    }
});

// Fonction pour mettre à jour la visibilité du sélecteur de jour
function toggleScheduleDayVisibility() {
    if (scheduleFrequencySelect && scheduleDaySelect) {
        const selectedFrequency = scheduleFrequencySelect.value;
        if (selectedFrequency === 'weekly') {
            scheduleDaySelect.classList.remove('hidden');
            console.log('Schedule day select shown.');
        } else {
            scheduleDaySelect.classList.add('hidden');
            console.log('Schedule day select hidden.');
        }
    }
}

// Gestionnaires d'événements
enableScheduleCheckbox.addEventListener('change', () => {
    scheduleSettings.classList.toggle('hidden', !enableScheduleCheckbox.checked);
    
    if (enableScheduleCheckbox.checked) {
        const schedule = {
            frequency: scheduleFrequencySelect ? scheduleFrequencySelect.value : 'daily',
            time: scheduleTimeHourSelect && scheduleTimeMinuteSelect ? `${scheduleTimeHourSelect.value}:${scheduleTimeMinuteSelect.value}` : '00:00',
            day: scheduleFrequencySelect && scheduleFrequencySelect.value === 'weekly' ? (scheduleDaySelect ? scheduleDaySelect.value : '0') : undefined
        };
        store.set('schedule', schedule);
        console.log('Renderer: Attempting to invoke set-schedule with:', schedule);
        ipcRenderer.invoke('set-schedule', schedule);
    } else {
        store.delete('schedule');
        console.log('Renderer: Attempting to invoke clear-schedule.');
        ipcRenderer.invoke('clear-schedule');
    }
});

// Ajouter des écouteurs d'événements pour les changements de sélecteurs de planification
if (scheduleFrequencySelect) {
    scheduleFrequencySelect.addEventListener('change', () => {
        toggleScheduleDayVisibility();
        if (enableScheduleCheckbox.checked) {
            const schedule = {
                frequency: scheduleFrequencySelect.value,
                time: scheduleTimeHourSelect && scheduleTimeMinuteSelect ? `${scheduleTimeHourSelect.value}:${scheduleTimeMinuteSelect.value}` : '00:00',
                day: scheduleFrequencySelect.value === 'weekly' ? (scheduleDaySelect ? scheduleDaySelect.value : '0') : undefined
            };
            store.set('schedule', schedule);
            console.log('Renderer: Schedule frequency changed, attempting to invoke set-schedule with:', schedule);
            ipcRenderer.invoke('set-schedule', schedule);
        }
    });
}

if (scheduleTimeHourSelect) {
    scheduleTimeHourSelect.addEventListener('change', () => {
        if (enableScheduleCheckbox.checked) {
            const schedule = {
                frequency: scheduleFrequencySelect ? scheduleFrequencySelect.value : 'daily',
                time: scheduleTimeMinuteSelect ? `${scheduleTimeHourSelect.value}:${scheduleTimeMinuteSelect.value}` : `${scheduleTimeHourSelect.value}:00`,
                day: scheduleFrequencySelect && scheduleFrequencySelect.value === 'weekly' ? (scheduleDaySelect ? scheduleDaySelect.value : '0') : undefined
            };
            store.set('schedule', schedule);
            console.log('Renderer: Schedule hour changed, attempting to invoke set-schedule with:', schedule);
            ipcRenderer.invoke('set-schedule', schedule);
        }
    });
}

if (scheduleTimeMinuteSelect) {
    scheduleTimeMinuteSelect.addEventListener('change', () => {
        if (enableScheduleCheckbox.checked) {
            const schedule = {
                frequency: scheduleFrequencySelect ? scheduleFrequencySelect.value : 'daily',
                time: scheduleTimeHourSelect ? `${scheduleTimeHourSelect.value}:${scheduleTimeMinuteSelect.value}` : `00:${scheduleTimeMinuteSelect.value}`,
                day: scheduleFrequencySelect && scheduleFrequencySelect.value === 'weekly' ? (scheduleDaySelect ? scheduleDaySelect.value : '0') : undefined
            };
            store.set('schedule', schedule);
            console.log('Renderer: Schedule minute changed, attempting to invoke set-schedule with:', schedule);
            ipcRenderer.invoke('set-schedule', schedule);
        }
    });
}

if (scheduleDaySelect) {
    scheduleDaySelect.addEventListener('change', () => {
        if (enableScheduleCheckbox.checked && scheduleFrequencySelect && scheduleFrequencySelect.value === 'weekly') {
            const schedule = {
                frequency: scheduleFrequencySelect.value,
                time: scheduleTimeHourSelect && scheduleTimeMinuteSelect ? `${scheduleTimeHourSelect.value}:${scheduleTimeMinuteSelect.value}` : '00:00',
                day: scheduleDaySelect.value
            };
            store.set('schedule', schedule);
            console.log('Renderer: Schedule day changed, attempting to invoke set-schedule with:', schedule);
            ipcRenderer.invoke('set-schedule', schedule);
        }
    });
}

// Validation des paramètres
function validateSettings() {
    if (!wowPathInput.value) {
        statusMessage.textContent = 'Veuillez sélectionner le dossier World of Warcraft';
        return false;
    }

    const backupType = backupTypeSelect.value;
    if (backupType === 'local' && !backupPathInput.value) {
        statusMessage.textContent = 'Veuillez sélectionner le dossier de sauvegarde';
        return false;
    }

    if (enableScheduleCheckbox.checked) {
        if (!scheduleTimeHourSelect.value || !scheduleTimeMinuteSelect.value) {
            statusMessage.textContent = 'Veuillez sélectionner une heure et des minutes valides pour la planification';
            return false;
        }
    }

    return true;
}

// Initialisation
//loadSavedSettings(); // Moved inside DOMContentLoaded

// Wait for the DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired.');
    // Initialize Option elements after DOM is ready
    optionsModal = document.getElementById('optionsModal');
    console.log('optionsModal element found:', optionsModal);

    if (!optionsModal) {
        console.error('Error: Options modal element not found!');
        return; // Stop initialization if modal not found
    }

    optionsCloseButton = optionsModal.querySelector('.close-button');
    console.log('optionsCloseButton element found:', optionsCloseButton);

    autoLaunchCheckbox = document.getElementById('autoLaunch');
    console.log('autoLaunchCheckbox element found:', autoLaunchCheckbox);

    minimizeToTrayCheckbox = document.getElementById('minimizeToTray');
    console.log('minimizeToTrayCheckbox element found:', minimizeToTrayCheckbox);

    googleLogoutButton = document.getElementById('googleLogoutButton');
    console.log('googleLogoutButton element found:', googleLogoutButton);

    // Initialisation des éléments d'options de sauvegarde
    limitBackupsCheckbox = document.getElementById('limitBackups');
    console.log('limitBackupsCheckbox element found:', limitBackupsCheckbox);
    backupLimitCountSelect = document.getElementById('backupLimitCount');
    console.log('backupLimitCountSelect element found:', backupLimitCountSelect);

    // Initialize Title bar elements
    minimizeBtn = document.getElementById('minimizeBtn');
    closeBtn = document.getElementById('closeBtn');

    console.log('Title bar elements found:', { minimizeBtn, closeBtn });

    // Load saved settings and options
loadSavedSettings();
    console.log('Saved settings and options loaded.');

    // Attach Option modal event listeners
    const optionsBtn = document.getElementById('optionsBtn');
    if (optionsBtn) {
        optionsBtn.addEventListener('click', () => {
            console.log('Options button clicked.');
            console.log('Current optionsModal classes before show:', optionsModal.classList.value);

            // Tenter une réinitialisation forcée de l'affichage avec un court délai
            optionsModal.style.display = 'none'; // Cacher de force

            setTimeout(() => {
                optionsModal.classList.remove('hidden'); // S'assurer que la classe hidden est bien retirée
                optionsModal.style.display = 'flex'; // Afficher en utilisant flex
                initializeGoogleButton(); // Réinitialiser le bouton Google à chaque ouverture des options

                console.log('Current optionsModal classes after show:', optionsModal.classList.value);
                console.log('optionsModal display style after show:', optionsModal.style.display);
                console.log('optionsModal z-index after show:', optionsModal.style.zIndex);
                console.log('optionsModal is hidden:', optionsModal.classList.contains('hidden'));
                console.log('optionsModal offsetWidth:', optionsModal.offsetWidth);
            }, 50);
        });
        console.log('Options button listener attached.');
    } else {
        console.error('Error: Options button not found!');
    }

    if (optionsCloseButton) {
        optionsCloseButton.addEventListener('click', () => {
            console.log('Options close button clicked, hiding modal.');
            // Cacher la modale en manipulant directement le style display
            optionsModal.style.display = 'none';

            // optionsModal.classList.add('hidden'); // Cette ligne n'est plus nécessaire si on utilise style.display
            // Retirer la classe qui force l'affichage si elle était ajoutée (pas nécessaire si on gère par style.display)
            optionsModal.classList.remove('options-modal-visible');

            saveOptions(); // Sauvegarder les options lors de la fermeture de la modale
        });
        console.log('Options close button listener attached.');
    } else {
         console.warn('Warning: Options close button not found, cannot attach listener.');
    }

    // Fermer la modale en cliquant en dehors
    optionsModal.addEventListener('click', (e) => {
        if (e.target === optionsModal) {
            console.log('Clicked outside modal, hiding modal.');
            // Cacher la modale en manipulant directement le style display
            optionsModal.style.display = 'none';

            // optionsModal.classList.add('hidden'); // Cette ligne n'est plus nécessaire si on utilise style.display
            // Retirer la classe qui force l'affichage si elle était ajoutée (pas nécessaire si on gère par style.display)
            optionsModal.classList.remove('options-modal-visible');
        }
    });
    console.log('Click outside modal listener attached.');

    // Attach Option checkbox/button event listeners
    if (autoLaunchCheckbox) {
        autoLaunchCheckbox.addEventListener('change', async () => {
            console.log('Auto launch checkbox changed.');
            const isEnabled = autoLaunchCheckbox.checked;
            store.set('autoLaunch', isEnabled);
            try {
                const result = await ipcRenderer.invoke('set-auto-launch', isEnabled);
                if (!result.success) {
                    console.warn('Auto launch setting failed:', result.error);
                    // Ne pas afficher d'alerte pour les erreurs de registre déjà désactivé
                    if (!result.error.includes('n\'a pas trouvé la clé')) {
                        alert(`Failed to set auto launch: ${result.error}`);
                    }
                    // Revert checkbox state if IPC call fails
                    autoLaunchCheckbox.checked = !isEnabled;
                    store.set('autoLaunch', !isEnabled);
                } else {
                    console.log(`Auto launch set to: ${isEnabled}`);
                }
            } catch (error) {
                console.error('Failed to set auto launch:', error);
                alert(`Failed to set auto launch: ${error.message}`);
                // Revert checkbox state if IPC call fails
                autoLaunchCheckbox.checked = !isEnabled;
                store.set('autoLaunch', !isEnabled);
            }
        });
        console.log('Auto launch listener attached.');
    } else {
        console.warn('Warning: Auto launch checkbox not found, cannot attach listener.');
    }

     if (minimizeToTrayCheckbox) {
        minimizeToTrayCheckbox.addEventListener('change', () => {
            console.log('Minimize to tray checkbox changed.');
            const isEnabled = minimizeToTrayCheckbox.checked;
            store.set('minimizeToTray', isEnabled);
            console.log(`Minimize to tray on close set to: ${isEnabled}`);
            // The actual minimize logic is handled in main.js based on the stored value
        });
         console.log('Minimize to tray listener attached.');
    } else {
         console.warn('Warning: Minimize to tray checkbox not found, cannot attach listener.');
    }

    // Fonction pour initialiser les événements du bouton Google
    function initializeGoogleButton() {
        if (googleLogoutButton) {
            // Supprimer tous les écouteurs d'événements existants
            const newButton = googleLogoutButton.cloneNode(true);
            googleLogoutButton.parentNode.replaceChild(newButton, googleLogoutButton);
            googleLogoutButton = newButton;

            // Ajouter un seul écouteur d'événements
            googleLogoutButton.addEventListener('click', async () => {
                const isAuthenticated = await ipcRenderer.invoke('check-google-auth');
                if (isAuthenticated) {
                    const confirmed = confirm('Êtes-vous sûr de vouloir vous déconnecter de Google Drive ?');
                    if (confirmed) {
                        await ipcRenderer.invoke('google-logout');
                        alert('Déconnecté de Google Drive.');
                        await updateGoogleButtonText();
                    }
                } else {
                    try {
                        await authenticateGoogle();
                        await updateGoogleButtonText();
                    } catch (error) {
                        console.error('Erreur lors de l\'authentification Google:', error);
                        alert('Erreur lors de la connexion à Google Drive : ' + error.message);
                    }
                }
            });
        }
    }

    // Attach Title bar event listeners
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            console.log('Minimize button clicked.');
            ipcRenderer.invoke('minimize-window');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            console.log('Close button clicked.');
            ipcRenderer.invoke('close-window');
        });
    }

    // Initialisation: s'assurer que la modale est cachée au démarrage en utilisant style.display
    console.log('Attempting to hide options modal initially.');
    // optionsModal.classList.add('hidden'); // Utiliser style.display à la place
    optionsModal.style.display = 'none';
    console.log('optionsModal class list after adding hidden:', optionsModal.classList.value);
    console.log('optionsModal display style after initial hide:', optionsModal.style.display);

    // Écouteur pour la limitation des sauvegardes
    if (limitBackupsCheckbox && backupLimitCountSelect) {
        limitBackupsCheckbox.addEventListener('change', () => {
            console.log('limitBackupsCheckbox change event fired.');
            const isChecked = limitBackupsCheckbox.checked;
            backupLimitCountSelect.disabled = !isChecked;
            console.log('backupLimitCountSelect disabled set to:', backupLimitCountSelect.disabled);
            saveOptions();
        });
        console.log('limitBackupsCheckbox change listener attached.');
    } else {
        console.warn('Warning: limitBackupsCheckbox or backupLimitCountSelect not found, cannot attach change listener.');
    }

    if (backupLimitCountSelect) {
        backupLimitCountSelect.addEventListener('change', saveOptions);
        console.log('backupLimitCountSelect change listener attached.');
    } else {
        console.warn('Warning: backupLimitCountSelect not found, cannot attach change listener.');
    }
});

document.getElementById('backupsBtn').addEventListener('click', async () => {
    try {
        // Fermer la modale des options si elle est ouverte
        if (optionsModal && !optionsModal.classList.contains('hidden')) {
            optionsModal.classList.add('hidden');
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Gestion des sauvegardes</h2>
                    <div class="header-actions">
                        <button class="refresh-button"><i class="fas fa-sync-alt"></i></button>
                        <button class="close-button">&times;</button>
                    </div>
                </div>
                <div class="modal-body">
                    <div id="backupItems" class="backup-items"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Fonction pour charger les sauvegardes
        const loadBackups = async () => {
            const backupItems = modal.querySelector('#backupItems');
            backupItems.innerHTML = '<div class="loading">Loading backups...</div>';
            
            try {
                const options = {
                    backupPath: store.get('backupPath'),
                    gameVersion: gameVersionSelect.value,
                    backupType: backupTypeSelect.value
                };
                
                console.log('Options sent for backup retrieval:', options);
                const backups = await ipcRenderer.invoke('get-backup-list', options);
                console.log('Backups received:', backups);
                
                // Vider la liste existante
                backupItems.innerHTML = '';
                
                if (!backups || backups.length === 0) {
                    console.log('No backups found');
                    backupItems.innerHTML = '<div class="no-backups">No backups found</div>';
                    return;
                }
                
                // Ajouter chaque sauvegarde à la liste
                backups.forEach(backup => {
                    console.log('Adding backup to list:', backup); // Log l'objet backup complet
                    
                    let displayDate = backup.formattedDate;
                    console.log('Initial displayDate (from formattedDate):', displayDate); // Log la valeur initiale

                    if (!displayDate || displayDate === 'Invalid Date') {
                        console.log('formattedDate is invalid, using fallback parser.'); // Log le déclenchement du fallback
                        const rawTimestamp = backup.name.split('_').pop().replace('.zip', '');
                        console.log('rawTimestamp extracted from filename:', rawTimestamp); // Log le timestamp brut
                        displayDate = parseBackupDate(rawTimestamp);
                        console.log('displayDate after fallback parsing:', displayDate); // Log le résultat du fallback
                    }
                    
                    const backupItem = document.createElement('div');
                    backupItem.className = 'backup-item';
                    
                    const backupInfo = document.createElement('div');
                    backupInfo.className = 'backup-info';
                    
                    const backupName = document.createElement('div');
                    backupName.className = 'backup-name';
                    backupName.textContent = backup.name;
                    
                    const backupDetails = document.createElement('div');
                    backupDetails.className = 'backup-details';
                    backupDetails.textContent = `${displayDate} - ${backup.formattedSize}`;
                    
                    backupInfo.appendChild(backupName);
                    backupInfo.appendChild(backupDetails);
                    
                    const backupActions = document.createElement('div');
                    backupActions.className = 'backup-actions';
                    
                    const restoreButton = document.createElement('button');
                    restoreButton.className = 'restore-backup';
                    restoreButton.textContent = 'Restore';
                    restoreButton.addEventListener('click', () => {
                        document.body.removeChild(modal);
                        restoreBackup(backup);
                    });
                    
                    const deleteButton = document.createElement('button');
                    deleteButton.className = 'delete-backup';
                    deleteButton.textContent = 'Delete';
                    deleteButton.addEventListener('click', () => {
                        document.body.removeChild(modal);
                        deleteBackup(backup);
                    });
                    
                    backupActions.appendChild(restoreButton);
                    backupActions.appendChild(deleteButton);
                    
                    backupItem.appendChild(backupInfo);
                    backupItem.appendChild(backupActions);
                    
                    backupItems.appendChild(backupItem);
                });
            } catch (error) {
                console.error('Error loading backups:', error);
                backupItems.innerHTML = `<div class="error-message">Error loading backups: ${error.message}</div>`;
            }
        };

        // Charger les sauvegardes initiales
        await loadBackups();
        
        // Gérer la fermeture de la modale
        const closeButton = modal.querySelector('.close-button');
        closeButton.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // Gérer le rafraîchissement
        const refreshButton = modal.querySelector('.refresh-button');
        refreshButton.addEventListener('click', loadBackups);
        
        // Fermer la modale en cliquant en dehors
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    } catch (error) {
        console.error('Error in backup list modal:', error);
        alert('Error displaying backup list: ' + error.message);
    }
});

async function deleteBackup(backup) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer la sauvegarde "${backup.name}" ?`)) {
        try {
            const options = {
                backupType: store.get('backupType')
            };
            
            await ipcRenderer.invoke('delete-backup', options, backup.path);
            
            // Recharger la liste des sauvegardes
            document.getElementById('backupsBtn').click();
            
            alert('Sauvegarde supprimée avec succès !');
        } catch (error) {
            console.error('Error deleting backup:', error);
            alert('Erreur lors de la suppression de la sauvegarde : ' + error.message);
        }
    }
}

async function restoreBackup(backup) {
    if (confirm(`Êtes-vous sûr de vouloir restaurer la sauvegarde "${backup.name}" ?`)) {
        try {
            const options = {
                backupPath: backup.path,
                wowPath: store.get('wowPath'),
                gameVersion: store.get('gameVersion'),
                backupType: store.get('backupType')
            };
            
            await ipcRenderer.invoke('restore-backup', options);
            alert('Restauration terminée avec succès !');
        } catch (error) {
            console.error('Error restoring backup:', error);
            alert('Erreur lors de la restauration : ' + error.message);
        }
    }
}

console.log('Script renderer.js loaded.');
console.log('Waiting for DOMContentLoaded...');

// Charger les options sauvegardées au démarrage
async function loadOptions() {
    console.log('Loading options...');
    try {
        const options = await ipcRenderer.invoke('get-options');
        console.log('Loaded options:', options);
        
        // Options de lancement
        if (autoLaunchCheckbox) autoLaunchCheckbox.checked = options.autoLaunch;
        if (minimizeToTrayCheckbox) minimizeToTrayCheckbox.checked = options.minimizeToTray;
        
        // Options de sauvegardes
        if (limitBackupsCheckbox) {
            limitBackupsCheckbox.checked = options.limitBackups;
            console.log('limitBackupsCheckbox initial checked state:', limitBackupsCheckbox.checked);
        }
        if (backupLimitCountSelect) {
            backupLimitCountSelect.value = options.backupLimitCount;
            backupLimitCountSelect.disabled = !options.limitBackups;
            console.log('backupLimitCountSelect initial value:', backupLimitCountSelect.value);
            console.log('backupLimitCountSelect initial disabled state:', backupLimitCountSelect.disabled);
        }

        // TODO: Charger l'état d'authentification Google et les autres options si nécessaire

    } catch (error) {
        console.error('Failed to load options:', error);
    }
}

// Sauvegarder les options
async function saveOptions() {
    console.log('Saving options...');
    const options = {
        autoLaunch: autoLaunchCheckbox.checked,
        minimizeToTray: minimizeToTrayCheckbox.checked,
        limitBackups: limitBackupsCheckbox.checked,
        backupLimitCount: parseInt(backupLimitCountSelect.value, 10) // S'assurer que la valeur est un nombre
    };
    console.log('Options to save:', options);
    try {
        await ipcRenderer.invoke('set-options', options);
        console.log('Options saved successfully.');
        // Ne pas appeler set-auto-launch ici car il est déjà géré par l'événement change
        // TODO: Appliquer les autres options si nécessaire
    } catch (error) {
        console.error('Failed to save options:', error);
    }
}

// Ajouter les écouteurs d'événements après le chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    
    // TODO: Vérifier si c'est le bon endroit pour charger les options ou si ça doit être après show() de la fenêtre
    loadOptions(); // Charger les options au démarrage

    // Fermer la modale des options
    optionsCloseButton.addEventListener('click', () => {
        optionsModal.classList.add('hidden');
        saveOptions(); // Sauvegarder les options lors de la fermeture de la modale
    });

    // Écouteurs pour les changements d'options
    autoLaunchCheckbox.addEventListener('change', saveOptions);
    minimizeToTrayCheckbox.addEventListener('change', saveOptions);
    
    // Écouteur pour la limitation des sauvegardes
    if (limitBackupsCheckbox && backupLimitCountSelect) {
        limitBackupsCheckbox.addEventListener('change', () => {
            console.log('limitBackupsCheckbox change event fired.');
            const isChecked = limitBackupsCheckbox.checked;
            backupLimitCountSelect.disabled = !isChecked;
            console.log('backupLimitCountSelect disabled set to:', backupLimitCountSelect.disabled);
            saveOptions();
        });
        console.log('limitBackupsCheckbox change listener attached.');
    } else {
        console.warn('Warning: limitBackupsCheckbox or backupLimitCountSelect not found, cannot attach change listener.');
    }

    if (backupLimitCountSelect) {
        backupLimitCountSelect.addEventListener('change', saveOptions);
        console.log('backupLimitCountSelect change listener attached.');
    } else {
        console.warn('Warning: backupLimitCountSelect not found, cannot attach change listener.');
    }

    // ... existing code ...
});

// Fonction pour ouvrir la modale des options
function openOptionsModal() {
    // Fermer toute autre modale ouverte
    const existingModal = document.querySelector('.modal:not(#optionsModal)');
    if (existingModal) {
        document.body.removeChild(existingModal);
    }
    
    // Afficher la modale des options
    optionsModal.classList.remove('hidden');
}

// Ajouter l'écouteur d'événements pour le bouton des options
document.getElementById('optionsBtn').addEventListener('click', openOptionsModal);

// Fonction pour mettre à jour le texte du bouton Google
async function updateGoogleButtonText() {
    const isAuthenticated = await ipcRenderer.invoke('check-google-auth');
    if (googleLogoutButton) {
        if (isAuthenticated) {
            googleLogoutButton.innerHTML = '<i class="fas fa-sign-out-alt"></i> Se déconnecter de Google Drive';
            googleLogoutButton.id = 'googleLogoutButton';
        } else {
            googleLogoutButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter à Google Drive';
            googleLogoutButton.id = 'googleLoginButton';
        }
    }
}

// Mettre à jour le texte du bouton au chargement
document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...
    
    // Mettre à jour le texte du bouton Google
    await updateGoogleButtonText();
    
    // Modifier l'écouteur d'événements du bouton Google
    if (googleLogoutButton) {
        googleLogoutButton.addEventListener('click', async () => {
            const isAuthenticated = await ipcRenderer.invoke('check-google-auth');
            if (isAuthenticated) {
                const confirmed = confirm('Êtes-vous sûr de vouloir vous déconnecter de Google Drive ?');
                if (confirmed) {
                    await ipcRenderer.invoke('google-logout');
                    alert('Déconnecté de Google Drive.');
                    await updateGoogleButtonText();
                }
            } else {
                try {
                    await authenticateGoogle();
                    await updateGoogleButtonText();
                } catch (error) {
                    console.error('Erreur lors de l\'authentification Google:', error);
                    alert('Erreur lors de la connexion à Google Drive : ' + error.message);
                }
            }
        });
    }
    // ... existing code ...
});

// Gestionnaires d'événements pour les sauvegardes planifiées
ipcRenderer.on('scheduled-backup-start', (event, data) => {
    statusMessage.textContent = data.message;
    progressBar.classList.remove('hidden');
    progressElement.style.width = '0%';
});

ipcRenderer.on('scheduled-backup-complete', (event, data) => {
    statusMessage.textContent = data.message;
    progressElement.style.width = '100%';
    setTimeout(() => {
        progressBar.classList.add('hidden');
    }, 3000);
});

ipcRenderer.on('scheduled-backup-error', (event, data) => {
    statusMessage.textContent = data.message;
    progressBar.classList.add('hidden');
});
