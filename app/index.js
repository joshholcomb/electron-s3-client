

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
// end globals

consoleAppend("current directory: " + process.cwd());

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
} catch (err) {
    myConsole.log(err);
}


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

//
// invoked when user clicks the stop button
//
function stopButton() {
    myConsole.log("setting runStatus = false");
    runStatus = false;
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

        let s3Folder = document.getElementById("txtS3Folder");
        if (s3Folder.value) {
            z = s3Folder.value + "/" + z;
            myConsole.log("z: " + z);
        }

        // analyze the file to see if we need to upload
        // does files exist on s3 bucket.  if so, is it outdated?
        let doUpload = await analyzeFile(f, z, s3, bucket);
        myConsole.log("\tdoUpload: " + doUpload);

        // upload if necessary
        if (doUpload === true) {
            // see if we need to encrypt
            let doEncrypt = document.getElementById("encryptCheckBox").checked;
            myConsole.log("\tdoEncrypt: " + doEncrypt);

            if (doEncrypt === true) {
                myConsole.log("encrypting file: " + f);
                let encryptDir = config.get("encryption.encryptionFolder");
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
                myConsole.log("encrypting file: [" + f + "] to [" + encFile + "]");
                let encKey = config.get("encryption.encryptionKey");
                encryptor.encryptFile(f, encFile, encKey);

                await delay(1000);
                
                // upload the encrypted file
                myConsole.log("uploading encrypted file: " + encFile);
                var params = {Bucket: bucket, Key: uploadKey, Body: ''};
                var fileStream = fs.createReadStream(encFile);
                params.Body = fileStream;
                try {
                    const data = await s3.upload(params).promise();
                    consoleAppend("[ " + i + " - " + files.length + "] - uploaded [" + f + "] to [" + uploadKey + "]");
                } catch (err) {
                    consoleAppend("ERROR - file: " + f + " err: " + err.stack);
                    myConsole.log("error uploading.", err);
                }

                // delete encFile
                myConsole.log("deleting encrypted file: " + encFile);
                fs.unlink(encFile, function (err) {
                    if (err) {
                        myConsole.log("error deleting file. " + err);
                    }
                });
                
            } else {
                // do not encrypt - just upload
                var params = {Bucket: bucket, Key: z, Body: ''};
                var fileStream = fs.createReadStream(f);
                params.Body = fileStream;
                try {
                    const data = await s3.upload(params).promise();
                    consoleAppend("[ " + i + " - " + files.length + "] - uploaded [" + f + "] to [" + z + "]");
                } catch (err) {
                    consoleAppend("ERROR - file: " + f + " err: " + err.stack);
                    myConsole.log("error uploading.", err);
                }
            }   
        } else {
            consoleAppend("[ " + i + " - " + files.length + "] - file [" + f + "] - s3 object is current");
        }
    }
}

const downloadFilesFromS3 = async function (bucket, folderName, localDir) {
    let s3 = awsConnect();

    var params = {
        Bucket: bucket,
        Prefix: folderName
    };

    myConsole.log("bucket: " + bucket + " - folder: " + folderName);
    let data = await s3.listObjects(params).promise();
        
    consoleAppend("objects found: " + data.Contents.length);
    var j = 0;
    data.Contents.forEach(async o => {
        j++;
        consoleAppend(j + " - object: " + o.Key);

        // download the object
        var params = {
            Bucket: bucket,
            Key: o.Key
        }

        myConsole.log("assembling download directory");
        let writeDir = localDir + "/" + o.Key.substring(0, o.Key.lastIndexOf("/"));
        let writeFile = o.Key.substring(o.Key.lastIndexOf("/") + 1);
        writeDir = writeDir.replace(/\//g, '\\');
        let fullPath = writeDir + "\\" + writeFile;
        myConsole.log("writeDir: [" + writeDir + "] - writeFile: " + writeFile);
        myConsole.log("fullPath: " + fullPath);

        mkdirp(writeDir, function (err) {
            if (err) {
                myConsole.log(err);
            }
        });
        
        
        myConsole.log("piping stream");
        let writeStream = fs.createWriteStream(fullPath);
        s3.getObject(params).createReadStream().pipe(writeStream);

        const sleep = await delay(1500);

        // if encrypted - decrypt file
        // file.enc - length = 8 - pos = 4
        if (o.Key.substring(o.Key.length - 4) === ".enc") {
            myConsole.log("file is encrypted. decrypting now");
            let encryptor = new Encryptor();
            let decryptedFile = fullPath.substring(0, fullPath.length - 4);
         
            encryptor.decryptFile(fullPath, 
                decryptedFile, 
                config.get("encryption.encryptionKey"));
            
            consoleAppend("decrypted file: [" + decryptedFile + "]");
            
        } else {
            myConsole.log("file not encrypted - moving on.");
        }
    });
}


function getCipherKey(password) {
    return crypto.createHash('sha256').update(password).digest();
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

    let s3LastModified = null;
    let data = null;
    try {
        data = await s3.headObject(params).promise();
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
