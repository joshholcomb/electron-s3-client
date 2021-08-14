

//
// global variables
//
const { data } = require('jquery');
var nodeConsole = require('console');           // for access to console
var myConsole = new nodeConsole.Console(process.stdout, process.stderr); // for console logging
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
var mkdirp = require('mkdirp');
const Encryptor = require('./file-encrypt');    // file encryption
const Store = require('./store');
const app = require('electron');
const remote = require('electron').remote;
const dialog = remote.dialog;

let runStatus = true;

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
myConsole.log("displaying s3 values.");
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
    myConsole.log("selecting directory.");
    var lf = document.getElementById("txtLocalFolder");

    try {
        const chosenFolders = await dialog.showOpenDialog({ properties: ['openDirectory']}); 
        if (chosenFolders  && chosenFolders.canceled === false) {
            myConsole.log("selected directory: " + chosenFolders.filePaths[0]);
            lf.value = chosenFolders.filePaths[0];
            consoleAppend("selected local folder: [" + chosenFolders.filePaths[0] + "]");
        }
    } catch (err) {
        myConsole.log("error choosing file: " + err);
    }
    
}

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
    myConsole.log("bucket entered: [" + bucket.value + "]");
    if (bucket.value.length == 0) {
        alert("bucket not entered.");
        return;
    } else {
        listBucketFolders(bucket.value);
    }
}

//
// invoked when user clicks the backup button
//
function backupButton() {
    runStatus = true;

    myConsole.log("backup initiated...");
    var dirField = document.getElementById("txtLocalFolder");
    if (dirField.value.length == 0) {
        alert("local directory not selected..");
        return;
    }
    var dir = dirField.value;
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

//
// invoked when user clicks the stop button
//
function stopButton() {
    myConsole.log("setting runStatus = false");
    runStatus = false;
    consoleAppend("job stop msg sent");
}

//
// invoked when user clicks the clear console button
//
function clearConsoleButton() {
    myConsole.log("clearing console...");
    var ta = document.getElementById("txtConsole");
    ta.value = "";
}

//
// invoked when user clicks the restore button
//
function restoreButton() {
    runStatus = true;

    myConsole.log("restore initiated...");
    var dirField = document.getElementById("txtLocalFolder");
    if (dirField.value.length == 0) {
        alert("local directory not selected..");
        return;
    }
    var dir = dirField.value;
    myConsole.log("directory selected: " + dir);

    var bucket = document.getElementById("txtBucket");
    if (bucket.value.length == 0) {
        alert("bucket not entered...");
        return;
    }
    myConsole.log("bucket entered: [" + bucket.value + "]");

    var s3Folder = document.getElementById("txtS3Folder");
    if (!s3Folder.value) {
        alert("s3 folder not entered...");
        return;
    }
    myConsole.log("s3 folder entered: [" + s3Folder.value + "]");

    // got all input data - call restore function
    downloadFilesFromS3(bucket.value, s3Folder.value, dir);
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
        fileContents = fs.readFileSync('config/my-ca-cert.crt');
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
    myConsole.log("connected...");

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
          myConsole.log(err, err.stack); // an error occurred
      } else {
        data.Buckets.forEach(function(i) {
            consoleAppend("bucket: " + i.Name);
        });
      }
      
    });
}

// 
// list bucket top level folders for a given bucket name
//
function listBucketFolders(bucket) {
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

// sleep function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))


// upload files from a folder into an s3 endpoint
function uploadFilesToS3(bucket, folderName) {
    var startTime = Date.now();

    let s3 = awsConnect();

    myConsole.log("traversing directory [" + folderName + "]");
    const files = getAllFiles(folderName);
    consoleAppend("files found: [" + files.length + "]");
    
    let promises = [];
    const limit = pLimit(config.get("config.numThreads"));

    var fCount = 0;
    for (const f of files) {
        fCount = fCount + 1;
        const i = fCount;

        if (!runStatus) {
            myConsole.log("run status is false.");
            consoleAppend("job stopped...");
            break;
        }

        // process file
        promises.push(
            limit( () => processFileForUpload(s3, 
                folderName, 
                f, 
                bucket, 
                document.getElementById("txtS3Folder"),
                document.getElementById("encryptCheckBox").checked,
                i,
                files.length,
                startTime )
            )
        );
    }

    (async () => {
        const result = await Promise.all(promises);
    });
}


//
// async function to process a file for upload to s3
//
async function processFileForUpload(s3, sourceFolder, sourceFile, bucket, s3Folder, encrypt, fCounter, totalFiles, startTime) {
     // rename the upload folder to include subdirectories under uploadfolder
     let x = String(sourceFile);
     let z = x.substring(sourceFolder.length + 1);  // get relative path
     z = z.replace(/\\/g, '/');      // replace any \ with /

     if (s3Folder.value) {
         z = s3Folder.value + "/" + z;
     }

     if (runStatus === false) {
         consoleAppend("[" + fCount + " - " + totalFiles + "] - run status is false - aborting");
         return;
     }

    if (fCounter % 5 === 0) {
        // add a little timing
        let currentTime = Date.now();
        let runTime = currentTime - startTime;
        let runTimeSec = Math.round(runTime / 1000);
        let runTimeMin = Math.round(runTimeSec / 60);
        let lblRunTime = document.getElementById("lblRunTime");
        lblRunTime.textContent = runTimeMin + "min - " + runTimeSec + "sec";
    }

     // analyze the file to see if we need to upload
     // does files exist on s3 bucket.  if so, is it outdated?
     let doUpload = await analyzeFile(sourceFile, z, s3, bucket);
     myConsole.log("\tdoUpload: " + doUpload);

     if (doUpload === true) {
         // see if we need to encrypt
         let doEncrypt = encrypt;
         myConsole.log("\tdoEncrypt: " + doEncrypt);

         if (doEncrypt === true) {
             myConsole.log("encrypting file: " + sourceFile);
             let encryptDir = config.get("encryption.tmpDir");
             myConsole.log("encryptionFolder: " + encryptDir);
             let uploadKey = z + ".enc";
             let encFile = encryptDir + "\\" + uploadKey;
             encFile = encFile.replace(/\//g, '\\');
             
             // make sure directory exists
             let e = encFile.substring(0, encFile.lastIndexOf("\\"));
             mkdirp(e, function (err) {
                 if (err) {
                     myConsole.log("error creating directory: " + err);
                 }
             });
             myConsole.log("directory created");

             // now encrypt
             let encryptor = new Encryptor();
             myConsole.log("encrypting file: [" + sourceFile + "] to [" + encFile + "]");
             let encKey = config.get("encryption.passphrase");
             encryptor.encryptFile(f, encFile, encKey);

             await delay(1000);
             
             // upload the encrypted file
             myConsole.log("uploading encrypted file: " + encFile);
             var params = {Bucket: bucket, Key: uploadKey, Body: ''};
             var fileStream = fs.createReadStream(encFile);
             params.Body = fileStream;
             try {
                 const data = await s3.upload(params).promise();
                 consoleAppend("[" + fCounter + " - " + totalFiles + "] - uploaded [" + sourceFile + "] to [" + uploadKey + "]");
             } catch (err) {
                 consoleAppend("ERROR - file: " + sourceFile + " err: " + err.stack);
                 myConsole.log("error uploading.", err);
             }

             // delete encFile
             myConsole.log("deleting encrypted file: " + encFile);
             fs.unlink(encFile, function (err) {
                 if (err) {
                     consoleAppend("error deleting the encFile : " + err);
                 }
             });
         } else {
             // do not encrypt - just upload
             var params = {Bucket: bucket, Key: z, Body: ''};
             var fileStream = fs.createReadStream(sourceFile);
             params.Body = fileStream;
             try {
                 const data = await s3.upload(params).promise();
                 consoleAppend("[" + fCounter + " - " + totalFiles + "] - uploaded [" + sourceFile + "] to [" + z + "]");
             } catch (err) {
                 consoleAppend("ERROR - file: " + sourceFile + " err: " + err.stack);
             }
         }   
     } else {
         consoleAppend("[" + fCounter + " - " + totalFiles + "] - file [" + sourceFile + "] - s3 object is current");
     }
}


async function processFileForDownload(s3, localDir, bucket, key, counter, startTime) {
    if (runStatus === false) {
        return;
    }

    // add a little timing
    let currentTime = Date.now();
    let runTime = currentTime - startTime;
    let runTimeSec = Math.round(runTime / 1000);
    let runTimeMin = Math.round(runTimeSec / 60);
    let lblRunTime = document.getElementById("lblRunTime");
    lblRunTime.textContent = runTimeMin + "min - " + runTimeSec + "sec";

    // setup the directory for download
    let writeDir = localDir + "/" + key.substring(0, key.lastIndexOf("/"));
    let writeFile = key.substring(key.lastIndexOf("/") + 1);
    writeDir = writeDir.replace(/\//g, '\\');
    let fullPath = writeDir + "\\" + writeFile;
    consoleAppend(counter + " - downloading object: " + key + " to local file: " + fullPath);

    // make sure target directory exists on local folder
    mkdirp(writeDir, function (err) {
        if (err) {
            myConsole.log(err);
        }
    });

    // download the object
    try {
        await downloadObject(s3, bucket, key, fullPath);
    } catch (err) {
        myConsole.log("error downloading file: " + err);
    }
    
    // give a 1/2 second for the file write to settle (not sure if we need this)
    const sleep = await delay(500);

    // if encrypted - decrypt file
    // file.enc - length = 8 - pos = 4
    if (key.substring(key.length - 4) === ".enc") {
        myConsole.log("file is encrypted. decrypting now");
        let encryptor = new Encryptor();
        let decryptedFile = fullPath.substring(0, fullPath.length - 4);
     
        encryptor.decryptFile(fullPath, 
            decryptedFile, 
            config.get("encryption.passphrase"));
        
        consoleAppend("decrypted file: [" + decryptedFile + "]");
    }

    // maybe we want to delete the encrypted version?
}



//
// download all files in a given bucket and s3 folder
//
async function downloadFilesFromS3 (bucket, folderName, localDir) {
    var startTime = Date.now();
    let s3 = awsConnect();

    var params = {
        Bucket: bucket,
        Prefix: folderName
    };

    myConsole.log("bucket: " + bucket + " - folder: " + folderName);
    let data = await s3.listObjectsV2(params).promise();
        
    consoleAppend("objects found: " + data.Contents.length);
    let promises = [];
    const limit = pLimit(config.get("config.numThreads"));

    var j = 0;
    for (let o of data.Contents) {

        if (runStatus === false) {
            break;
        }
        
        j++;
        const counter = j;

        promises.push(
            limit(() => processFileForDownload(s3,
                localDir,
                bucket,
                o.Key,
                counter,
                startTime)
            )
        );
    }

    const result = await Promise.all(promises);
}

//
// download a single object from s3
//
async function downloadObject(s3, bucket, k, writeFile) {
    return new Promise((resolve, reject) => {
        let params = { Bucket: bucket, Key: k };
        let writeStream = fs.createWriteStream(writeFile);
        let readStream = s3.getObject(params).createReadStream();
        readStream.pipe(writeStream);

        readStream.on('error', function(err) {
            reject(err);
        });
        
        readStream.on('close', function() {
            resolve();
        });

    });
}



function getCipherKey(password) {
    return crypto.createHash('sha256').update(password).digest();
}

//
// analyze the file and see if we need to upload
//
async function analyzeFile(f, targetObject, s3, bucket) {
    let doUpload = true;

    
    let objectExists = false;
    let s3Outdated = false;

    myConsole.log("analyzing file: " + f);

    // see if object exists in s3
    var params = {
        Bucket: bucket,
        Key: targetObject
    };

    let s3LastModified = null;
    try {
        const data = await s3.headObject(params).promise();
    } catch (err) {
        if (err.code === 'NotFound') {
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

    return(doUpload);
    
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

process.on('unhandledRejection', (err) => {
    myConsole.log("error: " + err);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    myConsole.log("error: " + err);
    process.exit(1);
})