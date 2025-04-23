const msal = require('@azure/msal-node');
require('dotenv').config();

// Configuration object
const config = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        console.log(message);
      },
      piiLoggingEnabled: false,
      // logLevel: msal.LogLevel.Verbose,  //high log level with verbose
      logLevel: msal.LogLevel.Warning,  //low log level with wanring and errors
    }
  }
};

// Create a confidential client application
const cca = new msal.ConfidentialClientApplication(config);

let cachedToken = null;
let tokenExpiry = null;

// Function to get access token for a given scope.
async function getAccessToken() {
    const now = new Date();
    if (cachedToken && tokenExpiry && now < tokenExpiry) {
        return cachedToken; // Return cached token if it's still valid
    }

    const tokenRequest = {
        scopes: [process.env.G_SCOPE],
    };

    try {
        const response = await cca.acquireTokenByClientCredential(tokenRequest);
        cachedToken = response.accessToken;
        tokenExpiry = response.expiresOn; // Update token expiry
        return cachedToken;
    } catch (error) {
        console.error("Error acquiring access token:", error);
        throw error;
    }
}

module.exports = { getAccessToken, cca };