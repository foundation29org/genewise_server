/*
* EXPRESS CONFIGURATION FILE
*/
'use strict'

const express = require('express')
const compression = require('compression');
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const app = express()
app.use(compression());
const serviceEmail = require('./services/email')
const api = require ('./routes')
const path = require('path')
const config= require('./config')

const allowedOrigins = config.allowedOrigins;

function setCrossDomain(req, res, next) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || req.method === 'GET' || req.method === 'HEAD'){
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'HEAD,GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Access-Control-Allow-Origin, Accept, Accept-Language, Origin, User-Agent, x-api-key');
    next();
  }else{
     //send email
     const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
     const requestInfo = {
         method: req.method,
         url: req.url,
         headers: req.headers,
         origin: origin,
         body: req.body, // Asegúrate de que el middleware para parsear el cuerpo ya haya sido usado
         ip: clientIp,
         params: req.params,
         query: req.query,
       };
     serviceEmail.sendMailControlCall(requestInfo)
     res.status(401).json({ error: 'Origin not allowed' });
  }
}

app.use(bodyParser.urlencoded({limit: '50mb', extended: false}))
app.use(bodyParser.json({limit: '50mb'}))
app.use(setCrossDomain);
app.use(fileUpload());

// use the forward slash with the module api api folder created routes
app.use('/api',api)

app.use('/apidoc',express.static('apidoc', {'index': ['index.html']}))

/*app.use(express.static(path.join(__dirname, 'apidoc')));*/
/*app.get('/doc', function (req, res) {
    res.sendFile('apidoc/index.html', { root: __dirname });
 });*/

//ruta angular, poner carpeta dist publica
app.use(express.static(path.join(__dirname, 'dist')));
// Send all other requests to the Angular app
app.get('*', function (req, res, next) {
    res.sendFile('dist/index.html', { root: __dirname });
 });

module.exports = app
