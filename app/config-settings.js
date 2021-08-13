


//
// global variables
//
const { data } = require('jquery');
var nodeConsole = require('console');           // for access to console
var myConsole = new nodeConsole.Console(process.stdout, process.stderr); // for console logging
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
const Store = require('./store');
const remote = require('electron').remote;


const config = new Store({
    configName: 'default',
    defaults: {
        "s3": {
            "accessKey": "josh",
            "secretAccessKey": "test",
            "endpoint": "myendpoint"
        },
        "encryption": {
            "encryptionKey": "testkey",
            "encryptionFolder": "folder"
        },
        "config": {
            "numThreads": "3"
        }
    }
  });

//
// set input text values on default
//
try {
    var endpoint = document.getElementById("txtEndpoint");
    endpoint.value = config.get("s3.endpoint");
    var accessKey = document.getElementById("txtAccessKey");
    accessKey.value = config.get("s3.accessKey");
    var secretAccessKey = document.getElementById("txtSecretAccessKey");
    secretAccessKey.value = config.get('s3.secretAccessKey');
    var numThreads = document.getElementById("txtNumThreads");
    numThreads.value = config.get("config.numThreads");
} catch (err) {
    myConsole.log(err);
}


function saveS3Connection() {
    myConsole.log("saving s3 properties");
    let endpoint = document.getElementById("txtEndpoint").value;
    config.set("s3.endpoint", endpoint);
    let accessKey = document.getElementById("txtAccessKey").value;
    config.set("s3.accessKey", accessKey);
    let secretAccessKey = document.getElementById("txtSecretAccessKey").value;
    config.set("s3.secretAccessKey", secretAccessKey);
    let numThreads = document.getElementById("txtNumThreads").value;
    config.set("config.numThreads", numThreads);
    alert("values set.");
}

function cancel() {
    
}