//////////////////////////////////////////////////////
/*              Huawei IRC                          */
/*              Idan Catalyst                       */
/* IntentHandler:                                   */
/* Intent Handler creates and deletes the Knowledge */
/* objects                                          */
//////////////////////////////////////////////////////
'use strict';

const util = require('util');
const uuid = require('uuid');
const fs = require('fs');
const async = require('async');
const $rdf = require('rdflib')

const notificationUtils = require('../utils/notificationUtils');


const {TError, TErrorEnum, sendError} = require('../utils/errorUtils');
const handlerUtils = require('../utils/handlerUtils');
const handlerUtils23 = require('../utils/handlerUtils23');
const mongoUtils = require('../utils/mongoUtils');
const swaggerUtils = require('../utils/swaggerUtils');
const Intent = require('../controllers/Intent');

const serviceIntentHandler = require('../handler/ServiceIntentHandler');
const sendResourceStr = process.env.SEND_RESOURCE_INTENT!==undefined ? process.env.SEND_RESOURCE_INTENT:'true'
const sendResource = sendResourceStr=='false' ? false:true
console.log('SendReource '+sendResource)

// This function is called from the RI once the intent as been stored in MOngo
//it will extract the expression from the request body, parse the expresion into
//triples and then store these triples in the graphdb.
//It then reads a hardcode intent report and send this back to the listeners 
//using the RI HUB
exports.processIntent = function(req) {
//  handlerUtils.wait(120000);
const expression = handlerUtils.getExpression(req);

if (req.body.name.indexOf('ACTN')>0) {
  handlerUtils23.postACTN(req.body.name,req.body.expression.expressionValue,req.body.id,req.body.version)
} else {

  //From expression extract triples and load the data in GraphDB 
  handlerUtils.extractTriplesandKG(expression,`insert`,'text/turtle',req.body.name);

      /* 2023 XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    //Call the python server 
//    handlerUtils23.postPythonRI(req.originalUrl,req.body.id,req.body);
   handlerUtils23.process_intents(expression,req.body.id,req.body.version)
/* 2023 XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/

}  

  var reports = [];

  if (sendResource) {
    /// Test R31 process 
    if (expression.indexOf("R3_1") >= 0) {
      reports = ['R31R1_Intent_Accepted','R31R2_Intent_Compliant']
      handlerUtils23.addGenerateIntentReport('R31R2_Intent_Compliant',req)
    } else if (expression.indexOf("R3_3") >= 0) {
      reports = ['R33R1_Intent_Accepted','R33R2_Intent_Compliant']
    } else if (expression.indexOf("R2_3") >= 0) {
      reports = ['R13R3_Intent_Degraded','R23R1_Intent_Accepted','R23R2_Intent_Compliant']
    } else if (expression.indexOf("R2_1") >= 0) {
      reports = ['R21R1_Intent_Accepted','R21R2_Intent_Compliant']
      handlerUtils23.addGenerateIntentReport('R21R2_Intent_Compliant',req)
    } else if (expression.indexOf("R1_3") >= 0) {
      reports = ['R13R1_Intent_Accepted','R13R2_Intent_Compliant']
    } else if (expression.indexOf("R1_1") >= 0) {
      reports = ['R11R1_Intent_Accepted','R11R2_Intent_Compliant']
      handlerUtils23.addGenerateIntentReport('R11R2_Intent_Compliant',req)
    }
    reports.forEach (report => { 
      handlerUtils.sendIntentReportEvent(report,report+'.ttl',req);
      console.log(`log: ${report} sent`);
    }) 
  }

  if (expression.indexOf("R3_2") >= 0) {
    reports = ['R32R2_Intent_Compliant']
  } else if (expression.indexOf("R2_2") >= 0) {
    reports = ['R22R2_Intent_Compliant']
  } else if (expression.indexOf("R1_2") >= 0) {
    reports = ['R12R2_Intent_Compliant']
  }

  // IDAN4 start
  console.log("===> Resource handling");
  console.log(expression);
  console.log("=============================== " + expression.indexOf("IR1_4_RAN_Probe") + " " + expression.indexOf("10000"));
  if (expression.indexOf("IR1_4_RAN_Probe") >= 0 && expression.indexOf("10000")>0) { //Probe failed
    console.log("===> Resource probe failed");
    reports = ['R14R1ProbeFail_Intent_Accepted','R14R3Probe_Intent_Degraded']
    handlerUtils23.addGenerateIntentReport('R14R3Probe_Intent_Degraded',req)
  }

  if (expression.indexOf("IR1_4_RAN_Probe") >= 0 && expression.indexOf("10000")<0) { //Probe success
    console.log("===> Resource probe success");
    reports = ['R14R1Probe_Intent_Accepted','R14R2Probe_Intent_Compliant']
    handlerUtils23.addGenerateIntentReport('R14R2Probe_Intent_Compliant',req)
  }

  if (expression.indexOf("IR1_4_RAN") >= 0 && expression.indexOf("IR1_4_RAN_Probe")<0) {
    reports = ['R14R1_Intent_Accepted','R14R2_Intent_Compliant']
    handlerUtils23.addGenerateIntentReport('R14R2_Intent_Compliant',req)
  }
  if (expression.indexOf("IR1_4_EDGE") >= 0 && expression.indexOf("IR1_4_EDGE_Probe")<0) {
    reports = ['R14R2_EDGE_Intent_Accepted','R14R2_EDGE_Intent_Compliant']
    handlerUtils23.addGenerateIntentReport('R14R2_EDGE_Intent_Compliant',req)
  }

  if (expression.indexOf("IR1_4_EDGE_Probe")>0) {
    reports = ['R14R2Probe_EDGE_Intent_Accepted','R14R2Probe_EDGE_Intent_Compliant']
    handlerUtils23.addGenerateIntentReport('R14R2Probe_EDGE_Intent_Compliant',req)
  }

  // IDAN4 end
  

  reports.forEach (report => { 
    handlerUtils.sendIntentReportEvent(report,report+'.ttl',req);
    console.log(`log: ${report} sent`);
  }) 
};


// This function is called from the RI once the intent as been deleted from MOngo
//it reads the intent expression from mongo, parse the expresion into
//triples and then deletes these triples from the graphdb.
exports.deleteIntent = function(query,resourceType,name) {

//  console.log('query.id: '+query.id)
//  console.log('resourceType: '+resourceType)
 
 //reads intent from mongo and then deletes objects from KG.  All in one function as async
  handlerUtils.getIntentExpressionandDeleteKG(query,resourceType); 
  
  if (name.indexOf('_ACTN')>0) {
    handlerUtils23.deleteACTN(name)
  } 

    /* 2023 XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    //Call the python server 
    //    handlerUtils23.deletePythonRI(req,query.id);
    handlerUtils23.delete_intents(name)

    if (sendResource) {
      /// Test R31 process
      if (name.indexOf("R3_1") >= 0) {
        handlerUtils23.removeGenerateIntentReport('R31R2_Intent_Compliant')
      } else if (name.indexOf("R2_1") >= 0) {
        handlerUtils23.addGenerateIntentReport('R21R2_Intent_Compliant')
      } else if (name.indexOf("R1_1") >= 0) {
        handlerUtils23.addGenerateIntentReport('R11R2_Intent_Compliant')
      }
    }
      /* 2023 XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/
  

};
exports.deleteIntentbyName = function(name,req,serviceIntent) {
  var query = mongoUtils.getMongoQuery(req);
  query.criteria.name = name
//  query = swaggerUtils.updateQueryServiceType(query, req,'name');
  var resourceType = 'Intent'
//  console.log('name: '+name)
//  console.log('resourceType: '+resourceType)
  mongoUtils.connect().then(db => {
  db.collection(resourceType)
  .find(query.criteria, query.options).toArray()
  .then(doc => {
    doc.forEach(x => {
      var query2 = {
        id: x.id
      };
      if (serviceIntent) {
         serviceIntentHandler.deleteIntentReports(x.id, 'IntentReport');
         serviceIntentHandler.deleteIntent(query2,'Intent');
      } else {
        this.deleteIntentReports(x.id, 'IntentReport');
        this.deleteIntent(query2,'Intent',name);
      }
/* 2023 XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    //Call the python server 
//    handlerUtils23.deletePythonRI(req,x.id);
    handlerUtils23.delete_intents(name)

/* 2023 XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/
    })
  })
  .catch(error => {
  console.log("deleteIntent: error=" + error);
  });
  })
  .catch(error => {
  console.log("deleteIntent: error=" + error);
  });

};


// This function is called from the RI once the intentReport as been deleted from MOngo
//it reads the intentReport expression from mongo, parse the expresion into
//triples and then deletes these triples from the graphdb.
exports.deleteIntentReports = function(id,resourceType) {

//  console.log('intentid: '+id)
//  console.log('resourceType: '+resourceType)
 //reads intent from mongo and then deletes objects from KG.  All in one function as async
 handlerUtils.getIntentReportExpressionandDeleteKG(id,resourceType); 


};
