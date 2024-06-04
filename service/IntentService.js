'use strict';

//Minimal Service with filtering (equality match only) and attribute selection
//Error Handing Need to define a global error hqndler
//Paging and Range based Iterator to be added
//Notification to be added add listener and implement hub

const util = require('util');
const uuid = require('uuid');

const mongoUtils = require('../utils/mongoUtils');
const swaggerUtils = require('../utils/swaggerUtils');
const notificationUtils = require('../utils/notificationUtils');

const {sendDoc} = require('../utils/mongoUtils');

const {setBaseProperties, traverse, 
       addHref, processCommonAttributes } = require('../utils/operationsUtils');

const {validateRequest} = require('../utils/ruleUtils');

const {processAssignmentRules} = require('../utils/operations');

const {getPayloadType, getPayloadSchema, getResponseType} = require('../utils/swaggerUtils');

const {updateQueryServiceType, updatePayloadServiceType, cleanPayloadServiceType} = require('../utils/swaggerUtils');

const {TError, TErrorEnum, sendError} = require('../utils/errorUtils');

const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');

/* XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
const intentHandler = require('../handler/IntentHandler');
const businessintentHandler = require('../handler/BusinessIntentHandler');
const handlerUtils = require('../utils/handlerUtils');
const handlerUtils23 = require('../utils/handlerUtils23');
/* XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/

/* XXXXXXXXXXXXX Ericsson IRC - Start  XXXXXXXXXXXXXXXx*/
const serviceIntentHandler = require('../handler/ServiceIntentHandler');
/* XXXXXXXXXXXXX Ericsson IRC - End  XXXXXXXXXXXXXXXx*/

exports.createIntent = async function(req, res, next) {
  /**
   * Creates a Intent
   * This operation creates a Intent entity.
   *
   * intent Intent_Create The Intent to be created
   * returns Intent
   **/

  console.log('createIntent :: ' + req.method + ' ' + req.url + ' ' + req.headers.host);

    /* matching isRestfulCreate - argument intent */
  
  const resourceType = getResponseType(req);
  const requestSchema = getPayloadSchema(req);
  //console.log('Parentid: '+req.body.version)
  if (req.body.version.indexOf('_')>0)
    req.body.version=req.body.version.substring(0,req.body.version.indexOf('_'))
 // console.log('Parentid: '+req.body.version)
  
  swaggerUtils.getPayload(req)
    .then(payload => validateRequest(req, 'createIntent', payload))
    .then(payload => traverse(req, requestSchema, payload,[],getPayloadType(req)))
    .then(payload => processCommonAttributes(req, resourceType, payload))
    .then(payload => processAssignmentRules('createIntent', payload))
    .then(payload => {

      const internalError =  new TError(TErrorEnum.INTERNAL_SERVER_ERROR, "Internal database error");

      payload = swaggerUtils.updatePayloadServiceType(payload, req,'');

      mongoUtils.connect().then(db => {
        db.collection(resourceType)
          .insertOne(payload)
          .then(() => {

            payload = cleanPayloadServiceType(payload);

            sendDoc(res, 201, payload);
            notificationUtils.publish(req,payload);

            var expression = handlerUtils.getExpression(req);

            if (expression!=undefined) {
    /* XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    // calls the intent handler for the knowledge extraction and storage
                if ((expression.indexOf("R1")>0) || (expression.indexOf("R2")>0) || (expression.indexOf("R3")>0) || (expression.indexOf("IR1_4")>0) ){ // check whether it's a resource intent

                  if (expression.indexOf("a icm:IntentReport")<0) { //make sure its not a report intent
                      intentHandler.processIntent(req);
                  }
                }
    //for the time being using the common handler for the biz intent
                if (expression.indexOf("B1")>0){ // check whether it's a resource intent
                  businessintentHandler.processIntent(req);
                }
    /* XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/

    /* XXXXXXXXXXXXX Ericsson IRC - Start  XXXXXXXXXXXXXXXx*/
    // calls the service intent handler for creating intent
                if ((expression.indexOf("S1")>0) || (expression.indexOf("S2")>0) || (expression.indexOf("S3")>0) ){ // check whether it's a service intent

                  if (expression.indexOf("a icm:IntentReport")>0 && expression.indexOf("IS1_Gameslice_Intent_Degraded")>0) { //send only reports
                      handlerUtils.sendIntentReport("IS1_Gameslice_Intent_Degraded", 'S1R3_Intent_Degraded.ttl', req);
                  }
                  else if (expression.indexOf("a icm:IntentReport")>0 && expression.indexOf("IS1_Gameslice_Intent_Compliant")>0) { //send only reports
                      handlerUtils.sendIntentReport("IS1_Gameslice_Intent_Compliant", 'S1R2_Intent_Compliant.ttl', req);
                  }
                  else {
                      serviceIntentHandler.processIntent(req);
                  }
                }
    /* XXXXXXXXXXXXX Ericsson IRC - End  XXXXXXXXXXXXXXXx*/
            }

          })
          .catch((error) => {
            console.log("createIntent: error=" + error);
            sendError(res, internalError);
          })
      })
      .catch((error) => {
        console.log("createIntent: error=" + error);
        sendError(res, internalError);
      })
    })
    .catch( error => {
      console.log("createIntent: error=" + error.toString());
      sendError(res, error);
    });




};

exports.deleteIntent = function(req, res, next) {
  /**
   * Deletes a Intent
   * This operation deletes a Intent entity.
   *
   * id String Identifier of the Intent
   * no response value expected for this operation
   **/

  console.log('deleteIntent :: ' + req.method + ' ' + req.url + ' ' + req.headers.host);

/* matching isRestfulDestroy */

  const id = String(req.swagger.params.id.value);
  var query = {
    id: id
  };

  query = swaggerUtils.updateQueryServiceType(query, req,'id');

  const resourceType = getResponseType(req); 

  const internalError =  new TError(TErrorEnum.INTERNAL_SERVER_ERROR, "Internal database error");

  mongoUtils.connect().then(db => {
    db.collection(resourceType)
      .findOne(query)
      .then(doc => {
        if (doc) {
//          console.log('doc: ' + JSON.stringify(doc));
          var expression = doc.expression.expressionValue;
          /* XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
          if ((expression.indexOf("R1") > 0) || (expression.indexOf("R2") > 0) || (expression.indexOf("R3") > 0)) { // check whether it's a resource intent
            // calls the intent handler for the deletetion of the intent reports triples in the knowledge base
            intentHandler.deleteIntentReports(id, 'IntentReport');

            // calls the intent handler for the deletetion of the triples in the knowledge base
            intentHandler.deleteIntent(query, resourceType,doc.name);

          }
//for the time being use the common handler for the B1 intent
          if (expression.indexOf("B1") > 0)  { // check whether it's a resource intent
            // calls the intent handler for the deletetion of the intent reports triples in the knowledge base
            intentHandler.deleteIntentReports(id, 'IntentReport');

            // calls the intent handler for the deletetion of the triples in the knowledge base
            intentHandler.deleteIntent(query, resourceType,doc.name);
          }
          /* XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/

          /* XXXXXXXXXXXXX Ericsson IRC - Start  XXXXXXXXXXXXXXXx*/
          // calls the service intent handler for deleting intent and intent report
          if ((expression.indexOf("S1") > 0) || (expression.indexOf("S2") > 0) || (expression.indexOf("S3") > 0)) { // check whether it's a resource intent
            // calls the intent handler for the deletetion of the intent reports triples in the knowledge base
            serviceIntentHandler.deleteIntentReports(id, 'IntentReport');

            // calls the intent handler for the deletetion of the triples in the knowledge base
            serviceIntentHandler.deleteIntent(query, resourceType,doc.name,req);
          }
          /* XXXXXXXXXXXXX Ericsson IRC - End  XXXXXXXXXXXXXXXx*/
          // return db for next promise
          return db;
        } else {
          sendError(res, new TError(TErrorEnum.RESOURCE_NOT_FOUND, "No resource with given id found"));
        }
      }).catch(error => console.log('error in expression process: internalError'))
  })
    .then(db => {
      db.collection(resourceType)
        .deleteOne(query)
        .then(doc => {
          if (doc.result.n == 1) {
            sendDoc(res, 204, {});
            notificationUtils.publish(req, doc);
          } else {
            sendError(res, new TError(TErrorEnum.RESOURCE_NOT_FOUND, "No resource with given id found"));
          }
        }).catch(error => sendDoc(res, 204, {}))
    })
    .catch(error => sendDoc(res, 204, {}));


  //delete all data from KG in case there is something still there
  handlerUtils.deleteAllKGData();

};

exports.listIntent = function(req, res, next) {
  /**
   * List or find Intent objects
   * This operation list or find Intent entities
   *
   * fields String Comma-separated properties to be provided in response (optional)
   * offset Integer Requested index for start of resources to be provided in response (optional)
   * limit Integer Requested number of resources to be provided in response (optional)
   * returns List
   **/

  console.log('listIntent :: ' + req.method + ' ' + req.url + ' ' + req.headers.host);

  /* matching isRestfulIndex */
 
  var query = mongoUtils.getMongoQuery(req);

  query = swaggerUtils.updateQueryServiceType(query, req,'');

  const resourceType = getResponseType(req);

  const internalError =  new TError(TErrorEnum.INTERNAL_SERVER_ERROR, "Internal database error");
  
  const generateQueryString = function(query,offset,limit) {
    var res='';
    var first=true;
    if(query.options.projection) {
      const fields=Object.keys(query.options.projection);
      res = res + '?fields=' + fields.join(',');
      first=false;
    }
    
    const delim = first ? '?' : '&';
    res = res + delim + "offset="+offset;
  
    if(query.options.limit) {
      const delim = first ? '?' : '&';
      res = res + delim + "limit="+limit;
    }

    return res;
  }

  const generateLink = function(query,skip,limit,type) {
    const basePath = req.url.replace(/\?.*$/,"");
    const hostPath = swaggerUtils.getURLScheme() + "://" + req.headers.host + basePath;
    return '"<' + hostPath + generateQueryString(query,skip,limit) + '>; rel="' + type + '"';
  }

  const setLinks = function(res,query,skip,limit,totalSize) {
    const links = [];
    links.push(generateLink(query,skip,limit,"self"));
    if(limit) {
      if(skip+limit<totalSize) {
        if(skip+2*limit<totalSize) {
          links.push(generateLink(query,skip+limit,limit,"next"));
        } else {
          links.push(generateLink(query,skip+limit,totalSize-skip-limit,"next"));
        }
        links.push(generateLink(query,totalSize-limit,limit,"last"));
      } 
      if(skip-limit>0) {
        links.push(generateLink(query,skip-limit,limit,"prev"));
      } else if(skip>0) {
        links.push(generateLink(query,0,skip,"prev"));
      }
    }
    res.setHeader('Link',links.join(', '));
  }

  // Find some documents based on criteria plus attribute selection
  mongoUtils.connect()
  .then(db => {
    db.collection(resourceType).stats()
    .then(stats => {
      const totalSize=stats.count;
      db.collection(resourceType)
      .find(query.criteria, query.options).toArray()
      .then(doc => {
        doc = cleanPayloadServiceType(doc);
        res.setHeader('X-Total-Count',totalSize);
        res.setHeader('X-Result-Count',doc.length);
        var skip = query.options.skip!==undefined ? parseInt(query.options.skip) : 0;
        var limit;
        if(query.options.limit!==undefined) limit = parseInt(query.options.limit);        
        if(limit || skip>0) setLinks(res,query,skip,limit,totalSize);

        var code = 200;
        if(limit && doc.length<totalSize) code=206;
        sendDoc(res, code, doc);
      })
      .catch(error => {
        console.log("listIntent: error=" + error);
        sendError(res, internalError);
      })
    })
    .catch(error => {
      console.log("listIntent: error=" + error);
      sendError(res, internalError);
    })
  })
  .catch(error => {
    console.log("listIntent: error=" + error);
    sendError(res, internalError);
  })



};


exports.retrieveIntent = function(req, res, next) {
  /**
   * Retrieves a Intent by ID
   * This operation retrieves a Intent entity. Attribute selection is enabled for all first level attributes.
   *
   * id String Identifier of the Intent
   * fields String Comma-separated properties to provide in response (optional)
   * returns Intent
   **/

  console.log('retrieveIntent :: ' + req.method + ' ' + req.url + ' ' + req.headers.host);

  /* matching isRestfulShow */

  var id = String(req.swagger.params.id.value);

  var query = mongoUtils.getMongoQuery(req);
  query.criteria.id = id

  query = swaggerUtils.updateQueryServiceType(query, req,'id');

  const resourceType = getResponseType(req); 

  const internalError =  new TError(TErrorEnum.INTERNAL_SERVER_ERROR, "Internal database error");

  mongoUtils.connect().then(db => {
    db.collection(resourceType)
      .findOne(query.criteria, query.options)
      .then(doc => {
        if(doc) {
          doc = cleanPayloadServiceType(doc);
//          console.log('doc: '+doc);
          sendDoc(res, 200, doc)
        } else {
          sendError(res, new TError(TErrorEnum.RESOURCE_NOT_FOUND,"No resource with given id found"));
        }
      })
      .catch(error => {
        console.log("retrieveIntent: error=" + error);
        sendError(res, internalError);
      });
  })
  .catch(error => {
    console.log("retrieveIntent: error=" + error);
    sendError(res, internalError);
  });




};