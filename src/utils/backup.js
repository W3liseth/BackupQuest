const fs = require('fs-extra');
const path = require('path');
const schedule = require('node-schedule');
const archiver = require('archiver');
const googleAuth = require('./googleAuth');
const os = require('os');
const { app } = require('electron');
const ElectronStore = require('electron-store');

class BackupManager {
    constructor() {
        this.scheduledJobs = new Map();
        this.store = new ElectronStore();
        this.webContents = null;
    }

    // Méthode pour définir les webContents (appelée depuis main.js)
    setWebContents(webContents) {
        this.webContents = webContents;
        console.log('BackupManager received webContents.');
    }

    // Fonction utilitaire pour calculer la taille totale d'un dossier
    async calculateFolderSize(folderPath) {
        let totalSize = 0;
        const files = await fs.readdir(folderPath);
        
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            const stats = await fs.stat(filePath);
            
            if (stats.isDirectory()) {
                totalSize += await this.calculateFolderSize(filePath);
            } else {
                totalSize += stats.size;
            }
        }
        
        return totalSize;
    }

    // Fonction utilitaire pour compter récursivement les fichiers dans un dossier
    async countFiles(folderPath) {
        let totalFiles = 0;
        try {
            const files = await fs.readdir(folderPath);
            for (const file of files) {
                const filePath = path.join(folderPath, file);
                const stats = await fs.stat(filePath);
                if (stats.isDirectory()) {
                    totalFiles += await this.countFiles(filePath);
                } else {
                    totalFiles++;
                }
            }
        } catch (error) {
            console.error(`Error counting files in ${folderPath}:`, error);
            // Continuer même en cas d'erreur sur un dossier, mais le compte pourrait être incomplet
        }
        return totalFiles;
    }

    // Fonction pour formater la durée
    formatDuration(seconds) {
        if (seconds < 60) {
            return `${Math.round(seconds)} second${Math.round(seconds) > 1 ? 's' : ''}`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.round(seconds % 60);
            return `${minutes} minute${minutes > 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
    }

    // Fonction pour formater la taille
    formatSize(bytes) {
        const units = ['o', 'Ko', 'Mo', 'Go'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    async createBackup(options, progressCallback) {
        console.log('Starting backup creation in backup.js...', options);
        const { wowPath, backupPath, gameVersion, backupType } = options;
        
        if (!wowPath) {
            throw new Error('World of Warcraft path is not configured.');
        }

        // Déterminer les dossiers de jeu spécifiques à sauvegarder
        const gameFolders = {
            retail: ['_retail_', 'Classic'], // Inclure Classic pour Retail WoW
            classic: ['_classic_'],
        };

        const foldersToBackup = [];
        // Obtenir le chemin parent de _retail_ ou _classic_. Si le chemin WoW est déjà à la racine de _retail_ ou _classic_, baseWowPath sera simplement wowPath.
        // On part du principe que wowPath pointe vers le dossier principal de WoW (ex: .../World of Warcraft/)
        // ou directement vers _retail_ ou _classic_.
        let baseWowPath;
        const retailPathCheck = path.join(wowPath, '_retail_');
        const classicPathCheck = path.join(wowPath, 'Classic'); // Note: Classic est souvent un dossier peer de _retail_

        if (await fs.pathExists(retailPathCheck)) {
            baseWowPath = wowPath;
        } else if (await fs.pathExists(classicPathCheck)) {
             baseWowPath = wowPath;
        } else {
            // Si ni _retail_ ni Classic ne sont directement dans wowPath, supposer que wowPath pointe déjà vers l'un d'eux
             baseWowPath = wowPath;
        }
        console.log('Calculated base WoW path:', baseWowPath);

        const requiredSubfolders = ['Interface', 'WTF'];

        if (gameFolders[gameVersion]) {
            for (const folderName of gameFolders[gameVersion]) { // folderName sera '_retail_' ou 'Classic'
                const gameVersionFolderPath = path.join(baseWowPath, folderName);
                console.log('Checking game version folder path:', gameVersionFolderPath);

                if (await fs.pathExists(gameVersionFolderPath)) {
                    for (const subfolder of requiredSubfolders) { // subfolder sera 'Interface' ou 'WTF'
                        const fullFolderPath = path.join(gameVersionFolderPath, subfolder);
                        console.log('Checking required subfolder path:', fullFolderPath);
                        if (await fs.pathExists(fullFolderPath)) {
                            foldersToBackup.push(fullFolderPath);
                            console.log(`Adding folder to backup: ${fullFolderPath}`);
                        } else {
                            console.log(`Warning: Required subfolder not found, skipping: ${fullFolderPath}`);
                        }
                    }
                } else {
                     console.log(`Warning: Game version folder not found, skipping: ${gameVersionFolderPath}`);
                }
            }
        } else {
            throw new Error(`Invalid game version specified: ${gameVersion}`);
        }

        if (foldersToBackup.length === 0) {
            console.error('No valid Interface or WTF folders found to backup.'); // Log mis à jour
            throw new Error('No valid Interface or WTF folders found to backup for the specified game version.');
        }

        // Calculer la taille totale des dossiers à sauvegarder pour une progression plus précise
        let totalSize = 0;
        let totalFiles = 0; // Cette variable comptera maintenant tous les fichiers
        console.log('Calculating total size and file count...');
        for (const folder of foldersToBackup) {
            // Calculer la taille du dossier
            const folderSize = await this.calculateFolderSize(folder);
            totalSize += folderSize;

            // Compter les fichiers dans le dossier et ajouter au total
            const fileCountInFolder = await this.countFiles(folder);
            totalFiles += fileCountInFolder;
            console.log(`Folder ${folder}: ${fileCountInFolder} files, ${this.formatSize(folderSize)}`);
        }
        console.log(`Total size to backup: ${this.formatSize(totalSize)}, Total files: ${totalFiles}`); // Log mis à jour

        // Générer un nom de fichier unique basé sur la date et l'heure
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const backupFileName = `wow_${gameVersion}_${timestamp}.zip`;

        // Déterminer le chemin de destination temporaire ou final du fichier zip
        let zipPath;
        let finalBackupPath;

        if (backupType === 'local') {
            if (!backupPath) {
                throw new Error('Local backup path is not configured.');
            }
            finalBackupPath = path.join(backupPath, backupFileName);
            zipPath = finalBackupPath; // Pour sauvegarde locale, le zip est créé directement à destination
            await fs.ensureDir(backupPath); // S'assurer que le dossier de destination existe
        } else if (backupType === 'drive') {
            const tempDir = path.join(app.getPath('userData'), 'temp');
            await fs.ensureDir(tempDir);
            zipPath = path.join(tempDir, backupFileName); // Pour Google Drive, créer un fichier temporaire
            finalBackupPath = backupFileName; // Le nom du fichier dans Google Drive
            console.log(`Using temporary path for zip: ${zipPath}`);
        }

        console.log(`Creating zip file at: ${zipPath}`);

        // Créer un stream d'écriture pour le fichier zip
        const output = fs.createWriteStream(zipPath);
        console.log('Output stream created.'); // Log stream creation
        const archive = archiver('zip', {
            zlib: { level: 9 } // Niveau de compression
        });
        console.log('Archiver created.'); // Log archiver creation

        // Pipe l'archive vers le stream de sortie
        archive.pipe(output);
        console.log('Archiver piped to output stream.'); // Log piping

        // Gérer les erreurs d'archivage
        archive.on('warning', function(err) {
            console.warn('Archiver warning:', err.code, err.message);
            if (err.code === 'ENOENT') {
                console.warn('Archiver warning: Entry not found', err);
            } else {
                console.error('Archiver error (unhandled warning):', err);
            }
        });

        archive.on('error', function(err) {
            console.error('Archiver error:', err);
            throw new Error(`Archiver error: ${err.message}`);
        });

        let processedBytes = 0;
        let processedFiles = 0;
        const startTime = Date.now();

        // Rapporter la progression basée sur les octets traités et les fichiers traités
        archive.on('progress', (progressData) => {
            // Le champ entries.processed ne reflète pas toujours les octets
            // Utilisons archive.pointer() pour les octets traités si disponible
            processedBytes = archive.pointer ? archive.pointer() : (processedBytes + (progressData.fs.processedBytes || 0));

            // Mettre à jour le nombre de fichiers traités
            if (progressData.entries && progressData.entries.processed) {
                 processedFiles = progressData.entries.processed;
            }

            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const bytesPerSecond = elapsedSeconds > 0 ? processedBytes / elapsedSeconds : 0;
            const remainingBytes = totalSize - processedBytes;
            const estimatedTimeRemainingSeconds = bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : Infinity;

            // Calculer la progression de la compression (utiliser jusqu'à 90% de la barre)
            const compressionProgress = totalSize > 0 ? (processedBytes / totalSize) * 90 : 0;

            // Calculer la progression des fichiers (utiliser les 10% restants de la barre)
            const fileProgress = totalFiles > 0 ? (processedFiles / totalFiles) * 10 : 0;

            // Calculer la progression globale
            const overallProgress = Math.min(100, compressionProgress + fileProgress); // S'assurer que la progression ne dépasse pas 100

            const status = `Compression en cours : ${processedFiles}/${totalFiles} fichiers (${this.formatSize(processedBytes)} / ${this.formatSize(totalSize)})... ${this.formatDuration(estimatedTimeRemainingSeconds)} restantes estimées.`;

            // Rapporter la progression et le statut
            if (progressCallback) {
                // S'assurer que la progression est un nombre valide et non NaN ou Infinity
                const finalProgress = isFinite(overallProgress) ? overallProgress : 0;
                progressCallback(finalProgress, status);
            }
        });

        // Quand l'archivage est terminé
        output.on('close', async () => {
            console.log('Output stream closed, archive finalized.', `Total bytes: ${archive.pointer()}`);

            // Traitement post-compression (upload Google Drive ou finalisation locale)
        if (backupType === 'drive') {
                console.log('Uploading to Google Drive...');
                // Mettre à jour le statut pendant l'upload (les 10% restants)
                if (progressCallback) {
                    progressCallback(90, 'Uploading to Google Drive...');
                }
                try {
                    await googleAuth.uploadFile(zipPath, finalBackupPath, 'application/zip');
                    console.log('Upload to Google Drive complete.');
                    if (progressCallback) {
                        progressCallback(100, 'Upload Google Drive terminé !');
                    }
                } catch (uploadError) {
                    console.error('Google Drive upload failed:', uploadError);
                    if (progressCallback) {
                        progressCallback(90, `Upload Google Drive failed: ${uploadError.message}`);
            }
                    throw new Error(`Failed to upload to Google Drive: ${uploadError.message}`);
                } finally {
                    // Nettoyer le fichier temporaire après l'upload
                    console.log(`Cleaning up temporary file: ${zipPath}`);
                    await fs.remove(zipPath);
                    const tempDir = path.join(app.getPath('userData'), 'temp');
                    // Ajouter un petit délai pour laisser le temps à l'UI de se mettre à jour avant de vider le dossier
                    await new Promise(resolve => setTimeout(resolve, 200));
                    try {
                        // Vider uniquement le dossier temporaire de BackupQuest
                        const tempDirContents = await fs.readdir(tempDir);
                        // Supprimer uniquement les fichiers et sous-dossiers directement dans le dossier temp
                        for (const item of tempDirContents) {
                            await fs.remove(path.join(tempDir, item));
                        }
                        console.log(`Cleaned temporary directory: ${tempDir}`);
                    } catch (cleanError) {
                        console.error('Error cleaning temporary directory:', cleanError);
                    }
                }
            } else if (backupType === 'local') {
                // Pour sauvegarde locale, la création du zip est la fin de l'opération
                console.log('Local backup created.');
                if (progressCallback) {
                    // Ajouter un petit délai pour laisser le temps à l'UI de se mettre à jour
                    await new Promise(resolve => setTimeout(resolve, 200));
                    progressCallback(100, 'Sauvegarde locale terminée !');
                }
            }

            // *** Appliquer la limite de sauvegardes après une sauvegarde réussie ***
            await this.applyBackupLimit(options);

            // Ajouter un délai à la fin pour que le message de statut final soit visible
            await new Promise(resolve => setTimeout(resolve, 2000));

            return finalBackupPath;
        });

        // Piper les dossiers vers l'archive
        for (const folder of foldersToBackup) {
            console.log(`Attempting to archive folder: ${folder}`); // Log avant ajout du dossier
            // Ajouter le contenu du dossier, en utilisant le nom du dossier comme racine dans le zip
            const folderNameInZip = path.basename(folder);
            try {
                archive.directory(folder, folderNameInZip);
                console.log(`Folder ${folder} added to archive with name ${folderNameInZip}.`); // Log succès ajout
            } catch (addError) {
                console.error(`Failed to add folder ${folder} to archive:`, addError); // Log échec ajout
                // Ne pas rejecter immédiatement ici, l'erreur sera peut-être capturée par archive.on('error')
            }
        }

        // Finaliser l'archive (cela va écrire le contenu dans le stream de sortie)
        console.log('Finalizing archive...'); // Log before finalize
        archive.finalize();
        console.log('archive.finalize() called.'); // Log after finalize

        // On retourne une promesse qui se résoudra quand l'événement 'close' ou 'error' de l'output stream se déclenchera
        return new Promise((resolve, reject) => {
            output.on('close', () => resolve(finalBackupPath));
            output.on('error', (err) => {
                console.error('Output stream error:', err);
                reject(new Error(`Output stream error: ${err.message}`));
            });
            archive.on('error', reject); // S'assurer que les erreurs d'archivage sont aussi remontées
        });
    }

    async restoreBackup(options, progressCallback) {
        const { backupPath, wowPath, gameVersion, backupType } = options;
        
        // Créer un dossier temporaire pour l'extraction
        const tempDir = path.join(path.dirname(backupPath), 'temp_restore');
        await fs.ensureDir(tempDir);
        
        try {
        if (backupType === 'drive') {
                progressCallback(10, 'Downloading from Google Drive...');
                
            // Vérifier l'authentification
            if (!await googleAuth.isAuthenticated()) {
                    throw new Error('Not authenticated with Google Drive');
            }

            // Télécharger le fichier depuis Google Drive
            const zipPath = path.join(tempDir, 'backup.zip');
            await googleAuth.downloadFile(backupPath, zipPath);
            
                progressCallback(30, 'Extracting files...');
            // Extraire le ZIP
            await this.extractZipArchive(zipPath, tempDir);
            } else {
                progressCallback(30, 'Extracting files...');
                // Extraire l'archive ZIP locale
                await this.extractZipArchive(backupPath, tempDir);
            }
            
            progressCallback(60, 'Restoring folders...');
            // Restaurer les dossiers
            await this.restoreFolders(tempDir, wowPath, gameVersion);
            progressCallback(100, 'Restoration completed!');
        } finally {
            // Nettoyer le dossier temporaire
            await fs.remove(tempDir);
        }
    }

    async restoreFolders(sourcePath, targetPath, gameVersion) {
        const foldersToRestore = ['Interface', 'WTF'];
        
        // Déterminer le chemin cible en fonction de la version du jeu
        const targetBasePath = gameVersion === 'retail'
            ? path.join(targetPath, '_retail_')
            : targetPath;
        
        for (const folder of foldersToRestore) {
            const sourceFolderPath = path.join(sourcePath, folder);
            const targetFolderPath = path.join(targetBasePath, folder);
            
            console.log(`Attempting to restore from ${sourceFolderPath} to ${targetFolderPath}`);
            
            if (await fs.pathExists(sourceFolderPath)) {
                // Supprimer l'ancien dossier s'il existe
                if (await fs.pathExists(targetFolderPath)) {
                    console.log(`Removing old folder ${targetFolderPath}`);
                    await fs.remove(targetFolderPath);
                }
                
                await fs.copy(sourceFolderPath, targetFolderPath);
                console.log(`Folder ${folder} restored successfully`);
            } else {
                console.log(`Source folder ${sourceFolderPath} does not exist`);
            }
        }
    }

    async getBackupList(options) {
        const { backupPath, gameVersion, backupType } = options;
        
        console.log('Received options:', { backupPath, gameVersion, backupType });
        
        if (backupType === 'drive') {
            console.log('Google Drive mode detected');
            // Vérifier l'authentification
            if (!await googleAuth.isAuthenticated()) {
                throw new Error('Not authenticated with Google Drive');
            }

            const files = await googleAuth.listFiles();
            console.log('Files found on Google Drive:', files);
            
            const filteredFiles = files.filter(file => file.name.startsWith(`wow_${gameVersion}_`));
            console.log('Filtered files:', filteredFiles);
            
            return filteredFiles
                .map(file => ({
                    name: file.name,
                    path: file.id,
                    timestamp: file.createdTime,
                    size: file.size,
                    formattedSize: this.formatSize(file.size),
                    formattedDate: new Date(file.createdTime).toLocaleString('fr-FR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                }))
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } else {
            console.log('Local backup mode detected');
            console.log('Backup path:', backupPath);
            
            if (!await fs.pathExists(backupPath)) {
                console.error('Backup directory does not exist:', backupPath);
                return [];
            }
            
            const files = await fs.readdir(backupPath);
            console.log('Files found in directory:', files);
            
            // Debug logs for file filtering
            files.forEach(file => {
                console.log('Checking file:', file);
                console.log('File prefix:', file.split('_')[1]); // Get the version part
                console.log('Expected version:', gameVersion);
                console.log('Starts with wow_:', file.startsWith('wow_'));
                console.log('Ends with .zip:', file.endsWith('.zip'));
            });
            
            const zipFiles = files.filter(file => {
                // Extract the version from the filename
                const fileParts = file.split('_');
                const fileVersion = fileParts[1];
                const matches = file.startsWith('wow_') && 
                              fileVersion === gameVersion && 
                              file.endsWith('.zip');
                console.log(`File ${file} matches filter:`, matches, '(version:', fileVersion, 'expected:', gameVersion, ')');
                return matches;
            });
            console.log('Filtered ZIP files:', zipFiles);
            
            const parseBackupDate = (raw) => {
                if (!raw) return null;
                // Format attendu: YYYY-MM-DDTHH-MM-SS-MSZ ou YYYY-MM-DDTHH-MM-SS.MSZ
                const match = raw.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})[.-](\d{3})Z/);
                if (match) {
                    const [_, date, hours, minutes, seconds, milliseconds] = match;
                    // Toujours créer l'ISO avec un point pour new Date()
                    const iso = `${date}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
                    const d = new Date(iso);
                    // Vérifier si la date est valide après la création
                    if (!isNaN(d.getTime())) {
                         return d;
                    }
                }
                console.warn('Failed to parse date from raw timestamp:', raw); // Ajouter un log si le parsing échoue
                return null;
            };

            const backupFiles = await Promise.all(zipFiles.map(async file => {
                const filePath = path.join(backupPath, file);
                const stats = await fs.stat(filePath);
                const rawTimestamp = file.split('_').pop().replace('.zip', '');
                const parsedDate = parseBackupDate(rawTimestamp);
                return {
                    name: file,
                    path: filePath,
                    timestamp: rawTimestamp,
                    size: stats.size,
                    formattedSize: this.formatSize(stats.size),
                    // Utiliser la date parsée pour formater si elle est valide, sinon Date inconnue
                    formattedDate: parsedDate ? parsedDate.toLocaleString('fr-FR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    }) : 'Date inconnue'
                };
            }));
            
            console.log('Formatted backups:', backupFiles);
            return backupFiles.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        }
    }

    async deleteBackup(options, backupId) {
        const { backupType } = options;
        
        if (backupType === 'drive') {
            // Vérifier l'authentification
            if (!await googleAuth.isAuthenticated()) {
                throw new Error('Not authenticated with Google Drive');
            }

            // Supprimer le fichier de Google Drive
            await googleAuth.deleteFile(backupId);
            console.log(`Backup ${backupId} deleted from Google Drive`);
        } else {
            // Supprimer le fichier local
            if (await fs.pathExists(backupId)) {
                await fs.remove(backupId);
                console.log(`Backup ${backupId} deleted from local storage`);
            } else {
                throw new Error('Backup file not found');
            }
        }
    }

    async createZipArchive(sourcePath, zipPath) {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            output.on('close', resolve);
            archive.on('error', reject);

            archive.pipe(output);
            archive.directory(sourcePath, false);
            archive.finalize();
        });
    }

    async extractZipArchive(zipPath, extractPath) {
        return new Promise((resolve, reject) => {
            const extract = require('extract-zip');
            extract(zipPath, { dir: extractPath })
                .then(resolve)
                .catch(reject);
        });
    }

    setSchedule(scheduleConfig) {
        const { frequency, time, day } = scheduleConfig;
        let cronExpression;

        console.log('Setting schedule with config:', scheduleConfig);

        const [hours, minutes] = time ? time.split(':') : ['00', '00']; // Gérer l'heure, avec 00:00 par défaut
        const dayOfWeek = day !== undefined ? day : '0'; // Gérer le jour, 0 pour Dimanche par défaut

        switch (frequency) {
            case 'daily':
                cronExpression = `${minutes} ${hours} * * *`;
                console.log('Daily cron expression:', cronExpression);
                break;
            case 'weekly':
                // Syntaxe cron: minutes heures jour_du_mois mois jour_de_la_semaine
                // dayOfWeek: 0 (Dim) - 6 (Sam)
                cronExpression = `${minutes} ${hours} * * ${dayOfWeek}`;
                console.log('Weekly cron expression:', cronExpression);
                break;
            default:
                console.error('Unsupported frequency:', frequency);
                throw new Error('Fréquence non supportée');
        }

        // Annuler l'ancien job s'il existe
        if (this.scheduledJobs.has(frequency)) {
            const oldJob = this.scheduledJobs.get(frequency);
            if (oldJob) { // Vérification ajoutée
                console.log(`Canceling existing job for frequency: ${frequency}`);
                oldJob.cancel();
            }
             this.scheduledJobs.delete(frequency); // Supprimer l'entrée même si le job était invalide
        }

        // Créer le nouveau job
        console.log(`Scheduling new job for frequency: ${frequency} with cron: ${cronExpression}`);
        const job = schedule.scheduleJob(cronExpression, async () => {
            console.log(`Scheduled job triggered for frequency: ${frequency}`);
            try {
                // Récupérer et valider les chemins
                const wowPath = this.store.get('wowPath');
                const backupPath = this.store.get('backupPath');
                const gameVersion = this.store.get('gameVersion');
                let backupType = this.store.get('backupType');

                // Si le type de sauvegarde n'est pas défini, utiliser la valeur par défaut
                if (!backupType) {
                    console.log('No backup type found, using default (local)');
                    backupType = 'local';
                    this.store.set('backupType', 'local');
                }

                console.log('Retrieved paths for scheduled backup:', {
                    wowPath,
                    backupPath,
                    gameVersion,
                    backupType
                });

                // Vérifier si les chemins nécessaires sont configurés
                if (!wowPath) {
                    throw new Error('Le chemin de World of Warcraft n\'est pas configuré');
                }

                if (backupType === 'local' && !backupPath) {
                    throw new Error('Le chemin de sauvegarde locale n\'est pas configuré');
                }

                if (!gameVersion) {
                    throw new Error('La version du jeu n\'est pas configurée');
                }

                const options = {
                    wowPath,
                    backupPath,
                    gameVersion,
                    backupType
                };

                if (backupType === 'drive') {
                    const isAuthenticated = await googleAuth.isAuthenticated();
                    if (!isAuthenticated) {
                        throw new Error('Non authentifié avec Google Drive');
                    }
                }

                // Créer une notification pour informer l'utilisateur
                if (this.webContents && !this.webContents.isDestroyed()) {
                    this.webContents.send('scheduled-backup-start', {
                        message: 'Démarrage de la sauvegarde automatique...'
                    });
                }

                console.log('Starting automatic backup with options:', options);
                await this.createBackup(options, (progress, status) => {
                    // Envoyer la progression au renderer via IPC
                    if (this.webContents && !this.webContents.isDestroyed()) {
                        this.webContents.send('backup-progress', { progress, status });
                    }
                });

                // Envoyer une notification de succès
                if (this.webContents && !this.webContents.isDestroyed()) {
                    this.webContents.send('scheduled-backup-complete', {
                        message: 'Sauvegarde automatique terminée avec succès'
                    });
                }

                console.log('Automatic backup completed.');

            } catch (error) {
                console.error('Erreur lors de la sauvegarde automatique:', error);
                // Envoyer une notification d'erreur
                if (this.webContents && !this.webContents.isDestroyed()) {
                    this.webContents.send('scheduled-backup-error', {
                        message: `Erreur lors de la sauvegarde automatique: ${error.message}`
                    });
                }
            }
        });

        if (job) {
        this.scheduledJobs.set(frequency, job);
            console.log(`Scheduled job successfully created for frequency: ${frequency}`);
        } else {
            console.error(`Failed to schedule job for frequency: ${frequency}`);
        }
    }

    clearSchedule() {
        console.log('Clearing all scheduled jobs...');
        // Vérifier si scheduledJobs est une map valide avant d'itérer
        if (this.scheduledJobs && typeof this.scheduledJobs.values === 'function') {
            const jobsToCancel = Array.from(this.scheduledJobs.values()); // Prendre une copie des valeurs
            for (const job of jobsToCancel) {
                // *** S'assurer que le job n'est pas null ou undefined avant d'appeler cancel() ***
                if (job) {
                    console.log('Attempting to cancel job:', job);
                    try {
            job.cancel();
                        console.log('Job canceled successfully.');
                    } catch (cancelError) {
                        console.error('Error canceling job:', cancelError);
                        // Continuer même si l'annulation d'un job échoue
                    }
                } else {
                    console.warn('Found null or undefined job in scheduledJobs map during clearing.');
                }
            }
            this.scheduledJobs.clear(); // Vider la map après tentative d'annulation
        } else {
            console.warn('scheduledJobs is not a valid Map or is not initialized.');
        }
        console.log('All scheduled jobs cleared.');
    }

    async applyBackupLimit(options) {
        console.log('Applying backup limit...');
        const limitBackups = this.store.get('limitBackups', false);
        const backupLimitCount = this.store.get('backupLimitCount', 7);

        if (!limitBackups || backupLimitCount <= 0) {
            console.log('Backup limit not enabled or limit is zero.');
            return; // La limite n'est pas activée ou invalide
        }

        try {
            const backups = await this.getBackupList(options);
            console.log(`Found ${backups.length} backups. Limit is ${backupLimitCount}.`);

            if (backups.length > backupLimitCount) {
                console.log('Backup limit exceeded, deleting oldest backups...');
                // Trier les sauvegardes par date croissante (du plus ancien au plus récent)
                const sortedBackups = backups.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

                // Calculer le nombre de sauvegardes à supprimer
                const backupsToDeleteCount = sortedBackups.length - backupLimitCount;
                const backupsToDelete = sortedBackups.slice(0, backupsToDeleteCount);

                console.log(`Deleting ${backupsToDelete.length} oldest backups...`);

                for (const backup of backupsToDelete) {
                    console.log(`Deleting backup: ${backup.name} (${backup.formattedDate})`);
                    await this.deleteBackup(options, backup.path); // Réutiliser la fonction existante de suppression
                }
                console.log('Oldest backups deleted.');
            } else {
                console.log('Backup limit not exceeded.');
            }
        } catch (error) {
            console.error('Error applying backup limit:', error);
        }
    }
}

module.exports = new BackupManager();
