const msal = require('@azure/msal-node');
require('dotenv').config();

// Configuration object
const config = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET
  },
  // cache: {
  //   cacheLocation: "localStorage",
  //   storeAuthStateInCookie: true},
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Verbose,
    }
  }
};

// Create a confidential client application
const cca = new msal.ConfidentialClientApplication(config);

// Function to get access token for a given scope .
async function getAccessToken(scope) {
    const tokenRequest = {
        scopes: [scope],
    };

    try {
        const response = await cca.acquireTokenByClientCredential(tokenRequest);
        // console.log('session.user from graph sso response = ', {response});
        return response.accessToken;
    } catch (error) {
        console.error('Error acquiring access token:', error);
        throw error;
    }
}

module.exports = { getAccessToken, cca };