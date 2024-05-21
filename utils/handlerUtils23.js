//////////////////////////////////////////////////////
/*              Huawei IRC                          */
/*              demo                     */
/* HandlerUtils:                                    */
/* Functions to support the intent handler          */
//////////////////////////////////////////////////////

'use strict';

var fs = require('fs'),
    path = require('path'),
    jsyaml = require('js-yaml');

const Math = require('mathjs');

const {TError, TErrorEnum, sendError} = require('./errorUtils');
const swaggerUtils = require('./swaggerUtils');
const mongoUtils = require('./mongoUtils');
const intentService = require('../service/IntentService');
const $rdf = require('rdflib');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const uuid = require('uuid');
const notificationUtils = require('../utils/notificationUtils');
const fetch = require('node-fetch');
const processObjectives = require('./processObjectives');

const server = process.env.GRAPHQL_ENGINE_URL!==undefined ? process.env.GRAPHQL_ENGINE_URL:"10.81.1.26"
console.log("Server: "+server)
const RDF = $rdf.Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
const RDFS = $rdf.Namespace("http://www.w3.org/2000/01/rdf-schema#");
const IDAN = $rdf.Namespace("http://www.example.org/IDAN3#");
const ICM = $rdf.Namespace("http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel#");
const CEM = $rdf.Namespace("http://tio.labs.tmforum.org/tio/v1.0.0/CatalystExtensionModel#");
const MET = $rdf.Namespace("http://www.sdo2.org/TelecomMetrics/Version_1.0#");
const T = $rdf.Namespace("http://www.w3.org/2006/time#");
const IMO = $rdf.Namespace("http://tio.models.tmforum.org/tio/v3.2.0/IntentManagmentOntology#");
const LOGI = $rdf.Namespace("http://tio.models.tmforum.org/tio/v3.2.0/LogicalOperators#");

const handlerUtils = require('../utils/handlerUtils');

var generateIntentReport=[];


const persist =require('./persistgql');

var spec = null;
var swaggerDoc = null;

const EXPRESSION = "expression";
var graphDBEndpoint = null;
var graphDBContext = null;
//////////////////////////////////////////////////////
// Functions returns the expressionLanguage         //
// property from theintent request                  //  
//////////////////////////////////////////////////////
function postIntentReportCreationEvent(event) {
  const url = `http://${server}:8092/tmf-api/intent/v4/listener/intentReportCreateEvent`
//  const url = `http://localhost:8092/tmf-api/intent/v4/listener/intentReportCreateEvent`
  //console.log('XXX: In 23 '+url);
    
    post(url,event)
}

function postACTN(name,data,id,parent_id) {
  const url_huawei = `http://${server}:18181/restconf/data`
  const url_other = `http://${server}:28181/restconf/data`

  
    try {
      var payload = JSON.parse(data)
    } catch (err) {
      console.log('err '+ err)
    }
    
    post(url_huawei+"/ietf-te:te/tunnels",payload.huawei_tunnel);
    post(url_huawei+"/ietf-eth-tran-service:etht-svc",payload.huawei_service,'PATCH');
    post(url_other+"/ietf-te:te/tunnels",payload.other_tunnel)
    post(url_other+"/ietf-eth-tran-service:etht-svc",payload.other_service,'PATCH');
  
  //save in graphql
    process_ACTN(name,id,parent_id)
  
}
function deleteACTN(name) {
  const url_huawei = `http://${server}:18181/restconf/data`
  const url_other = `http://${server}:28181/restconf/data`

  var tunnel_name=''
  var service_name=''
  if (name.indexOf('Construction_ACTN'>0)) {
    tunnel_name='IR1_2_Construction_tunnel'
    service_name='IR1_2_Construction_service'
  } else {
    tunnel_name='IR2_2_Emergency_tunnel'
    service_name='IR2_2_Emergency_service'

  }
  
    

    post(url_huawei+`/ietf-eth-tran-service:etht-svc/etht-svc-instances=${service_name}/etht-svc-end-points=uni-01`,'','DELETE');
    post(url_huawei+`/ietf-eth-tran-service:etht-svc/etht-svc-instances=${service_name}`,'','DELETE');
    post(url_huawei+`/ietf-te:te/tunnels/tunnel=${tunnel_name}`,'','DELETE');
    post(url_other+`/ietf-eth-tran-service:etht-svc/etht-svc-instances=${service_name}/etht-svc-end-points=uni-04`,'','DELETE');
    post(url_other+`/ietf-eth-tran-service:etht-svc/etht-svc-instances=${service_name}`,'','DELETE');
    post(url_other+`/ietf-te:te/tunnels/tunnel=${tunnel_name}`,'','DELETE')
  

}
async function post(url,body,method) {
//    console.log ('Post message to: '+url)

  const response = await fetch(url, {
  method: method?method:'POST',
  headers: {
      'Accept': '*/*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
  })
  .then((response) => {
    if (!response.ok) {
      throw new Error('Http response was not OK for '+url);
    }
//    console.log("POST Order sent successfully!");
  })
  .catch((error) => {
    console.error('POST failed with error:', error);
  });
};

function deletePythonRI(req,id) {
  var conf = readConf();
  var xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
       if (this.readyState == 4 && this.status == 200) {
           //do nothing for now
           null;
           //alert(this.responseText);
       }
  };
  var url=req.originalUrl;
  
  if (id) {
     var a=url.slice(0,url.indexOf('/v4/intent/')+11)
     url=a+id
  }

  xhttp.open("DELETE", conf.pythonServer + url, true);
  xhttp.setRequestHeader("Content-type", "application/json");
  xhttp.setRequestHeader("accept", "application/json");
  
  
  xhttp.send();


};

function readConf() {
  var conf;
  try {
      conf = require('../config.json');
      console.log("Loaded config");
  } catch (e) {
      console.log(e)
  }
  return conf;
}


async function process_intents (expression,id,version) {
  var uri = 'http://www.example.org/IDAN3#';
  var mimeType = 'text/turtle';

  var store = $rdf.graph();

 //create rdf object
 try {
   $rdf.parse(expression, store, uri, mimeType,function (){
     var intents = prepare_intents (store,id)
     var values = prepare_expectations (store)
     var expectations = values [0]
     var objectives = values [1]
     var hierarchy = prepare_hierarchy (store,version)
     
     insert_intents(intents,expectations,objectives,hierarchy,version)
 
  })
 }
 catch (err) {
  console.log(err)
 }
}

async function insert_intents (intents,expectations,objectives,hierarchy,version) {
  const response = await persist.processIntents (intents)
  .then ((result) => persist.processExpectations (expectations))
  .then ((result) => persist.processObjectives (objectives))
  .then ((result) => persist.queryHierarchy (version))
  .then ((result) => persist.hierarchyResults(result))  
  .then ((parent) => persist.processHierarchy(parent,hierarchy)) 

}
function process_ACTN (name,id,version) {
 //create rdf object
 try {
    var intents = {
      intent: name,
      intent_id: id,
      description: "ACTN Intent",
      intentType: "resource",
      domain: "Transport"
    }

    persist.processIntents (intents)
    .then ((result) => persist.queryHierarchy (version))
    .then ((result) => persist.hierarchyResults(result))  
    .then ((parent) => persist.processHierarchy(parent,name))  
 }
 catch (err) {
  console.log(err)
 }
}

function get_uri_short_name(obj) {
    var split_obj = obj.substring(obj.indexOf('#')+1)
    return split_obj
}

function prepare_intents(store,id) {
  var intent = store.each(undefined, RDF('type'), ICM('Intent'));
  var comment = store.each(intent[0], RDFS('comment'),undefined);
  var layer = store.each(intent[0], CEM('layer'),undefined);
  var owner = store.each(intent[0], IMO('intentOwner'),undefined);
  
  var intent_obj = {
    intent: get_uri_short_name(intent[0].value),
    intent_id: id,
    description: comment[0]?comment.value:"",
    intentType: layer[0]?get_uri_short_name(layer[0].value):"",
    domain: owner[0]?get_uri_short_name(owner[0].value):""
  }

  console.log(intent_obj)
  return intent_obj
}

function prepare_expectations (store) {
  var intent = store.each(undefined, RDF('type'), ICM('Intent'));
  var expectations = store.each(intent[0], ICM('hasExpectation'),undefined);
  
  var exp_array = []
  var obj_array = []
  expectations.forEach(exp => {
    var type = store.each(exp, RDF('type'),undefined);
    var target = store.each(exp, ICM('target'),undefined);
    var comment = store.each(exp, RDFS('comment'),undefined);

    //objectives
    obj_array.push(...processObjectives.objectives(store,exp,get_uri_short_name(intent[0].value)))

    var exp_obj = {
      intent: get_uri_short_name(intent[0].value),
      expectation: get_uri_short_name(exp.value),
      expectationType: type[0]?get_uri_short_name(type[0].value):"",
      description: comment[0]?comment.value:"",
      target: target[0]?get_uri_short_name(target[0].value):""
    }
    exp_array.push(exp_obj)
  })
  
  return [exp_array, obj_array]

};

function prepare_hierarchy (store,child) {
  var intent = store.each(undefined, RDF('type'), ICM('Intent'));
  return get_uri_short_name(intent[0].value)
  
};

async function process_reports (expression,intentid,id,req) {
  var uri = 'http://www.example.org/IDAN3#';
  var mimeType = 'text/turtle';

  var store = $rdf.graph();

 //create rdf object
 try {
   $rdf.parse(expression, store, uri, mimeType,function (){
     var values = prepare_reports (store,id)
     var  reports = values [0]
     var objectives = values [1]


    persist.processReports (reports)
    .then ((result) => {
  
      objectives.forEach (obj => {
        persist.queryValues (obj.intent,obj.objective)
        .then ((result) => persist.processValues (result,obj))
      })
    })
  })
 }
 catch (err) {
  console.log(err)
 }
}

function prepare_reports(store,id) {
  var report = store.each(undefined, RDF('type'), ICM('IntentReport'));
  var state = store.each(report[0], ICM('reportHandlingState'),undefined);
  var intent = store.each(report[0], ICM('about'),undefined);
  var seq = store.each(report[0], ICM('reportNumber'),undefined);
  
  var obj_array = []
  var report_obj = {
    intentReport: get_uri_short_name(report[0].value),
    intentReport_id: id,
    state: state?get_uri_short_name(state[0].value):"",
    intent: intent?get_uri_short_name(intent[0].value):"",
    sequence: seq?seq[0].value:""
  }
  console.log('New report arrived, procesing values ')
  console.log(report_obj)

  //objectives
  obj_array.push(...processObjectives.values(store,report[0],get_uri_short_name(intent[0].value)))


  return [report_obj, obj_array]
}

function delete_intents (intent) {
  console.log("Deleting intent: "+intent)
  try {
    persist.deleteValues(intent)
    .then((result) => persist.deleteObjectives (intent))
    .then((result) => persist.deleteExpectations (intent))
    .then((result) => persist.deleteReports (intent))
    .then((result) => persist.deleteHierarchy (intent))
    .then((result) => persist.deleteIntents (intent))
  }  
 catch (err) {
  console.log(err)
 }
}

function addGenerateIntentReport(intentReport,req){
  if (generateIntentReport.indexOf(intentReport) < 0) 
    generateIntentReport.push({name:intentReport,req: req, reportNumbers:0})
}
function removeGenerateIntentReport(intentReport){
  generateIntentReport.forEach(rep => {
    if (rep.name == intentReport)
      generateIntentReport.splice(rep, 1);
      return
  })
}

function addTimestamp (data) {
  var date = new Date().toISOString();
  var date_in_report= 'date_to_be_generated';
  var a = data.indexOf(date_in_report);
  return data.replace(date_in_report,"\"'"+date+"'\"");
}

function changeReportNumber (data,key) {
  var reportNumber= 'icm:reportNumber 2';
  var newReportNumber = generateIntentReport[key].reportNumbers+3
  var newLine = reportNumber.substring(0,reportNumber.length-1)+ newReportNumber
  generateIntentReport[key].reportNumbers=generateIntentReport[key].reportNumbers+1
  return data.replace(reportNumber,newLine  );
}

function S1_generateRandomValue (data) {
  var bandwidth= 'idan:Bandwidth 9435';
  var delay='idan:Delay 0.95'

  var value1 = Math.floor(Math.random() * 10000);
  var value2 = Math.round(Math.random() * 100) / 100;
  var newLine1 = bandwidth.substring(0,bandwidth.length-4)+ value1
  var newLine2 = delay.substring(0,delay.length-4)+ value2
  return data.replace(bandwidth,newLine1).replace(delay,newLine2);
}

function R11_generateRandomValue (data) {
  var latency= 'idan:RanLatency 10';
  var tp='idan:RanThroughput 150'
  var power='Powerconsumption 34'

  var value1 = Math.floor(5 + Math.random() * 10);
  var value2 = Math.floor(100+ Math.random() * 50);
  var value3 = Math.floor(25+ Math.random() * 25);
  var newLine1 = latency.substring(0,latency.length-2)+ value1
  var newLine2 = tp.substring(0,tp.length-3)+ value2
  var newLine3 = power.substring(0,power.length-2)+ value3
  return data.replace(latency,newLine1).replace(tp,newLine2).replace(power,newLine3);
}

function generateReport(){
  console.log('Automatic Report '+generateIntentReport.length)
  generateIntentReport.forEach(report => {
      console.log('Regular report '+report.name)
      fs.readFile('./ontologies/'+report.name+'.ttl', 'utf8', (err, data) => {
        if (err) {
          console.error(err);
          return;
        }
        if (report.reportNumbers<10) { 

           data = addTimestamp(data);
           data = changeReportNumber(data,generateIntentReport.indexOf(report));
           if (report.name.indexOf("S1")>=0) data = S1_generateRandomValue(data);
           else if (report.name.indexOf("R11")>=0) data = R11_generateRandomValue(data);
           else if (report.name.indexOf("R21")>=0) data = R11_generateRandomValue(data);
           else if (report.name.indexOf("R31")>=0) data = R11_generateRandomValue(data);

          insertReportEvent(report.name,data,report.req);
          console.log(`log: Regular Intent Posted ${report.name}`);
        }
    });
    
  })
}

function insertReportEvent(name,data,req) {

  const resourceType = 'IntentReport';
  //generates message
  const message = createIntentReportMessage(name,data,req);

  var event = {
    eventId:   uuid.v4(),
    eventTime: new Date().toISOString(),
    eventType: "IntentReportCreationNotification",
    event: {intentReport: message}
  }

  postIntentReportCreationEvent(event)

}
function createIntentReportMessage(name,data,req) {
  var intent_uuid = req.body.id;
  var intent_href 
  
  if (req.body.href!==undefined)
     intent_href=req.body.href;
  else 
     intent_href='http://'+req.headers.host+'/tmf-api/intent/v4/intent/'+intent_uuid;
  
    //expression
  var expression = {
    iri: "http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel",
    "@baseType": "Expression",
    "@type": "TurtleExpression", 
    expressionLanguage: "Turtle",
    expressionValue: data,
    "@schemaLocation": "https://mycsp.com:8080/tmf-api/schema/Common/TurtleExpression.schema.json",
  };

  //intent
  var intent = {
    href: intent_href,
    id: intent_uuid 
  };

  var id = uuid.v4();
  var message = {
    id: id,
    href: intent_href+'/intentReport/'+id,
    name: name,
    creationDate: (new Date()).toISOString(),
    expression: expression,
    intent: intent
  };
  return message;

}
module.exports = { 
  process_intents,
  process_reports,
  delete_intents,
  postIntentReportCreationEvent,
  postACTN,
  deleteACTN,
  addGenerateIntentReport,
  removeGenerateIntentReport,
  generateReport
 };
