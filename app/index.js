

//
// global variables
//
const { data } = require('jquery');
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
var mkdirp = require('mkdirp');
const Encryptor = require('./file-encrypt');    // file encryption
const Store = require('./store');
var electron = require('electron');
var ipcRenderer = electron.ipcRenderer;
var AWS = require('aws-sdk');
var https = require('https');
const BackupJob = require('./backup-job');

const pLimit = require('p-limit');
// end globals

// display current directory
consoleAppend("current directory: " + process.cwd());

// setup config
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


// initial display settings
console.log("displaying s3 values.");
let lblEndpoint = document.getElementById("lblS3Endpoint");
lblEndpoint.textContent = config.get("s3.endpoint");
let lblAccessKey = document.getElementById("lblS3AccessKey");
lblAccessKey.textContent = config.get("s3.accessKey");
let lblSecretAccessKey = document.getElementById("lblS3SecretAccessKey");
let pass = "";
let length = config.get("s3.secretAccessKey").length;
for (i=0; i < length; i++) {
    pass += "*";
}
lblSecretAccessKey.textContent = pass;
let defaultBucket = document.getElementById("txtBucket");
defaultBucket.value = config.get("s3.defaultBucket");

// update folder information
// fires from html when local directory value changes
const updateFolder = async () => {
    console.log("selecting directory.");
    var lf = document.getElementById("txtLocalFolder");

    try {
        const chosenFolders = await ipcRenderer.invoke('get-folder'); 
        if (chosenFolders  && chosenFolders.canceled === false) {
            console.log("selected directory: " + chosenFolders.filePaths[0]);
            lf.value = chosenFolders.filePaths[0];
            consoleAppend("selected local folder: [" + chosenFolders.filePaths[0] + "]");
        }
    } catch (err) {
        console.log("error choosing file: " + err);
    }
    
}

// make backup job global
var certFile = "./config/my-ca-cert.crt";
var backupJob = new BackupJob(config, certFile);

//
// invoked when user clicks the list buckets button
//
function lsBucketsButton() {
    listBuckets();
}

//
// invoked when user clicks the list objects button
//
function lsObjectsButton() {
    var bucket = document.getElementById("txtBucket");
    console.log("bucket entered: [" + bucket.value + "]");
    if (bucket.value.length == 0) {
        alert("bucket not entered.");
        return;
    } else {
        listBucketFoldersV2(bucket.value);
    }
}

//
// invoked when user clicks the backup button
//
function backupButton() {
    backupJob.setRunStatus(true);

    var dirField = document.getElementById("txtLocalFolder");
    if (dirField.value.length == 0) {
        alert("local directory not selected..");
        return;
    }
    var dir = dirField.value;

    var bucket = document.getElementById("txtBucket");
    if (bucket.value.length == 0) {
        alert("bucket not entered...");
        return;
    }
    console.log("bucket entered: [" + bucket.value + "]");
    if (bucket.value.length == 0) {
        alert("bucket or src folder not entered.");
        return;
    } else {
       uploadFilesToS3V2(bucket.value, dir);
    }
}

function decryptButton() {
    let localDir = document.getElementById("txtLocalFolder").value;
    if (!localDir) {
        alert("You must select the directory to decrypt.");
        return;
    }

    backupJob.decryptFolder(localDir);
}


//
// invoked when user clicks the stop button
//
function stopButton() {
    console.log("setting runStatus = false");
    backupJob.setRunStatus(false);
    consoleAppend("job stop msg sent");
}

//
// invoked when user clicks the clear console button
//
function clearConsoleButton() {
    console.log("clearing console...");
    var ta = document.getElementById("txtConsole");
    ta.value = "";
}

//
// invoked when user clicks the restore button
//
function restoreButton() {
    backupJob.setRunStatus(true);
    var dirField = document.getElementById("txtLocalFolder");
    if (dirField.value.length == 0) {
        alert("local directory not selected..");
        return;
    }
    var dir = dirField.value;

    var bucket = document.getElementById("txtBucket");
    if (bucket.value.length == 0) {
        alert("bucket not entered...");
        return;
    }

    var s3Folder = document.getElementById("txtS3Folder");
    if (!s3Folder.value) {
        alert("s3 folder not entered...");
        return;
    }

    // got all input data - call restore function
    downloadFilesFromS3V2(bucket.value, s3Folder.value, dir);
}

// append msg to text area for console messages
function consoleAppend(msg) {
    var ta = document.getElementById("txtConsole");
    var val = ta.value;
    if (val) {
        ta.value = val + '\n' + msg;
    } else {
        ta.value = msg;
    }

    // scroll to end
    ta.scrollTop = ta.scrollHeight;

    // if more than 200 lines - remove all but 200 lines
    var txt = ta.value.length ? ta.value.split(/\n/g) : [];
    ta.value = txt.slice(-200).join("\n");
}

//
// establish a connection to aws
//
function awsConnect() {
    
    try {
        fileContents = fs.readFileSync('config/my-ca-cert.crt');
    } catch (err) {
        console.log(err.stack);
    }

    var customAgent = new https.Agent({ ca: fileContents});
    try {
        AWS.config.update({
            httpOptions: { agent: customAgent}
        });
    } catch (err) {
        console.log(err.stack);
    }

    // get access creds from config
    var accessKey = config.get("s3.accessKey");
    var secretAccessKey = config.get("s3.secretAccessKey");
    var endpoint = config.get("s3.endpoint");

    // set AWS timeout
    AWS.config.update({
        maxRetries: 2,
        httpOptions: {
            timeout: 240000,
            connectTimeout: 5000,
        },
    })

    var s3  = new AWS.S3({
            accessKeyId: accessKey,
            secretAccessKey: secretAccessKey,
            endpoint: endpoint,
            s3ForcePathStyle: true, // needed with minio?
            signatureVersion: 'v4'
    });
    console.log("connected...");

    return s3;
}

//
// list buckets under this account
//
function listBuckets() {
    consoleAppend("listing buckets for endpoint: [" + config.get("s3.endpoint") + "]");
    let s3 = awsConnect();

    var params = {};
    s3.listBuckets(params, function(err, data) {
      if (err) {
          console.log(err, err.stack); // an error occurred
      } else {
        data.Buckets.forEach(function(i) {
            consoleAppend("bucket: [" + i.Name + "]");
        });
      }
      
    });
}

//
// listBucketsV2 with backup job object
//
async function listBucketFoldersV2(bucket) {
    consoleAppend("listing bucket contents for bucket: [" + bucket + "]");
    backupJob.connectToS3();
    var folders = await backupJob.listBucketFolders(bucket);
    consoleAppend("===results: " + folders.length + "===");

    for (const f of folders) {
        consoleAppend(f.number + " - " + f.name);
    }
}

// sleep function
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


//
//  fired by the backupButton function
//
function uploadFilesToS3V2(bucket, folderName) {
    backupJob.connectToS3();

    let doEncrypt = document.getElementById("encryptCheckBox").checked;
    if (doEncrypt === true) {
        console.log("setting encrypt flag = true");
        backupJob.setEncryption(true);
    }
    let s3Folder = document.getElementById("txtS3Folder").value;
    backupJob.setGuiMode(true);
    backupJob.doBackup(folderName, bucket, s3Folder);
}


function downloadFilesFromS3V2(bucket, folderName, localDir) {
    backupJob.connectToS3();
    backupJob.setGuiMode(true);
    backupJob.doRestore(localDir, bucket, folderName);
}