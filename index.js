'use strict';

const fs = require('fs'),
      path = require('path'),
      http = require('http'),
      mongoUtils = require('./utils/mongoUtils'),
      soUtils = require('./utils/soUtils'),
      saUtils = require('./utils/saUtils'),
      swaggerUtils = require('./utils/swaggerUtils');
      const handlerUtils23 = require('./utils/handlerUtils23');

const {TError, TErrorEnum, sendError} = require('./utils/errorUtils');

const app = require('connect')();
const swaggerTools = require('swagger-tools');

const serverPort = process.env.SERVER_PORT!==undefined ? process.env.SERVER_PORT:8092;

const intentReportInterval = 60; // seconds


// Correct the url in swagger-ui-dist that points to some demo (like the petstore)
// And add additional useful options
fs.copyFileSync(path.join(__dirname, './index.html_replacement'),
        path.join(__dirname, './node_modules/swagger-ui-dist/index.html'), (err) => {
  if(err) {
    console.log('Unable to replace swagger-ui-dist/index.html file - something wrong with the installation ??');
    process.exit(1);
  }
})

// swaggerRouter configuration
const options = {
  swaggerUi: path.join(__dirname, '/swagger.json'),
  controllers: path.join(__dirname, './controllers'),
  useStubs: process.env.NODE_ENV === 'development' // Conditionally turn on stubs (mock mode)
};

const swaggerDoc = swaggerUtils.getSwaggerDoc();

// Initialize the Swagger middleware
swaggerTools.initializeMiddleware(swaggerDoc, function (middleware) {

  // Interpret Swagger resources and attach metadata to request - must be first in swagger-tools middleware chain
  app.use(middleware.swaggerMetadata());

 // app.use(function (req, res, next) {
 //     res.header("Access-Control-Allow-Origin", "*"); // CORS should be parametrized by configuration
 //     res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
 //     next();
 // });

  // Validate Swagger requests
  app.use(middleware.swaggerValidator({
        validateResponse: false
  }));

  // Error handling for validation
  app.use(errorHandler);

  // Route validated requests to appropriate controller
  app.use(middleware.swaggerRouter(options));

  // Serve the Swagger documents and Swagger UI
  // using the more up-to-date swagger-ui-dist - not the default app.use(middleware.swaggerUi())
  app.use(middleware.swaggerUi({ swaggerUiDir: path.join(__dirname, 'node_modules', 'swagger-ui-dist') }));


  // Login to SO and store the token obtained.
  // Since the token needs to be obtained only once hence it is done during
  // initilization rather than getting it each time an intent is created or deleted
  //soUtils.storeSoTokenAfterLogin();

  // Monitor issues that are reported by the SA in issue repo of graphDB
  var timerId = setTimeout(function sendReport() {
    //console.log("intentReportInterval expired, sending new report");
    timerId = setTimeout(sendReport, intentReportInterval * 1000);
    handlerUtils23.generateReport();

  }, intentReportInterval * 1000);


  // Start the server
  http.createServer(app).listen(serverPort, function () {
    console.log('Your server is listening on port %d (http://localhost:%d)', serverPort, serverPort);
    console.log('Swagger-ui is available on http://localhost:%d/docs', serverPort);
  });

});

// handles timed out requests
function haltOnTimedout(req, res, next) {
    if (!req.timedout) {
        next();
    } else {
        debug("\nrequest timed out!\n");
        next("the request timed out", null, null, null, 504);
    }
}

function errorHandler (err, req, res, next) {
  if(err) {
    if(err.failedValidation) {

      // err is something like 
      // {"code":"SCHEMA_VALIDATION_FAILED",
      //       "failedValidation":true,
      //       "results":{
      //         "errors":[
      //               {"code":"INVALID_TYPE",
      //                "message":"Expected type array but found type object",
      //                "path":["serviceQualificationItem"]}
      //               ],
      //         "warnings":[]},
      //       "path":["paths","/serviceQualificationManagement/v3/serviceQualification",
      //               "post","parameters","0"],
      //       "paramName":"ServiceQualification"}

      // rewrite to the TMForum error code format

      const message = err.results.errors.map(item => item.message).join(", ");
      
      const error = new TError(TErrorEnum.INVALID_BODY, message);
      sendError(res,error);

    } else {
      // err.status and err.body in case of syntax error in incoming request
      // not sending the body back

      const error = new TError(TErrorEnum.INVALID_BODY, "Invalid request");
      sendError(res,error);

    }

  } else {
    next(err,req,res);
  }
};
