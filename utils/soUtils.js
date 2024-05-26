//////////////////////////////////////////////////////
/*              Ericsson IRC                        */
/*              Idan Catalyst                       */
/* SOUtils:                                         */
/* Functions to invoke Service Orchestrator         */
//////////////////////////////////////////////////////

'use strict';

var fs = require('fs'),
    path = require('path'),
    jsyaml = require('js-yaml');

const {TError, TErrorEnum, sendError} = require('./errorUtils');
const swaggerUtils = require('./swaggerUtils');
const mongoUtils = require('./mongoUtils');
const intentService = require('../service/IntentService');
const $rdf = require('rdflib');
const uuid = require('uuid');
const fetch = require('node-fetch');
const notificationUtils = require('./notificationUtils');

var spec = null;
var swaggerDoc = null;
var token = null;

var SO_BASE_URL;
var SO_USERNAME;
var SO_PASSWORD;
var SO_KEYCLOACK_HOST;

/////////////////////////////////////////
// Function reads the SO config file   //
/////////////////////////////////////////
function readSoConfig() {
  var soConfig;
  try {
    soConfig = require('../soconfig.json');
    console.log("Loaded soconfig");
    SO_BASE_URL = soConfig.SO_BASE_URL;
    SO_USERNAME = soConfig.SO_USERNAME;
    SO_PASSWORD = soConfig.SO_PASSWORD;
    SO_KEYCLOACK_HOST = soConfig.SO_KEYCLOACK_HOST;
  } catch (e) {
    console.log(e)
  }
}

/////////////////////////////////////////////
// Function performs login to the SO       //
// and stores the token for subsequent use //
/////////////////////////////////////////////
async function storeNWOSoTokenAfterLogin() {

  readSoConfig();

  var details = {
      'username': 'nap-admin-user',
      'password': 'nap-admin-user',
      'grant_type': 'password',
      'client_id': 'amdocs-client'
  };

  const formBody = Object.keys(details).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(details[key])).join('&');

  console.log(SO_KEYCLOACK_HOST);
  console.log("amdocs NWO Token URL is: " + "http://"+ SO_KEYCLOACK_HOST +":8080/auth/realms/amdocs/protocol/openid-connect/token");

  const response = await fetch("http://10.46.1.14:8080/auth/realms/amdocs/protocol/openid-connect/token", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'Cache-Control': 'no-cache',
      'Host': '10.46.1.14:8080',
      'Accept-Encoding': 'gzip, deflate, br'
    },
    body: new URLSearchParams({
              'username': 'nap-admin-user',
              'password': 'nap-admin-user',
              'grant_type': 'password',
              'client_id': 'amdocs-client'
              })
  })
    .then((response) => {
      if (!response.ok) {
        console.log("amdocs NWO token Response was not OK");
        throw new Error('Http response was not OK');
      }

      var nwoToken=response.json();
      console.log("Fetching amdocs NWO Token = " + nwoToken);

      return nwoToken;
    })
    .then((jsonResp) => {
      token = jsonResp.access_token;
      console.log("Amdocs NWO Token = " + token);
    })
    .catch((error) => {
      console.error('SO: storeNWOSoTokenAfterLogin failed with error:', error);
    });
}


/////////////////////////////////////////////
// Function performs login to the SO       //
// and stores the token for subsequent use //  
/////////////////////////////////////////////
async function storeSoTokenAfterLogin() {
  try {
      readSoConfig();
      const response = await fetch(SO_BASE_URL + "/sso_rest/authentication/login", {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: `{
          "username": "${SO_USERNAME}",
          "password": "${SO_PASSWORD}",
          "source": "SIMF",
          "idOrigin": "0.0.0.0"
        }`,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error('Http response was not OK');
          }
          return response.json();
        })
        .then((jsonResp) => {
          token = jsonResp._embedded.session.token;
          console.log("SO Token = " + token);
        })
        .catch((error) => {
          console.error('SO: storeSoTokenAfterLogin failed with error:', error);
        });
     }
    catch (err) {
        console.log(err)
    }
}



//////////////////////////////////////////////////////
// Function sends the service order to SO           //
//////////////////////////////////////////////////////
async function sendServiceOrder(order) {
  try {

  const https = require('https');

  const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });

  //const response = await storeSoTokenAfterLogin()
  const response = await storeNWOSoTokenAfterLogin()
    .then (response => {fetch(SO_BASE_URL + "/api/v2/serviceOrder", {
    method: 'POST',
    headers: {
      'Accept': '*/*',
      'X-Tenant': 'Test',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: order,
    agent: httpsAgent
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Http response was not OK '+response.statusText);
      }
      console.log("Service Order sent successfully!");
    })
    .catch((error) => {
      console.error('SO: sendServiceOrder failed with error:', error);
    })
  });
}
 catch (err) {
  console.log(err)
 }

}


module.exports = { 
  storeSoTokenAfterLogin,
  sendServiceOrder
};
