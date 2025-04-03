// backend/index.js
'use strict'

const express = require('express')
const cors = require('cors');
const config= require('../config') // Ensure config is correctly imported

// --- Controller/Service Imports ---
const langCtrl = require('../controllers/all/lang')
const docsCtrl = require('../controllers/user/patient/documents') // Assuming this handles upload logic now separate from summary
const summaryServiceCtrl = require('../services/summary')        // Import the summary service
const translationCtrl = require('../services/translation')
const serviceEmail = require('../services/email')

// --- Express App Setup ---
const api = express.Router()
const myApiKey = config.Server_Key;
const whitelist = config.allowedOrigins;

// --- Middleware Definitions ---

// Custom CORS middleware
function corsWithOptions(req, res, next) {
  const corsOptions = {
    origin: function (origin, callback) {
      // console.log('Request Origin:', origin); // Debugging log
      // Allow requests with no origin (like server-to-server, Postman, curl) OR if origin is in whitelist
      if (!origin || whitelist.includes(origin)) {
        callback(null, true);
      } else {
        // Log blocked request details
        const clientIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress; // Use optional chaining for remoteAddress
        const requestInfo = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            origin: origin || 'N/A',
            body: req.body, // Be cautious logging full bodies in production
            ip: clientIp || 'N/A',
            params: req.params,
            query: req.query,
          };
        console.warn(`CORS rejection for origin: ${origin}. Request details logged.`); // Log warning
        serviceEmail.sendMailControlCall(requestInfo); // Optionally notify admin
        callback(new Error(`Origin ${origin} not allowed by CORS`)); // Provide origin in error
      }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS", // Explicitly allow methods
    allowedHeaders: "Content-Type, Authorization, X-Requested-With, Accept, x-api-key", // Include x-api-key
    credentials: true, // If you use cookies or authorization headers
    optionsSuccessStatus: 204 // For preflight requests
  };

  cors(corsOptions)(req, res, next);
}

// API Key Check Middleware
const checkApiKey = (req, res, next) => {
  // Allow OPTIONS requests for CORS preflight without API key check
  if (req.method === 'OPTIONS') {
    return next();
  }

  const apiKey = req.get('x-api-key');
  if (apiKey && apiKey === myApiKey) {
    return next(); // API key is valid, proceed
  } else {
    console.warn(`Unauthorized access attempt: Missing or invalid API Key. IP: ${req.ip}`); // Log attempt
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' }); // Send clear error
  }
};

// --- Route Definitions ---

// Apply CORS and API Key middleware globally or per route as needed
// Using it per route group here for clarity
api.use(corsWithOptions); // Apply CORS first
// Note: If express.json() middleware isn't applied globally before this router, add it here:
// api.use(express.json());


// Language endpoints (Assumed public or handled differently - check if API key is needed)
api.get('/langs/', langCtrl.getLangs); // Does this need checkApiKey?

// Document handling endpoints (Require API Key)
api.post('/upload', checkApiKey, docsCtrl.uploadFile); // Apply checkApiKey here
api.post('/callsummary', checkApiKey, summaryServiceCtrl.callSummary); // Apply checkApiKey here

// Translation endpoints (Require API Key)
api.post('/getDetectLanguage', checkApiKey, translationCtrl.getDetectLanguage);
api.post('/translation', checkApiKey, translationCtrl.getTranslationDictionary);
api.post('/translationinvert', checkApiKey, translationCtrl.getTranslationDictionaryInvert);
api.post('/translationinvertarray', checkApiKey, translationCtrl.getTranslationDictionaryInvert2);
api.post('/deepltranslationinvert', checkApiKey, translationCtrl.getdeeplTranslationDictionaryInvert);
api.post('/translation/segments', checkApiKey, translationCtrl.getTranslationSegments);
api.post('/translation/ia', checkApiKey, translationCtrl.getTranslationIA);

// Private test route (Example - might need auth/API key)
api.get('/private', checkApiKey, (req, res) => { // Added checkApiKey for consistency
	res.status(200).send({ message: 'You have access' });
});

module.exports = api;