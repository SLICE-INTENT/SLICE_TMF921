//////////////////////////////////////////////////////////////
/*              Ericsson IRC                                */
/*              Idan Catalyst                               */
/* ServiceIntentHandler:                                    */
/* Service Intent Handler sends a service order over TMF641 */
/* and creates/deletes the Knowledge objects                */
//////////////////////////////////////////////////////////////
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
const Intent = require('../controllers/Intent');
const intentHandler = require('./IntentHandler')
const moment = require('moment');

const S1_children = ['IR1_1_Construction.ttl','IR1_3_Construction.ttl','IR1_2_Construction_ACTN.json']
const S2_children = ['IR2_1_Emergency.ttl','IR2_3_Emergency.ttl','IR2_2_Emergency_ACTN.json']
const S3_children = ['IR3_1_Power.ttl']
const sendResourceStr = process.env.SEND_RESOURCE_INTENT!==undefined ? process.env.SEND_RESOURCE_INTENT:'true'
const sendResource = sendResourceStr=='false' ? false:true
console.log('SendReource '+sendResource)

// Initialize parameters to be processed in service intent, the values 
// are modified later based on what is received in actual intent
var serviceIntentParams = {
  "intentName": "XYZintent",
  "bandwidth": 10,
  "availability": 0.9999,
  "networkUtil" : 0.6,
  "quality": "Premium",
  "site": "A wonderful site",
  "reportInterval": 1
};

// This function is called from the SI once the intent has been stored in MongoDB
//it will send a service order to SO over TMF641,
//extract the expression from the request body, parse the expresion into
//triples and then store these triples in the graphdb.
//It then reads a hardcoded intent report and send this back to the listeners 
//using the SI HUB
exports.processIntent = function(req) {

  //extract expression
  const expression = handlerUtils.getExpression(req);
  extractParamsFromIntent(expression, 'text/turtle');
  console.log("Received Intent Params = " + JSON.stringify(serviceIntentParams));

  var serviceOrder;
  var name;
  var probe=false;

  if (expression.indexOf("IS1_Gameslice_Probe_1") > 0) {
    serviceOrder = 'service_order_SLICE_SERVICE_Probe_Fail.json';
    name = 'Probe_1;'
  }  else if (expression.indexOf("IS1_Gameslice_Probe_2") > 0) {
    serviceOrder = 'service_order_SLICE_SERVICE_Probe_Success.json';
    name = 'Probe_2;'
  }  else if (expression.indexOf("IS1") > 0) {
    serviceOrder = 'service_order_SLICE_SERVICE_CREATE.json';
    name = 'S1;'
  }
  else if (expression.indexOf("S2") > 0) {
    serviceOrder = 'service_order_ER_SERVICE_CREATE.json';
    name = 'S2;'
  }
  else if (expression.indexOf("S3") > 0) {
    serviceOrder = 'service_order_CSP_USAGE_CONDITION_CREATE.json';
    name = 'S3;'
  }
  else if (expression.indexOf("Probe_1") > 0) {
    serviceOrder = '';
    name = 'Probe_1'
    probe=true;
  } else if (expression.indexOf("Probe_2") > 0) {
    serviceOrder = '';
    name = 'Probe_2'
    probe=true;
  }


  console.log("serviceOrder json is: " + serviceOrder);

    //From expression extract triples and load the intent in GraphDB 
  handlerUtils.extractTriplesandKG(expression, `insert`, 'text/turtle',name);

  var id = req.body.id;
    /* 2023 XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    //Call the python server 
//    handlerUtils23.postPythonRI(req.originalUrl,id,req.body);
  handlerUtils23.process_intents(expression,id,req.body.version)

/* 2023 XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/
  
  createIntentReport(req,name,id);
  

  if ((!probe)&&(!sendResource)) sendCreateServiceOrder(id,serviceOrder);


};

function sendCreateServiceOrder(id,serviceOrder) {
  const soUtils = require('../utils/soUtils');
  
  fs.readFile(`./serviceorders/${serviceOrder}`, 'utf8', (err, createOrder) => {

    if (err) {
      console.error('unable to read create service order json file due to error:', err);
      return;
    }
 
    var createOrderJson = JSON.parse(createOrder);
    //add the service intent id
    var i = 1
    if(createOrderJson.orderItem!=undefined) {
        createOrderJson.orderItem.forEach(orderItem=>{
          orderItem.service.publicIdentifier = id+`_${i}`;
          if (orderItem.service.serviceRelationship != undefined && orderItem.service.serviceRelationship[0] != undefined) {
            if (orderItem.service.serviceRelationship[0].service.publicIdentifier.indexOf("serviceIntentId_CONNECTIVITY")>=0) {
              orderItem.service.serviceRelationship[0].service.publicIdentifier = id+'_1'
              orderItem.service.serviceRelationship[0].service.name = id+'_1 (' + id + '_1)'
            }
          }

          var currentMoment = moment();
          var nextDay = moment();
          nextDay=nextDay.add(1, 'days');
          if (orderItem.service.serviceCharacteristic != undefined) {
              orderItem.service.serviceCharacteristic.forEach(characteristic=>{
                if (characteristic.name==='serviceActivationDate') {
                    characteristic.value.serviceActivationDate=currentMoment.format('DD-MMM-YYYY HH:mm:ss');
                    console.log("=======> currentMoment " + currentMoment.format('DD-MMM-YYYY HH:mm:ss'));
                }
                else if (characteristic.name==='serviceExpirationDate') {
                    characteristic.value.serviceExpirationDate=nextDay.format('DD-MMM-YYYY HH:mm:ss');
                    console.log("=======> nextDay " + nextDay.format('DD-MMM-YYYY HH:mm:ss'));
                }
              })
          }

          i=i+1
        })
    }

//    if ((serviceIntentParams.quality == 'Premium') && (serviceIntentParams.availability >= 0.99)) {
//      createOrderJson.orderItems[0].service.characteristics[1].value = "10";
//    } else {
//      createOrderJson.orderItems[0].service.characteristics[1].value = "5";
//    }

    //createOrderJson.orderItems[0].service.characteristics[2].value = serviceIntentParams.site.toString();
    
    console.log("SERVICE ORDER = " + JSON.stringify(createOrderJson));

    try {
      soUtils.sendServiceOrder(JSON.stringify(createOrderJson));
    }
    catch (error) {
      console.error('SIH: sendCreateServiceOrder failed with error:', error);
      return;
    }
  });
}


function createIntentReport(req,name,id) {
  var filename;
  var children = [];
  var reports = [];
  if (name.indexOf("Probe_1") >= 0) {
    reports = ['S1Probe1R1_Intent_Accepted','S1Probe1R1_Intent_Degraded']
   handlerUtils23.addGenerateIntentReport('S1Probe1R1_Intent_Degraded',req)
} else if (name.indexOf("Probe_2") >= 0) {
  reports = ['S1Probe2R1_Intent_Accepted','S1Probe2R1_Intent_Compliant']
 handlerUtils23.addGenerateIntentReport('S1Probe2R1_Intent_Compliant',req)
} else if (name.indexOf("S1") >= 0) {

    reports = ['S1R1_Intent_Accepted','S1R2_Intent_Compliant']
    children = [...S1_children]
 }
 else if (name.indexOf("S2") >= 0) {
    reports = ['S2R1_Intent_Accepted','S2R2_Intent_Compliant','S1R3_Intent_Degraded']
    children = [...S2_children]
 }
 else if (name.indexOf("S3") >= 0) {
    reports = ['S3R1_Intent_Accepted','S3R2_Intent_Compliant']
    children = [...S3_children]
 }
   reports.forEach(x => {
      handlerUtils.sendIntentReport(x, x+'.ttl', req);
      console.log(`log: ${x} Intent Posted`);
   })
   if (sendResource) {
     children.forEach(x => {
       handlerUtils.postIntent(x.substring(0,x.indexOf('.')), x, req);
       console.log(`log: ${x} Intent Posted`);
     })
   }
}

function extractParamsFromIntent(expression, type) {
  const RDF = $rdf.Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
  const RDFS = $rdf.Namespace("http://www.w3.org/2000/01/rdf-schema#");
  const EX = $rdf.Namespace("http://www.example.org/IDAN3#");
  const ICM = $rdf.Namespace("http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel#");
  const CEM = $rdf.Namespace("http://tio.labs.tmforum.org/tio/v1.0.0/CatalystExtensionModel#");
  const MET = $rdf.Namespace("http://www.sdo2.org/TelecomMetrics/Version_1.0#");
  const T = $rdf.Namespace("http://www.w3.org/2006/time#");

  var uri = 'http://www.example.org/IDAN3#';
  var mimeType = 'application/ld+json';
  if (type !== undefined) {
    mimeType = type;
  }

  var store = $rdf.graph();
  //create rdf object
  try {
    $rdf.parse(expression, store, uri, mimeType);

    var intentName = store.each(undefined, CEM('layer'), EX('service'));
    if (intentName[0] == undefined) {
        serviceIntentParams.intentName='';
    }
    else {
        serviceIntentParams.intentName = intentName[0].value;
    }

    var networkUtilObservationObject = store.each(undefined, ICM('latestValueOf'), MET('NetworkUtilization'));
    var networkUtilTriplesSubject = store.each(undefined, ICM('observation'), networkUtilObservationObject[0]);
    var networkUtilTriples = store.each(networkUtilTriplesSubject[0], ICM('smaller'), undefined);
    var networkUtil = store.each(networkUtilTriples[0], ICM('value'), undefined);
//    if ((networkUtilObservationObject[0] == undefined) || (networkUtilTriplesSubject[0] == undefined) || (networkUtilTriples[0] == undefined) || (networkUtil[0] == undefined)) {
//      serviceIntentParams.networkUtil = null;
//    } else {
//      serviceIntentParams.networkUtil = parseFloat(networkUtil[0].value);
//    }
    
    var bandwidthObservationObject = store.each(undefined, ICM('latestValueOf'), MET('ServiceBandwidth'));
    var bandwidthTriplesSubject = store.each(undefined, ICM('observation'), bandwidthObservationObject[0]);
    var bandwidthTriples = store.each(bandwidthTriplesSubject[0], ICM('atLeast'), undefined);
    var bandwidth = store.each(bandwidthTriples[0], ICM('value'), undefined);
    if ((bandwidthObservationObject[0] == undefined) || (bandwidthTriplesSubject[0] == undefined) || (bandwidthTriples[0] == undefined) || (bandwidth[0] == undefined)) {
      serviceIntentParams.bandwidth = null;
    } else {
      serviceIntentParams.bandwidth = parseFloat(bandwidth[0].value);
    }

    var availabilityObservationObject = store.each(undefined, ICM('latestValueOf'), MET('ServiceAvailability'));
    var availabilityTriplesSubject = store.each(undefined, ICM('observation'), availabilityObservationObject[0]);
    var availabilityTriples = store.each(availabilityTriplesSubject[0], ICM('atLeast'), undefined);
    var availability = store.each(availabilityTriples[0], ICM('value'), undefined);
    if ((availabilityObservationObject[0] == undefined) || (availabilityTriplesSubject[0] == undefined) || (availabilityTriples[0] == undefined) || (availability[0] == undefined)) {
      serviceIntentParams.availability = null;
    } else {
      serviceIntentParams.availability = parseFloat(availability[0].value);
    }

    var qualityTriples = store.each(EX('S1P5_service_level'), ICM('intersectsWith'), undefined);
    var quality = store.each(qualityTriples[0], RDFS('member'), undefined);
    if ((qualityTriples[0] == undefined) || (quality[0] == undefined)) {
      serviceIntentParams.quality = null;
    } else if (CEM('PremiumService').equals(quality[0])) {
      serviceIntentParams.quality = 'Premium';
    } else {
      serviceIntentParams.quality = '';
    }

    var locationsTriplesSubject = store.each(undefined, ICM('includedIn'), MET('ConnectedLocations'));
    var locationsTriples = store.each(locationsTriplesSubject[0], ICM('subjectContainer'), undefined);
    var locations = store.each(locationsTriples[0], RDF('member'), undefined);
    if ((locationsTriplesSubject[0] == undefined) || (locationsTriples[0] == undefined) || (locations[0] == undefined) || (locations[1] == undefined)) {
      serviceIntentParams.locations = null;
    } else {
      serviceIntentParams.locations = [locations[0].value, locations[1].value];
    }

    var reportIntervalTriplesSubject = store.each(undefined, RDF('type'), ICM('ReportingExpectation'));
    var reportIntervalTriples = store.each(reportIntervalTriplesSubject[0], ICM('reportingInterval'), undefined);
    var reportIntervalValue = store.each(reportIntervalTriples[0], T('numericDuration'), undefined);
    var reportIntervalUnit = store.each(reportIntervalTriples[0], T('temporalUnit'), undefined);
    if ((reportIntervalTriplesSubject[0] == undefined) || (reportIntervalTriples[0] == undefined) || (reportIntervalValue[0] == undefined) || (reportIntervalUnit[0] == undefined)) {
      serviceIntentParams.reportInterval = null;
    } else if (T('unitSecond').equals(reportIntervalUnit[0])) {
      serviceIntentParams.reportInterval = parseFloat(reportIntervalValue[0].value);
    } else if (T('unitMinute').equals(reportIntervalUnit[0])) {
      serviceIntentParams.reportInterval = parseFloat(reportIntervalValue[0].value * 60);
    } else if (T('unitHour').equals(reportIntervalUnit[0])) {
      serviceIntentParams.reportInterval = parseFloat(reportIntervalValue[0].value * 3600);
    } else {
      serviceIntentParams.reportInterval = -1;
    }
  }
  catch (err) {
    console.log(err);
  };
};


// This function is called from the SI once the intent has been deleted from MOngo
//it deletes the service order in SO over TMF641,
//reads the intent expression from mongo, parses the expression into
//triples and then deletes these triples from the graphdb.
exports.deleteIntent = function(query, resourceType,intentname,req) {
  var serviceOrder;
  var name;
  var children
  var probe=false;
  if (intentname.indexOf("Probe") > 0) {
    serviceOrder = '';
    name = 'Probe;'
    probe=true;
    children = []
  }
  else if (intentname.indexOf("S1") > 0) {
    serviceOrder = 'service_order_HELMET_SERVICE_DELETE.json';
    name = 'S1;'
    children = [...S1_children]
  }
  else if (intentname.indexOf("S2") > 0) {
    serviceOrder = 'service_order_ER_SERVICE_DELETE.json';
    name = 'S2;'
    children = [...S2_children]
  }
  else if (intentname.indexOf("S3") > 0) {
    serviceOrder = 'service_order_CSP_USAGE_CONDITION_DELETE.json';
    name = 'S3;'
    children = [...S3_children]
}
  
  if ((!probe)&&(!sendResource)) sendDeleteServiceOrder(serviceOrder,query.id)

//  console.log('query.id: ' + query.id)
//  console.log('resourceType: ' + resourceType)
  //reads intent from mongo and then deletes objects from KG.  All in one function as async
  handlerUtils.getIntentExpressionandDeleteKG(query, resourceType);
  //delete children intent
  if (sendResource) {
    children.forEach(x => {
      intentHandler.deleteIntentbyName(x.substring(0,x.indexOf('.')),req,false);
      console.log(`log: ${x} Delete`);
    })
  }
  /* 2023 XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    //Call the python server 
    //    handlerUtils23.deletePythonRI(req,query.id);
  handlerUtils23.delete_intents(intentname)
  /* 2023 XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/

};

function sendDeleteServiceOrder(serviceOrder,id) {
  const soUtils = require('../utils/soUtils');
  
  fs.readFile(`./serviceorders/${serviceOrder}`, 'utf8', (err,deleteOrder) => {

    if (err) {
      console.error('unable to read delete service order json file due to error:', err);
      return;
    }
 
    var deleteOrderJson = JSON.parse(deleteOrder);
    //add the service intent id
    var i =  deleteOrderJson.orderItems.length
    deleteOrderJson.orderItems.forEach(orderItem=>{
      orderItem.service.publicIdentifier = id+`_${i}`;
      i=i-1
    })
    console.log("SERVICE ORDER = " + JSON.stringify(deleteOrderJson));

    try {
      soUtils.sendServiceOrder(JSON.stringify(deleteOrderJson));
    }
    catch (error) {
      console.error('SIH: deleteIntent failed with error:', error);
      return;
    }
  });
  
}
// This function is called from the SI once the intentReport has been deleted from MOngo
//it reads the intentReport expression from mongo, parse the expresion into
//triples and then deletes these triples from the graphdb.
exports.deleteIntentReports = function(id, resourceType) {

//  console.log('intentid: ' + id)
//  console.log('resourceType: ' + resourceType)
  //reads intent report from mongo and then deletes objects from KG.  All in one function as async
  handlerUtils.getIntentReportExpressionandDeleteKG(id, resourceType);
};
