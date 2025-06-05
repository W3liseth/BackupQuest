const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const Store = require('electron-store');
const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const dotenv = require('dotenv');

// Charger les variables d'environnement
dotenv.config();

const store = new Store();

class GoogleAuth {
    constructor() {
        this.oauth2Client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        // Restaurer les tokens sauvegardés
        const savedTokens = store.get('googleTokens');
        if (savedTokens) {
            this.oauth2Client.setCredentials(savedTokens);
        }
    }

    async authenticate() {
        try {
            const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
                scope: ['https://www.googleapis.com/auth/drive.file']
            });

            // Retourner l'URL d'authentification
            return authUrl;
        } catch (error) {
            console.error('Error generating auth URL:', error);
            throw error;
        }
    }

    async handleAuthCode(code) {
        try {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);
            
            // Sauvegarder les tokens
            store.set('googleTokens', tokens);
            
            return tokens;
        } catch (error) {
            console.error('Error getting tokens:', error);
            throw error;
        }
    }

    async isAuthenticated() {
        try {
            const tokens = this.oauth2Client.credentials;
            if (!tokens || !tokens.access_token) {
                return false;
            }

            // Vérifier si le token est expiré
            if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
                // Essayer de rafraîchir le token
                try {
                    const { credentials } = await this.oauth2Client.refreshAccessToken();
                    this.oauth2Client.setCredentials(credentials);
                    store.set('googleTokens', credentials);
                    return true;
                } catch (refreshError) {
                    console.error('Error refreshing token:', refreshError);
                    return false;
                }
            }

            return true;
        } catch (error) {
            console.error('Error checking authentication:', error);
                return false;
        }
    }

    async uploadFile(filePath, fileName) {
        try {
            if (!await this.isAuthenticated()) {
                throw new Error('Not authenticated with Google Drive');
            }

            const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
            const fileMetadata = {
                name: fileName,
                parents: ['root']
            };

            const media = {
                mimeType: 'application/zip',
                body: require('fs').createReadStream(filePath)
            };

            const response = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id'
            });

            return response.data;
        } catch (error) {
            console.error('Error uploading file:', error);
            throw error;
        }
    }

    async downloadFile(fileId, destinationPath) {
        try {
            if (!await this.isAuthenticated()) {
                throw new Error('Not authenticated with Google Drive');
            }

            const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
            const response = await drive.files.get(
                { fileId: fileId, alt: 'media' },
                { responseType: 'stream' }
            );

            return new Promise((resolve, reject) => {
                const dest = require('fs').createWriteStream(destinationPath);
                response.data
                    .on('end', () => resolve())
                    .on('error', err => reject(err))
                    .pipe(dest);
            });
        } catch (error) {
            console.error('Error downloading file:', error);
            throw error;
        }
    }

    async listFiles() {
        try {
            if (!await this.isAuthenticated()) {
                throw new Error('Not authenticated with Google Drive');
            }

            const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
            const response = await drive.files.list({
                pageSize: 100,
                fields: 'files(id, name, createdTime, size)',
                orderBy: 'createdTime desc'
            });

            return response.data.files;
        } catch (error) {
            console.error('Error listing files:', error);
            throw error;
        }
    }

    async deleteFile(fileId) {
        try {
            if (!await this.isAuthenticated()) {
                throw new Error('Not authenticated with Google Drive');
            }

            const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
            await drive.files.delete({ fileId: fileId });
        } catch (error) {
            console.error('Error deleting file:', error);
            throw error;
        }
    }

    async logout() {
        try {
            console.log('Attempting Google Drive logout...');
            // Révoquer le token (si présent et valide)
            const tokens = this.oauth2Client.credentials;
            if (tokens && tokens.access_token) {
                console.log('Revoking Google access token...');
                await this.oauth2Client.revokeToken(tokens.access_token);
                console.log('Token revoked.');
            }
            
            // Supprimer les tokens sauvegardés localement
            console.log('Deleting Google tokens from store...');
            store.delete('googleTokens');
            console.log('Tokens deleted.');
            
            // Réinitialiser les identifiants dans le client OAuth2
            this.oauth2Client.setCredentials(null);
            console.log('OAuth2 client credentials cleared.');
            
            console.log('Google Drive logout successful.');

        } catch (error) {
            console.error('Error during Google Drive logout:', error);
            // Ne pas lancer l'erreur pour ne pas bloquer l'application si la révocation échoue
            // mais la déconnexion locale est importante.
        }
    }
}

module.exports = new GoogleAuth(); 