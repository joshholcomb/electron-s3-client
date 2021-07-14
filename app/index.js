

//
// global variables
//
const { data } = require('jquery');
var nodeConsole = require('console');           // for access to console
var myConsole = new nodeConsole.Console(process.stdout, process.stderr); // for console logging
let config = require('electron-node-config');   // for configuration
const path = require("path");                   
const fs   = require("fs");                     // for filesystem work
const crypto = require("crypto");               // for encrypting files
let runStatus = true;
// end globals



//
// set input text values on default
//
myConsole.log("setting aws endpoint");
var endpoint = document.getElementById("txtEndpoint");
endpoint.value = config.get('s3.endpoint');
var accessKey = document.getElementById("txtAccessKey");
accessKey.value = config.get('s3.accessKey');
var secretAccessKey = document.getElementById("txtSecretAccessKey");
secretAccessKey.value = config.get('s3.secretAccessKey');


// update folder information
// fires from html when local directory value changes
function updateFolder() {
    var dir = document.getElementById("dirs").files[0].path
    myConsole.log("selected local folder is: [" + dir + "]");
    consoleAppend("selected local folder: [" + dir + "]");
    var lf = document.getElementById("txtLocalFolder");
    lf.value = dir;
}

// test the submit button
function lsBucketButton() {
    var bucket = document.getElementById("txtBucket");
    myConsole.log("bucket entered: [" + bucket.value + "]");
    if (bucket.value.length == 0) {
        alert("bucket not entered.");
        return;
    } else {
        listBucketContents(bucket.value);
    }
}

function backupButton() {
    runStatus = true;

    myConsole.log("backup initiated...");
    var dirField = document.getElementById("dirs");
    if (dirField.value.length == 0) {
        alert("local directory not selected..");
        return;
    }
    var dir = document.getElementById("dirs").files[0].path
    myConsole.log("directory selected: " + dir);

    var bucket = document.getElementById("txtBucket");
    if (bucket.value.length == 0) {
        alert("bucket not entered...");
        return;
    }
    myConsole.log("bucket entered: [" + bucket.value + "]");
    if (bucket.value.length == 0) {
        alert("bucket or src folder not entered.");
        return;
    } else {
       uploadFilesToS3(bucket.value, dir);
    }
}

function stopButton() {
    myConsole.log("setting runStatus = false");
    runStatus = false;
}

function clearConsoleButton() {
    myConsole.log("clearing console...");
    var ta = document.getElementById("txtConsole");
    ta.value = "";
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
    var AWS = require('aws-sdk');

    var https = require('https');
    const fs = require('fs');
    try {
        fileContents = fs.readFileSync('app/certs/my-ca-cert.crt');
    } catch (err) {
        myConsole.log(err.stack);
    }

    var customAgent = new https.Agent({ ca: fileContents});
    try {
        AWS.config.update({
            httpOptions: { agent: customAgent}
        });
    } catch (err) {
        myConsole.log(err.stack);
    }

    // get access creds from ui boxes
    var accessKey = document.getElementById("txtAccessKey").value;
    var secretAccessKey = document.getElementById("txtSecretAccessKey").value;
    var endpoint = document.getElementById("txtEndpoint").value;

    var s3  = new AWS.S3({
            accessKeyId: accessKey,
            secretAccessKey: secretAccessKey,
            endpoint: endpoint,
            s3ForcePathStyle: true, // needed with minio?
            signatureVersion: 'v4'
    });
    myConsole.log("connected...");

    return s3;
}

// 
// list bucket content of a given bucket name
//
function listBucketContents(bucket) {
    consoleAppend("listing bucket contents for bucket: [" + bucket + "]");
    let s3 = awsConnect();

    var params = {
        Bucket: bucket,
        Delimiter: "/"
    };

    myConsole.log("listing bucket contents for bucket: " + bucket);
    s3.listObjects(params, function(err, data) {
        if (err) {
            myConsole.log(err, err.stack);
        } else {
            consoleAppend("folders found: " + data.CommonPrefixes.length);
            var j = 0;
            data.CommonPrefixes.forEach(function(i) {
                j++;
                consoleAppend(j + " - folder: " + i.Prefix);
            });
        }
    });

    return data;
}

function testButton() {
    let doEncrypt = document.getElementById("encryptCheckBox").checked;
    myConsole.log("doEncrypt: " + doEncrypt);
    let encryptDir = config.get("encryption.encryptionFolder");
    alert("doEncrypt: " + doEncrypt + " - encryptionDir: [" + encryptDir + "]");
}

// upload a file to s3 endpoint
const uploadFilesToS3 = async function (bucket, folderName) {
    let s3 = awsConnect();

    myConsole.log("traversing directory [" + folderName + "]");
    const files = getAllFiles(folderName);
    consoleAppend("files found: [" + files.length + "]");
    
    var i = 0;
    for (const f of files) {
        i++;
        if (!runStatus) {
            myConsole.log("run status is false.");
            break;
        }

        // rename the upload folder to include subdirectories under uploadfolder
        let x = String(f);
        let z = x.substr(3);            // trim off first 3 such as d:\
        z = z.replace(/\\/g, '/');      // replace any \ with /


        // analyze the file to see if we need to upload
        // does files exist on s3 bucket.  if so, is it outdated?
        let doUpload = await analyzeFile(f, z, s3, bucket);
        myConsole.log("\tdoUpload: " + doUpload);

        // upload if necessary
        if (doUpload === true) {
            // see if we need to encrypt
            let doEncrypt = document.getElementById("encryptCheckBox").checked;
            myConsole.log("doEncrypt: " + doEncrypt);

            if (doEncrypt === true) {
                let encryptDir = config.get("encryption.encryptionFolder");
                let encFile = encryptDir + z + ".enc";
                encFile = encFile.replace(/\//g, '\\');
                let key = config.get("encryption.key");
                var cipher = crypto.createCipheriv('aes-256-cbc', key);
                var input = fs.createReadStream(f);
                var output = fs.createWriteStream(encFile);
                input.pipe(cipher).pipe(output);

                output.on('finish', function() {
                    myConsole.log("encrypted file [" + f + "] to [" + encFile + "]");
                });
            }

            var params = {Bucket: bucket, Key: z, Body: f};
            try {
                const data = await s3.upload(params).promise();
                consoleAppend("[ " + i + " - " + files.length + "] - uploaded [" + f + "] to [" + z + "]");
            } catch (err) {
                consoleAppend("ERROR - file: " + f + " err: " + err.stack);
                myConsole.log("error uploading.", err);
            }
        } else {
            consoleAppend("[ " + i + " - " + files.length + "] - file [" + f + "] - current");
        }
    }
}

//
// analyze the file and see if we need to upload
//
async function analyzeFile(f, targetObject, s3, bucket) {
    // default action
    let doUpload = true;

    // checks - status values
    let objectExists = false;
    let s3Outdated = false;

    myConsole.log("analyzing file: " + f);

    // see if object exists in s3
    var params = {
        Bucket: bucket,
        Key: targetObject
    };


    // see if object exists
    let s3LastModified = null;

    try {
        await s3.headObject(params).promise();
    } catch (err) {
        if (err.code === 'NotFound') {
            myConsole.log("\tobject [" + targetObject + "] - NotFound");
            return doUpload;
        }
    }

    objectExists = true;
            
    // see if local timestamp is newer
    s3LastModified = data.LastModified;
    localFileLastModified = null;
    try {
        let stats = fs.statSync(f);
        localFileLastModified = stats.mtime;

        let localDate = new Date(localFileLastModified);
        let s3Date = new Date(s3LastModified);
        if (localDate > s3Date) {
            s3Outdated = true;
            myConsole.log("\ts3 file is outdated");
        } else {
            myConsole.log("\ts3 file is current");
        }
    } catch (error) {
        myConsole.log("error getting local file mtime.");
    }
    

    // if all of our tests passed, then do not upload
    if (objectExists === true && s3Outdated === false) {
        doUpload = false;
    } else {
        myConsole.log("tests failed - uploading file");
    }

    return doUpload;
}

//
// utility function to list files in directory
//
const getAllFiles = function(dirPath, arrayOfFiles) {
    let files = [];

    try {
        files = fs.readdirSync(dirPath);
    } catch (err) {
        myConsole.log(err.stack);
    }
  
    arrayOfFiles = arrayOfFiles || []
  
    files.forEach(function(file) {
        let abs = path.join(dirPath, file);
        if (fs.statSync(abs).isDirectory()) {
            arrayOfFiles = getAllFiles(abs, arrayOfFiles)
        } else {
            arrayOfFiles.push(abs)
        }
    })
  
    return arrayOfFiles
}