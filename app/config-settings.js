


//
// global variables
//
const { data } = require('jquery');
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
const Store = require('./store');
var electron = require('electron');
var ipcRenderer = electron.ipcRenderer;

const config = new Store({
    configName: 'default',
    defaults: {
        "s3": {
            "accessKey": "josh",
            "secretAccessKey": "test",
            "endpoint": "myendpoint"
        },
        "encryption": {
            "passphrase": "testkey",
            "tmpDir": "folder"
        },
        "config": {
            "numThreads": "3"
        }
    }
  });

document.getElementById("saveButton").addEventListener("click", saveConfigSettings);
document.getElementById("backButton").addEventListener("click", backToMain);

//
// set input text values on default
//
try {
    var awsRegion = document.getElementById("txtRegion");
    awsRegion.value = config.get("s3.awsRegion");
    var endpoint = document.getElementById("txtEndpoint");
    endpoint.value = config.get("s3.endpoint");
    var accessKey = document.getElementById("txtAccessKey");
    accessKey.value = config.get("s3.accessKey");
    var secretAccessKey = document.getElementById("txtSecretAccessKey");
    secretAccessKey.value = config.get('s3.secretAccessKey');
    var defaultBucket = document.getElementById("txtDefaultBucket");
    defaultBucket.value = config.get("s3.defaultBucket");

    // threads
    var numThreads = document.getElementById("txtNumThreads");
    numThreads.value = config.get("config.numThreads");

    // encryption
    var encPass = document.getElementById("txtEncPass");
    encPass.value = config.get("encryption.passphrase");

    // bandwidth
    var bandwidth = document.getElementById("txtBandwidth");
    bandwidth.value = config.get("config.bandwidth");
} catch (err) {
    console.log(err);
}


function saveConfigSettings() {
    console.log("saving s3 properties");
    let region = document.getElementById("txtRegion").value;
    if (region) {
        config.set("s3.awsRegion", region);
    }

    let endpoint = document.getElementById("txtEndpoint").value;
    if (endpoint) {
        config.set("s3.endpoint", endpoint);
    }
    let accessKey = document.getElementById("txtAccessKey").value;
    config.set("s3.accessKey", accessKey);
    let secretAccessKey = document.getElementById("txtSecretAccessKey").value;
    config.set("s3.secretAccessKey", secretAccessKey);
    let defaultBucket = document.getElementById("txtDefaultBucket").value;
    config.set("s3.defaultBucket", defaultBucket);

    // threads
    let numThreads = document.getElementById("txtNumThreads").value;
    config.set("config.numThreads", numThreads);

    // encryption
    let encPass = document.getElementById("txtEncPass").value;
    config.set("encryption.passphrase", encPass);

    // bandwidth
    let bandwidth = document.getElementById("txtBandwidth").value;
    config.set("config.bandwidth", bandwidth);
    alert("values set.");
}

function backToMain() {
    ipcRenderer.invoke('load-main');
}