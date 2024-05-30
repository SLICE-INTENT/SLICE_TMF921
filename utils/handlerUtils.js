//////////////////////////////////////////////////////
/*              Huawei IRC                          */
/*              Idan Catalyst                       */
/* HandlerUtils:                                    */
/* Functions to support the intent handler          */
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
const notificationUtils = require('../utils/notificationUtils');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const handlerUtils23 = require('../utils/handlerUtils23');

var spec = null;
var swaggerDoc = null;

const EXPRESSION = "expression";

var graphDBEndpoint = null;
var issuegraphDBEndpoint = null;
var graphDBContext = null;

const RDF = $rdf.Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
const ICM = $rdf.Namespace("http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel#");
//Wait between reports, 10s
const wait_number = 0;

//////////////////////////////////////////////////////
// Functions returns the expressionValue            //
// property from theintent request                  //  
//////////////////////////////////////////////////////
function getExpression(req) {
	var expression;
  if(req.body.expression.expressionValue!==undefined) {
  	expression=req.body.expression.expressionValue;
  }  
  return expression;
}

//////////////////////////////////////////////////////
// Functions returns the file name                  //
// to be used to create the intentReport            //  
//////////////////////////////////////////////////////
function intentReportFileName(expression) {
  var filename = '';
  if (expression.indexOf("B1")>0) { 
     filename = 'B1R_catalyst_business_intent_report.ttl'
  } else if (expression.indexOf("S1")>0) { 
    filename = 'S1R_catalyst_service_intent_report.ttl'
  } else if (expression.indexOf("R1")>0) { 
    filename = 'R1R_catalyst_resource_intent_report_slice.ttl'
  } else if (expression.indexOf("R2")>0) { 
    filename = 'R2R_catalyst_resource_intent_report_privateline.ttl'
  }
  return filename;
}

////////////////////////////////////////////////////////
// Deletes the intent without notification            //  
////////////////////////////////////////////////////////
function deleteIntent(id) {
  var query = {
    id: id
  };


  const resourceType = 'Intent';

  mongoUtils.connect().then(db => {
    db.collection(resourceType)
      .deleteOne(query)
      .then(doc => {
        if (doc.result.n == 1) {
//          console.log("intent deleted " + id);

        } else {
          console.log("No resource with given id found");
        }
      }).catch(error => {
        console.log("retrieveIntent before delete: error=" + error);
      });
  })
    .catch(error => {
      console.log("retrieveIntent before delete: error=" + error);
    });
}

////////////////////////////////////////////////////////
// Functions reads mongo to extract intent expression //
// and then parse into triples and delete             //  
////////////////////////////////////////////////////////
function getIntentExpressionandDeleteKG(query,resourceType) {
  mongoUtils.connect().then(db => {
    db.collection(resourceType)
      .findOne(query)
      .then(doc => {
        if(doc) {
          //console.log('doc: '+JSON.stringify(doc));
          //convert to triples and delete
          extractTriplesandKG(doc.expression.expressionValue,`delete`,'text/turtle');
          deleteIntent(doc.id);
        } else {
          console.log("No resource with given id found");
        }
      })
      .catch(error => {
        console.log("retrieveIntent before delete: error=" + error);
      });
  })
  .catch(error => {
    console.log("retrieveIntent before delete: error=" + error);
  });
}

////////////////////////////////////////////////////////
// Deletes the intentreport without notification      //  
////////////////////////////////////////////////////////
function deleteIntentReport(id){
  var query = {
    id: id
  };


  const resourceType = 'IntentReport';

mongoUtils.connect().then(db => {
  db.collection(resourceType)
    .deleteOne(query)
    .then(doc => {
      if (doc.result.n == 1) {
//         console.log("report deleted " + id);

      } else { 
        console.log("No resource with given id found");
      }
    }).catch(error => {
        console.log("retrieveIntent before delete: error=" + error);
      });
  })
  .catch(error => {
    console.log("retrieveIntent before delete: error=" + error);
  });
}

////////////////////////////////////////////////////////
// Functions reads mongo to extract intentreport expression //
// and then parse into triples and delete             //  
////////////////////////////////////////////////////////
function getIntentReportExpressionandDeleteKG(id,resourceType) {
  var intentId = {
    'intent.id':id
  }

  var query = {
    criteria:intentId
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

          doc.forEach(x => {
            console.log('id: '+x.id);
            //convert to triples and delete
            extractTriplesandKG(x.expression.expressionValue,`delete`,'text/turtle');
            deleteIntentReport(x.id);
          });
          })
        })
        .catch(error => {
          console.log("listIntentReport: error=" + error);
        })
      })
      .catch(error => {
        console.log("listIntentReport: error=" + error);
      })
    .catch(error => {
      console.log("listIntentReport: error=" + error);
    })

}


////////////////////////////////////////////////////////
// Functions receives an intent expression and parses  //
// into mongo using RDFLIB                             //
// Because expression is json-ld the parsing is done   //
// async                                               //
// Once parsing is done it will insert or delete,      //
// according to action parameter                       //  
////////////////////////////////////////////////////////
function extractTriplesandKG (expression,action,type,name) {
  var uri = 'http://www.example.org/IDAN3#';
  var mimeType = 'application/ld+json';
  if(type!==undefined) {
    mimeType = type;
  }
  var store = $rdf.graph();
  var triples;
//  console.log('extract Triples for '+name +' action ' + action);

 //create rdf object
 try {
   $rdf.parse(expression, store, uri, mimeType,function (){
    triples = store.statementsMatching(undefined, undefined, undefined);
//    console.log('number of triples: '+triples.length);
    return kgOperation(triples,action);
//    return null;
  })
 } catch (err) {
   console.log("======> extractTriplesandKG Error inserting entry for graph: " + name);
   console.log(err);
 };


};

////////////////////////////////////////////////////////
// Functions receives triples array and insert/deletes //
// into KG                                            //
// Uses innotrade/enapso-graphdb-client               // 
// https://www.npmjs.com/package/@innotrade/enapso-graphdb-client //
////////////////////////////////////////////////////////
function kgOperation(triples,action) {
// Conf file for KG
  initGraphdbEndpointAndContext();
  
  const intent_iri = '<http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel#Intent>';
  const intentreport_iri = 'http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel#IntentReport>';


  
  for (var i=0; i<triples.length;i++) {
    var triple = triples [i];
    var q = action + ` data { graph <${graphDBContext}> { ` + triple.subject +` `+ triple.predicate +` `+ triple.object + ` }}`;
    q = q.replace(/_:/g,'idan:');
  //  console.log('query: '+q); 
    graphDBEndpoint
    .update( q)
    .then((result) => {
//      console.log('OK');
      null;
    })
    .catch((err) => {
//      console.log("failed "+ action + " " + err.message);
    });
  }



}

function initGraphdbEndpointAndContext() {
  if ((graphDBEndpoint == null) || (issuegraphDBEndpoint == null) || (graphDBContext == null)){
    var kgConfig;
    try {
      kgConfig = require('../kgconfig.json');
    } catch (e) {
      console.log(e)
    }

    const { EnapsoGraphDBClient } = require('@innotrade/enapso-graphdb-client');
    // connection data to the GraphDB instance
    const GRAPHDB_BASE_URL = kgConfig.GRAPHDB_BASE_URL,
    GRAPHDB_INTENT_REPOSITORY = kgConfig.GRAPHDB_REPOSITORY,
    GRAPHDB_ISSUE_REPOSITORY = kgConfig.GRAPHDB_ISSUE_REPOSITORY,
    GRAPHDB_USERNAME = kgConfig.GRAPHDB_USERNAME,
      GRAPHDB_PASSWORD = kgConfig.GRAPHDB_PASSWORD,
      GRAPHDB_CONTEXT_TEST = "http://www.example.org/IDAN3#",
      GRAPHDB_CONTEXT_SHACL = 'http://rdf4j.org/schema/rdf4j#SHACLShapeGraph';
    const DEFAULT_PREFIXES = [
      EnapsoGraphDBClient.PREFIX_OWL,
      EnapsoGraphDBClient.PREFIX_RDF,
      EnapsoGraphDBClient.PREFIX_RDFS,
      EnapsoGraphDBClient.PREFIX_XSD,
      EnapsoGraphDBClient.PREFIX_PROTONS,
      {
        prefix: "idan",
        iri: "http://www.example.org/IDAN3#",
      },
      {
        prefix: "cem",
        iri: "http://tio.labs.tmforum.org/tio/v1.0.0/CatalystExtensionModel#"
      }
    ];

    graphDBContext = GRAPHDB_CONTEXT_TEST;

    graphDBEndpoint = new EnapsoGraphDBClient.Endpoint({
      baseURL: GRAPHDB_BASE_URL,
      repository: GRAPHDB_INTENT_REPOSITORY,
      prefixes: DEFAULT_PREFIXES
    });

    issuegraphDBEndpoint = new EnapsoGraphDBClient.Endpoint({
      baseURL: GRAPHDB_BASE_URL,
      repository: GRAPHDB_ISSUE_REPOSITORY,
      prefixes: DEFAULT_PREFIXES
    });

    // connect and authenticate
    graphDBEndpoint.login(GRAPHDB_USERNAME, GRAPHDB_PASSWORD)
      .then((result) => {
        console.log(result);
      })
      .catch((err) => {
        console.log(err);
        return;
      });
    issuegraphDBEndpoint.login(GRAPHDB_USERNAME, GRAPHDB_PASSWORD)
      .then((result) => {
        console.log(result);
      })
      .catch((err) => {
        console.log(err);
        return;
      });

  }
}

function deleteAllKGData() {
    initGraphdbEndpointAndContext();

  var query = `select * from <${graphDBContext}> where {?s ?p ?o}`;
  //console.log('QUERY3 = ' + query);

  graphDBEndpoint
  .query(query, { transform: 'toJSON' })
  .then((result) => {
  //console.log('QUERY3 OK');
  //console.log('RESULT = ' + JSON.stringify(result))

    if (result.success) {
      for (var j = 0; j < result.total; j++) {
        query = `delete data {graph <${graphDBContext}> { <${result.records[j].s}> <${result.records[j].p}> <${result.records[j].o}> }}`;
        //console.log('QUERY4 = ' + query);

        graphDBEndpoint
        .update(query)
        .then((result) => {
                    //console.log('QUERY4 OK');
          //console.log('RESULT = ' + JSON.stringify(result))
        })
        .catch((err) => {
//          console.log("failed to delete from graphDB " + err.message);
        });
      }
    }
  })
  .catch((err) => {
//    console.log("failed to read graphDB " + err.message);
  });

}
////////////////////////////////////////////////////////
// Uses the intent report expression that was read from hardcoded file  //
// creates full intent report message                 //
// stores the intent report into mongo                //
// generates event (notify)                           //
////////////////////////////////////////////////////////
function insertIntentReport(message,req1) {
  const resourceType = 'IntentReport';

  mongoUtils.connect().then(db => {
  db.collection(resourceType)
    .insertOne(message)
    .then(() => {

//      console.log("createReport: loaded into Mongo");
      cleanmessageid(message);
      //generates the intentreport creation event
      //notificationUtils.publish(req1,message);

      //////////////////////////////
      //// port report to python 
      //handlerUtils23.postPythonRI(req.originalUrl+'/'+message.intent.id+'/intentReport',message.id,message);
      handlerUtils23.process_reports(message.expression.expressionValue,message.intent.id,message.id,req1)

      //process_report
      process_reports(message.expression.expressionValue,message.intent.id,message.id,req1)
      ///////////////////////////////////

    })
    .catch((error) => {
      console.log("createReport: error=" + error);
    })
})
}

function get_uri_short_name(obj) {
  var split_obj = obj.substring(obj.indexOf('#')+1)
  return split_obj
}

function process_reports (expression,intentid,id,req) {
  var uri = 'http://www.example.org/IDAN3#';
  var mimeType = 'text/turtle';

  var store = $rdf.graph();

 //create rdf object
 try {
   $rdf.parse(expression, store, uri, mimeType,function (){
    var report = store.each(undefined, RDF('type'), ICM('IntentReport'));
    var state = store.each(report[0], ICM('reportHandlingState'),undefined);
    var intent = store.each(report[0], ICM('about'),undefined);

    //send service degraded report if resource is degraded
    var stopSending = false
    if ((intent[0].value.indexOf("R1_1")>0) ) {
      if (get_uri_short_name(state[0].value)=="StateDegraded") 
         var x = 'S1R3_Intent_Degraded'
      else
         var x = 'S1R2_Intent_Compliant'
      //send degraded report for S1
      if (!stopSending) sendIntentReport(x, x+'.ttl', req);
      console.log(`log: ${x} Intent Posted`);
    } else if ((intent[0].value.indexOf("R2_1")>0)) {
      if (get_uri_short_name(state[0].value)=="StateDegraded") 
         var x = 'S2R3_Intent_Degraded'
      else
         var x = 'S2R2_Intent_Compliant'
      sendIntentReport(x, x+'.ttl', req);
      console.log(`log: ${x} Intent Posted`);    
    } else if ((intent[0].value.indexOf("R3_1")>0)) {
      if (get_uri_short_name(state[0].value)=="StateDegraded") 
         var x = 'S3R3_Intent_Degraded'
      else
         var x = 'S3R2_Intent_Compliant'
      sendIntentReport(x, x+'.ttl', req);
      console.log(`log: ${x} Intent Posted`);
    } else if ((intent[0].value.indexOf("1_3")>0)) {
      if (get_uri_short_name(state[0].value)=="StateDegraded") 
         var x = 'S1R3_Intent_Degraded'
      else
         var x = 'S1R2_Intent_Compliant'
      stopSending = true
      sendIntentReport(x, x+'.ttl', req);
      console.log(`log: ${x} Intent Posted`);
    }
  })
 }
 catch (err) {
  console.log(err)
 }
}
////////////////////////////////////////////////////////
// Generates intent report message                    //
////////////////////////////////////////////////////////
function createIntentReportMessage(name,data,req) {
  var intent_uuid = req.body.id;
  var intent_name ;
  var intent_href 
  
  if (name.indexOf('R11')>=0 || name.indexOf('R21')>=0 || name.indexOf('R31')>=0) {
    intent_uuid=req.body.name
  } else if (name.indexOf('R12')>=0 || name.indexOf('R22')>=0 || name.indexOf('R23')>=0) {
    intent_name=req.body.name
  } else if (name.indexOf('R13')>=0 || name.indexOf('R23')>=0 || name.indexOf('R33')>=0) {
    intent_name=req.body.name
  }
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
  if (intent_name==undefined) {
    var intent = {
      href: intent_href,
      id: intent_uuid 
    };
  } else {
    var intent = {
      href: intent_href,
      id: 'xxx',
      name: intent_name
    };
  }

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

////////////////////////////////////////////////////////
// Generates intent report request, to be used for the //
// notification event                                  //
////////////////////////////////////////////////////////
function createIntentReportReq(req,resourceType) {
  var operationPath = {
    0: 'paths',
    1: '/intent/{intentId}/intentReport',
    2: 'post'
  }
  var swagger1 = {
    operationPath: operationPath
  };

  var req1 = {
    method: 'POST',
    resourceType: resourceType,
    swagger: swagger1,
    url: req.url,
    name: 'Intent Report ABC'
  };
  return req1;
}

////////////////////////////////////////////////////////
// Removes _id from  message                          //
////////////////////////////////////////////////////////
function cleanmessageid(message) {
  delete message._id;
  return message
}

////////////////////////////////////////////////////////
// Function used to send intent reports               //
////////////////////////////////////////////////////////
function sendIntentReport(name,filename,req) {
  fs.readFile('./ontologies/'+filename, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return;
    }

    data = addTimestamp(data);

 //   console.log(data);
  //2. insert report in grapbdb
  console.log('=====> Posting report before extractTriplesandKG: '+name)
  extractTriplesandKG(data,`insert`,'text/turtle',name);
  console.log('=====> Posting report after extractTriplesandKG: '+name)

 //3. insert report into mongodb and send notification
   const resourceType = 'IntentReport';
   //generates message
   const message = createIntentReportMessage(name,data,req);
   //generates request for the notification
   const req1 = createIntentReportReq(req,resourceType);
 
  insertIntentReport(message,req1);
  //4. create event
//  inside the previous step as async
//  wait(10000)
  console.log('Posted report: '+name)
});

}

function sendIntentReportEvent(name,filename,req) {
  fs.readFile('./ontologies/'+filename, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return;
    }

    data = addTimestamp(data);
    insertReportEvent(name,data,req)
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

    handlerUtils23.postIntentReportCreationEvent(event)

}

async function processIntentReportEvent(event,req) {

  await retrieveIntentByName(event.event.intentReport.intent.name,event.event.intentReport.intent.id)
  .then (intentid => {

    var intId
    var intHref
    if (intentid[0] == undefined) {
      intId = event.event.intentReport.intent.id
      intHref = event.event.intentReport.intent.href
    } else {
      intId = intentid[0].id
      intHref = intentid[0].href
    }
    event.event.intentReport.intent.id = intId
//    console.log('Intent id in the request ' + event.event.intentReport.intent.id)
    event.event.intentReport.href=intHref+'/intentReport/'+event.event.intentReport.id
    //   console.log(data);
    //2. insert report in grapbdb
    extractTriplesandKG(event.event.intentReport.expression.expressionValue,`insert`,'text/turtle',event.event.intentReport.name);

    //3. insert report into mongodb and send notification
    insertIntentReport(event.event.intentReport,req);

    console.log('Posted report: '+event.event.intentReport.name)
  })
      .catch((error) => {
        console.error('Error in processIntentReportEvent function', error);
      });
}

////////////////////////////////////////////////////////
// Function used to send intent reports               //
////////////////////////////////////////////////////////
function sendIntentReportandFindID(name,filename,req) {
  fs.readFile('./ontologies/'+filename, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return;
    }

    data = addTimestamp(data);

 //   console.log(data);
  //2. insert report in grapbdb
  extractTriplesandKG(data,`insert`,'text/turtle');

 //3. find parentid
  var id = req.body.event.intentReport.intent.id
  var parentId;

 var query = mongoUtils.getMongoQuery(req);
 query.criteria.id = id

 query = swaggerUtils.updateQueryServiceType(query, req,'id');

 var resourceType = 'Intent'; 
 const internalError =  new TError(TErrorEnum.INTERNAL_SERVER_ERROR, "Internal database error");

 mongoUtils.connect().then(db => {
   db.collection(resourceType)
     .findOne(query.criteria, query.options)
     .then(doc => {
       if(doc) {
         parentId = doc.version;
         console.log('ID: '+id+ ' parentId: '+parentId);
         req.body.id = parentId;
//3. insert report into mongodb and send notification
         insertIntentReport(name,data,req);
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

 //4. create event
//  inside the previous step as async


});
}


function wait(ms){
  var start = new Date().getTime();
  var end = start;
  while(end < start + ms) {
    end = new Date().getTime();
 }
}

////////////////////////////////////////////////////////
// Generates intent report message                    //
////////////////////////////////////////////////////////
function createIntentMessage(name,data,version) {
  
  var date = new Date();
  var date_start = date.toISOString();
  var date_end = (new Date(date.getFullYear()+1, date.getMonth(), date.getDate())).toISOString();
  if (version==undefined) version = "1"
  //expression
  var type
  var language
  if (name.indexOf('ACTN')>0) {
    type= "JsonExpression", 
    language= "Json"
  } else {
    type= "TurtleExpression", 
    language= "Turtle"
  }
  var expression = {
    iri: "http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel",
    "@baseType": "Expression",
    "@type": type, 
    expressionLanguage: language,
    expressionValue: data,
    "@schemaLocation": "https://mycsp.com:8080/tmf-api/schema/Common/TurtleExpression.schema.json",
  };

  var message = {
    creationDate: date_start,
    expression: expression,
    name: name,
    description: name,
    '@schemaLocation': "https://mycsp.com:8080/tmf-api/schema/Common/TurtleExpression.schema.json",
    lifecycleStatus: "Created",
    '@baseType': "Intent",
    validFor: {
      startDateTime: date_start,
      endDateTime: date_end
    },
    '@type': "Intent",
    'version': version
    };  

  return message;

};

////////////////////////////////////////////////////////
// POST a new Intent to the next layer               //
////////////////////////////////////////////////////////
function postIntent(name,filename,req) {
    fs.readFile('./ontologies/'+filename, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return;
    }
    
      var xhttp = new XMLHttpRequest();

      xhttp.addEventListener('error', function() {
         console.log( 'an error occurred while waiting for a XHTTP response ');
      });

      xhttp.onreadystatechange = function() {
       if (this.readyState == 4 && this.status == 200) {
           //do nothing for now
           null;
           //alert(this.responseText);
       }
      };
      var url = 'http://'+req.headers.host+req.originalUrl;
      console.log('URL: '+url+ ' Intent: '+name);
      xhttp.open("POST", url, true);
      xhttp.setRequestHeader("Content-Type", "application/json");
      xhttp.setRequestHeader("Accept", "application/json");
    
      var payload = createIntentMessage(name,data);
      payload.version=req.body.id;
      payload = JSON.stringify(payload);
    
      xhttp.send(payload);
    
  });
};

////////////////////////////////////////////////////////
// PATCH Intent               //
////////////////////////////////////////////////////////
function patchIntent(name,filename) {
  fs.readFile('./ontologies/'+filename, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return;
    }
//3. find parentid
var id;
var query = {
  name: 'R1_Intent_Slice_Core'
};



var resourceType = 'Intent'; 
const internalError =  new TError(TErrorEnum.INTERNAL_SERVER_ERROR, "Internal database error");

mongoUtils.connect().then(db => {
  db.collection(resourceType)
  .find(query).toArray()
  .then(doc => {

    doc.forEach(x => {
      id = x.id;
      //3. insert report into mongodb and send notification
      var xhttp = new XMLHttpRequest();
      xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
            //do nothing for now
            null;
           //alert(this.responseText);
        }
      };

    const serverPort = process.env.SERVER_PORT!==undefined ? process.env.SERVER_PORT:8092;
    var url = 'http://localhost:' + serverPort + '/tmf-api/intent/v4/intent/'+id;
    console.log('URL: '+url);
    xhttp.open("PATCH", url, true);
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.setRequestHeader("accept", "application/json");

    var payload = createIntentMessage(name,data,x.version);
    payload = JSON.stringify(payload);

    xhttp.send(payload);
    
    return
    })

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


  });
};

function addTimestamp (data) {
  var date = new Date().toISOString();
  var date_in_report= 'date_to_be_generated';
  var a = data.indexOf(date_in_report);
  return data.replace(date_in_report,"\"'"+date+"'\"");
}

function createIssue(serviceId,id) {
  console.log('log: creatingissue');
  initGraphdbEndpointAndContext()
  return new Promise(function (resolve, reject) {
    const serviceIdIri = "http://www.example.org/IDAN3#";

    // issueget serviceID of the issue
    var issue = "http://www.example.org/IDAN3#ServiceIntent_DelayExpectation_Violation_"+id+">"
    var type = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>"
    var issuemodel = "<http://tio.labs.tmforum.org/tio/v1.0.0/CatalystExtensionModel#issue>"
    var q = `insert data { graph <${graphDBContext}> { ` + issue +` ` +type +` ` + issuemodel + ` }}`
    console.log('QUERY1 = ' + q);
    issuegraphDBEndpoint.update( q).then((result) => {null;}).catch((err) => {console.log("failed " + err.message);});
    // issueget serviceID of the issue
    var objectmodel = "<http://tio.labs.tmforum.org/tio/v1.0.0/CatalystExtensionModel#monitored_object>"
    var object = "<http://www.example.org/IDAN3#"+serviceId+">"
    q = `insert data { graph <${graphDBContext}> { ` + issue +` ` +objectmodel +` ` + object + ` }}`
    console.log('QUERY2 = ' + q);
    issuegraphDBEndpoint.update( q).then((result) => {null;}).catch((err) => {console.log("failed "+ err.message);});
  });
}

function checkandSendReport(payload,req) {
  var filename;
 //Provisioning flow
 //S3 -> R31 -> get R3R1
/*
  if (payload.indexOf("S1R1")>0){ // check whether it's a resource intent
     filename = 'B1R2_Intent_Degraded.ttl'
     sendIntentReportandFindID('B1R2_Intent_Degraded',filename,req);;
     console.log('log: B1 Report Degraded 1 sent');
  }
  //S1R2 -> B1R3
  else if (payload.indexOf("S1R2")>0){ // check whether it's a resource intent
    filename = 'B1R3_Intent_Degraded.ttl'
    sendIntentReportandFindID('B1R3_Intent_Degraded',filename,req);
    console.log('log: B1 Report Degraded 2 sent');
  }
*/

}

async function retrieveIntentByName (nameInReport,id) {
  var name
  if (nameInReport!=undefined)
    name=nameInReport
  else 
    name=id

  var criteria = {
      name: name
    }
  
  var query = {
      criteria:criteria
  }
  console.log("Retrieving Intent: "+name+' '+id)
  return await mongoUtils.connect().then(db => {
    return db.collection('Intent').find(query.criteria, query.options).toArray()
  })    .catch((err) => {
          console.log("failed Retrieving Intent: "+name + ' ' + id + err.message);
        });


};

module.exports = { 
  getExpression,
  getIntentExpressionandDeleteKG,
  getIntentReportExpressionandDeleteKG,
  kgOperation,
  extractTriplesandKG,
  insertIntentReport,
  createIntentReportMessage,
  createIntentReportReq,
  intentReportFileName,
  sendIntentReport,
  sendIntentReportEvent,
  postIntent, 
  patchIntent,
  wait,
  createIntentMessage,
  checkandSendReport,
  deleteAllKGData,
  createIssue,
  processIntentReportEvent,
  retrieveIntentByName,
  insertReportEvent
				   			 };
