
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
const AWS = require('aws-sdk');
const Encryptor = require('./file-encrypt');    // file encryption
const pLimit = require('p-limit');
var https = require('https');


/*
* class: BackupJob
*/
class BackupJob {
    jobName;            // name of the job
    localFolder;        // local folder (src data on backup - target folder on restore)
    s3Bucket;           // s3 bucket containing the data
    s3Folder;           // s3 folder containing the data
    s3;                 // s3 connection object
    config;             // configuration from config file
    certFile;           // we need a custom crt file for our ssl config
    encrypt = false;    // flag to encrypt data before uploading
    runStatus = true;   // toggle for stopping a long running job
    guimode = false;    // set if running in gui mode (log status to electron)

    // private variables
    s3;

    constructor(config, certFile) {
        this.config = config;
        this.certFile = certFile;
    }

    connectToS3() {
        let fileContents = "";
        try {
            fileContents = fs.readFileSync(this.certFile);
        } catch (err) {
            console.log(err.stack);
        }
    
        var customAgent = new https.Agent({ca: fileContents});
        try {
            AWS.config.update({
                httpOptions: { agent: customAgent}
            });
        } catch (err) {
            console.log(err.stack);
        }
    
        // get access creds from config
        var accessKey = this.config.get("s3.accessKey");
        var secretAccessKey = this.config.get("s3.secretAccessKey");
        var endpoint = this.config.get("s3.endpoint");
    
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
    
        this.s3 = s3;
    }

    // allow user to set encryption (default to false)
    setEncryption(encrypt) {
        this.encrypt = encrypt;
    }

    setGuiMode(gui) {
        this.guimode = gui;
    }

    setRunStatus(status) {
        this.runStatus = status;
    }

    //
    // if running in guimode
    //
    consoleAppend(msg) {
        if (this.guimode === true) {
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
        } else {
            console.log(msg);
        }
    }

    // update runtime if in guimode
    updateRuntime(m, s) {
        let dur = `${m}:${(s < 10 ? "0" : "")}${s}`;
        let l = document.getElementById("lblRunTime");
        l.textContent = dur;
    }

    // backup a specified folder to a specified s3 target
    doBackup(localFolder, s3Bucket, s3Folder) {
        let promises = [];
        let limit = pLimit(parseInt(this.config.get("config.numThreads"), 10));
        console.log("traversing directory [" + localFolder + "]");
        const files = this.listLocalFiles(localFolder);
        if (this.guimode === true) {
            this.consoleAppend("files found: [" + files.length + "]")
        }
        console.log("files found: [" + files.length + "]");
        
        var fCount = 0;
        for (const f of files) {
            fCount = fCount + 1;
            const i = fCount;

            let stats = {};
            stats.fCounter = fCount;
            stats.fCount = files.length;
            stats.startTime = Date.now();

            if (!this.runStatus) {
                if (this.guimode === true) {
                    this.consoleAppend("run status is false.");
                }
                console.log("run status is false.");
                break;
            }

            // establish s3 key
            let x = String(f);
            let key = x.substring(localFolder.length + 1);
            key = key.replace(/\\/g, '/');
            if (s3Folder) {
                key = s3Folder + "/" + key;
            }

            // process file
            promises.push(
                limit( () => this.processFileForUpload( 
                    f, 
                    s3Bucket, 
                    key,
                    stats)
                )
            );
        }

        (async () => {
            const result = await Promise.all(promises);
        });

    }


    // in case you have a local folder with encrypted data that needs decrypted
    async decryptFolder(localDir) {
        let files = this.listLocalFiles(localDir);

        for (f of files) {
            let dF = f.substring(0, f.length - 4);
            let e = new Encryptor();

            await encryptor.decryptFile(f, 
                dF, 
                this.config.get("encryption.passphrase"));

            if (this.guimode === true) this.consoleAppend("decrypted file: [" + decryptedFile + "]");
            console.log("decrypted file: [" + decryptedFile + "]");
    
            await this.delay(1500);
            fs.unlink(f, function (err) {
                if (err) {
                    if (this.guimode === true) this.consoleAppend("error deleting the enc file: " + err);
                    console.log("error deleting the encFile : " + err);
                } else {
                    console.log("deleted encrypted file: " + f);
                }
            });

        }
    }

    // list all of the s3 keys
    async listS3Keys(params, allKeys) {
        var self = this;
        let data = await this.s3.listObjectsV2(params).promise();
        var contents = data.Contents;
        contents.forEach(function(content) {
            allKeys.push(content.Key);
        });

        if (data.isTruncated) {
            this.consoleAppend("fetching continuation.");
            params.ContinuationToken = data.NextContinuationToken;
            self.listS3Keys();
        } else {
            return allKeys;
        }
    }


     // restore job
    async doRestore(localFolder, bucket, s3Folder) {
        let promises = [];
        let limit = pLimit(parseInt(this.config.get("config.numThreads"), 10));

        var params = {
            Bucket: bucket,
            Prefix: s3Folder
        };

        let allKeys = [];
        allKeys = await this.listS3Keys(params, allKeys);
        this.consoleAppend("objects found: " + allKeys.length);

        var j = 0;
        for (let k of allKeys) {

            if (this.runStatus === false) {
                break;
            }

            j++;
            const counter = j;
            let stats = {};
            stats.fCounter = counter;
            stats.fCount = allKeys.length;

            promises.push(
                limit(() => this.processFileForDownload(
                    localFolder,
                    bucket,
                    k,
                    stats)
                )
            );
        }

        const result = await Promise.all(promises);
    }

    async listBucketFolders(bucket) {
        let folders = [];
        var params = {
            Bucket: bucket,
            Delimiter: "/"
        };

        var data = await this.s3.listObjectsV2(params).promise();
        
        var j = 0;
        data.CommonPrefixes.forEach(function(i) {
            j++;
            let folder = {};
            folder.number = j;
            folder.name = i.Prefix;
            folders.push(folder);
        });
        
        return folders;
    }

    //
    // process a single file for upload
    //
    async processFileForUpload(f, bucket, key, stats) {

        if (this.runStatus === false) {
            return;
        }
        // analyze the file to see if we need to upload
        // does files exist on s3 bucket.  if so, is it outdated?
        let doUpload = await this.analyzeFile(f, key, bucket);

        // do a little timing
        if (stats.fCounter % 25 === 0) {
            let t = Date.now();
            let ms = t - stats.startTime;
            let m = Math.floor(ms / 60000);
            let s = ((ms % 60000) / 1000).toFixed(0);
            if (this.guimode === true) {
                this.updateRuntime(m,s);
            }
            console.log("runTime: " + m + "m - " + s + "s");
        }

        // see if we need to upload
        if (doUpload === true) {

            if (this.encrypt === true) {
                let uploadKey = key + ".enc";

                // now encrypt
                let encryptor = new Encryptor();
                let encKey = this.config.get("encryption.passphrase");
                await encryptor.encryptFileAndUploadStream(f, encKey, this.s3, bucket, uploadKey);
                this.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + "] - uploaded [" + f + "] to [" + uploadKey + "]");
            } else {
                // do not encrypt - just upload
                var params = {Bucket: bucket, Key: key, Body: ''};
                var fileStream = fs.createReadStream(f);
                params.Body = fileStream;
                try {
                    const data = await this.s3.upload(params).promise();
                    this.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + "] - uploaded [" + f + "] to [" + key + "]");
                } catch (err) {
                    this.consoleAppend("ERROR - file: " + f + "err: " + err);
                }
            }  
        } else {
            this.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + "] - file [" + f + "] - s3 object is current");
        }
    }

    //
    // analyze a file to see if we need to upload it
    //
    async analyzeFile(f, key, bucket) {
        let doUpload = true;
        let objectExists = false;
        let s3Outdated = false;

        // see if object exists in s3
        var params = {
            Bucket: bucket,
            Key: key
        };

        if (this.encrypt === true) {
            // key will have .enc on end
            params.Key = key + ".enc";
        }

        let s3LastModified = null;
        let i = 0;
        while (i < 3) {
            try {
                const data = await this.s3.headObject(params).promise();
                break;
            } catch (err) {
                if (err.code === 'NotFound') {
                    i = 4;
                    return doUpload;
                } else {
                    this.consoleAppend("try [" + i + "] - headObject error - file: " + key + " error : " + err);
                    i++;
                    if (i >= 3) {
                        return doUpload;
                    }
                }
            }
        }

        objectExists = true;
                
        // see if local timestamp is newer
        s3LastModified = data.LastModified;
        let localFileLastModified = null;
        try {
            let stats = fs.statSync(f);
            localFileLastModified = stats.mtime;

            let localDate = new Date(localFileLastModified);
            let s3Date = new Date(s3LastModified);
            if (localDate > s3Date) {
                s3Outdated = true;
                console.log("\ts3 file is outdated");
            } 
        } catch (error) {
            this.consoleAppend("error checking dates for file [" + f + "] - assume outdated.");
            s3Outdated = true;
        }
        
        // if all of our tests passed, then do not upload
        if (objectExists === true && s3Outdated === false) {
            doUpload = false;
        } else {
            console.log("tests failed - uploading file");
        }

        return(doUpload);
    }

   

    //
    // process a single file for download
    //
    async processFileForDownload(localDir, bucket, key, stats) {
        if (this.runStatus === false) {
            return;
        }


         // do a little timing
         if (stats.fCounter % 5 === 0) {
            let t = Date.now();
            let ms = t - stats.startTime;
            let m = Math.floor(ms / 60000);
            let s = ((ms % 60000) / 1000).toFixed(0);
            if (this.guimode === true) {
                this.updateRuntime(m,s);
            }
            console.log("runTime: " + m + "m - " + s + "s");
        }
    
        // setup the directory for download
        let writeDir = localDir + "/" + key.substring(0, key.lastIndexOf("/"));
        let writeFile = key.substring(key.lastIndexOf("/") + 1);
        writeDir = writeDir.replace(/\//g, '\\');
        let fullPath = writeDir + "\\" + writeFile;
        console.log("downloading object: " + key + " to local file: " + fullPath);
    
        // make sure target directory exists on local folder
        fs.mkdirSync(writeDir, { recursive: true});
    
        // download the object
        try {
            await this.downloadObject(bucket, key, fullPath);
        } catch (err) {
            this.consoleAppend("error downloading file: [" + f + "]");
        }
        
        // give a 1/2 second for the file write to settle (not sure if we need this)
        await this.delay(2000);
    
        // if encrypted - decrypt file
        // file.enc - length = 8 - pos = 4
        if (key.substring(key.length - 4) === ".enc") {
            let encryptor = new Encryptor();
            let decryptedFile = fullPath.substring(0, fullPath.length - 4);
         
            await encryptor.decryptFile(fullPath, 
                decryptedFile, 
                this.config.get("encryption.passphrase"));

            this.consoleAppend("decrypted file: [" + decryptedFile + "]");
    
            await this.delay(1500);

            console.log("deleting encrypted file: " + fullPath);
            await this.delay(1500);
            fs.unlink(fullPath, function (err) {
                if (err) {
                    if (this.guimode === true) this.consoleAppend("error deleting the enc file: " + err);
                    console.log("error deleting the encFile : " + err);
                } else {
                    console.log("deleted encrypted file: " + fullPath);
                }
            });
        }
        this.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + " - processed file: " + fullPath); 
    }

    //
    // delay x number of ms
    //
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    async downloadObject(bucket, k, writeFile) {
        return new Promise((resolve, reject) => {
            let params = { Bucket: bucket, Key: k };
            let writeStream = fs.createWriteStream(writeFile);
            let readStream = this.s3.getObject(params).createReadStream();
            readStream.pipe(writeStream);
    
            readStream.on('error', function(err) {
                reject(err);
            });
            
            readStream.on('close', function() {
                resolve();
            });
    
        });
    }

    listLocalFiles(dirPath, arrayOfFiles) {
        var self = this;
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
                arrayOfFiles = self.listLocalFiles(abs, arrayOfFiles);
            } else {
                arrayOfFiles.push(abs)
            }
        })
      
        return arrayOfFiles
    }

}

module.exports = BackupJob;