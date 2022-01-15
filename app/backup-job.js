
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
const AWS = require('aws-sdk');
const Encryptor = require('./file-encrypt');    // file encryption
const pLimit = require('p-limit');
var https = require('https');
const stream = require('stream');
const ProgressMonitor = require('./progress-monitor');
const { PassThrough } = require("stream");
const ConsoleLogger = require('./console-logger');
const { Console } = require("console");


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
    errorFiles;         // keep a running list of errors
    numThreads = 1;     // number of threads for this job
    threadKbps = 200;   // throttle in KBps per thread
    logger;

    // private variables
    s3;

    constructor(config, certFile, guimode) {
        this.config = config;
        this.certFile = certFile;
        this.errorFiles = [];
        this.guimode = guimode;

        this.logger = new ConsoleLogger(guimode);
    }

    //
    // establish connection to aws s3 or minio
    // depends on config values (aws s3 will take priority if present)
    //
    connectToS3() {
        
        // get access creds from config
        var accessKey = this.config.get("s3.accessKey");
        var secretAccessKey = this.config.get("s3.secretAccessKey");
        var endpoint = this.config.get("s3.endpoint");
        var region = this.config.get("s3.awsRegion");
    
        let timeoutMin = 60;
        let to = (timeoutMin * 60) * 1000;

        // set AWS timeout
        AWS.config.update({
            maxRetries: 2,
            httpOptions: {
                timeout: to,
                connectTimeout: 20000,
            },
        });

        // if region is specified, then use it - else use the endpoint
        var s3 = null;
        if (region && region !== "undefined") {
            AWS.config.update({region: region});
            s3  = new AWS.S3({
                accessKeyId: accessKey,
                secretAccessKey: secretAccessKey,
                s3ForcePathStyle: true,
                signatureVersion: 'v4'
            });
        } else {
            let fileContents = "";
            try {
                fileContents = fs.readFileSync(this.certFile);
            } catch (err) {
                console.log(err.stack);
            }
        
            var customAgent = new https.Agent({
                ca: fileContents,
                keepAlive: true,
                maxSockets: 5
            });
            try {
                AWS.config.update({
                    httpOptions: { agent: customAgent}
                });
            } catch (err) {
                console.log(err.stack);
            }
            
            s3  = new AWS.S3({
                accessKeyId: accessKey,
                secretAccessKey: secretAccessKey,
                endpoint: endpoint,
                s3ForcePathStyle: true, // needed with minio?
                signatureVersion: 'v4'
            });
        }

        console.log("connected to s3");
    
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

    addErrorFile(f) {
        this.errorFiles.push(f);

        this.logger.consoleAppend("error count: [" + this.errorFiles.length + "] - max 100");

        if (this.errorFiles.length > 100) {
            this.logger.consoleAppend("too many errors - exit");
            process.exit(1);
        }
    }

    // update runtime if in guimode
    updateRuntime(m, s, eta) {
        let dur = `${m}:${(s < 10 ? "0" : "")}${s}`;
        if (this.guimode === true) {
            let l = document.getElementById("lblRunTime");
            l.textContent = dur;

            let e = document.getElementById("lblETA");
            e.textContent = `${eta} min`;
        } else {
            console.log("runtime: " + dur + " - eta: " + eta + "\r\n");
        }
    }

    // backup a specified folder to a specified s3 target
    async doBackup(localFolder, s3Bucket, s3Folder, excludeDirs, threads) {

        // clear error files from any previous run
        this.errorFiles = [];

        let promises = [];
        let limit;
        if (threads) {
            this.logger.consoleAppend("setting threads: " + threads);
            limit = pLimit(parseInt(threads, 10));
        } else {
            this.logger.consoleAppend("setting threads to config value");
            limit = pLimit(parseInt(this.config.get("config.numThreads"), 10));
        }
        this.logger.consoleAppend("starting backup of local folder: [" + localFolder + "]");
        this.logger.consoleAppend("traversing directory [" + localFolder + "]");

        const files = this.listLocalFiles(localFolder, [], excludeDirs);
        this.logger.consoleAppend("files found: [" + files.length + "]");
        
        var fCount = 0;
        for (const f of files) {
            fCount = fCount + 1;
            const i = fCount;

            let stats = {};
            stats.fCounter = fCount;
            stats.fCount = files.length;
            stats.startTime = Date.now();

            if (!this.runStatus) {
                this.logger.consoleAppend("run status is false.");
                break;
            }

            // establish s3 key
            let x = String(f);
            let key = x.substring(localFolder.length + 1);
            key = key.replace(/\\/g, '/');
            if (s3Folder) {
                key = s3Folder + "/" + key;
            }

            // if this f is a directory, then it is an empty directory and we need to make sure
            // that the key is uploaded.
            if (fs.lstatSync(f).isDirectory() === true) {
                key = key + "/";
                this.logger.consoleAppend("file [" + f + "] is an empty directory");
                let params = {
                    Bucket: s3Bucket,
                    Prefix: key
                }
                let data = await this.s3.listObjectsV2(params).promise();
                if (data.Contents.length > 0) {
                    this.logger.consoleAppend("folder [" + key + "] exists in s3");
                } else {
                    await this.s3.putObject({
                        Key: key,
                        Bucket: s3Bucket,
                    }).promise(); 
                    this.logger.consoleAppend("created key: [" + key + "]");
                }
            } else {
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
        }

        Promise.all(promises).then(() => {
            this.logger.consoleAppend("====================");
            this.logger.consoleAppend("backup job finished.");
            this.logger.consoleAppend("====error files====");
            if (this.errorFiles.length === 0) {
                this.logger.consoleAppend("no error files");
            } else {
                for (let f of this.errorFiles) {
                    this.logger.consoleAppend(f);
                }
            }
        });

    }

    // check to see if a s3 key is present on local filesystem
    isS3ObjectLocal(key, localFiles) {
        let found = false;
        for (let f of localFiles) {
            let fn = f.replace(/\\/g, '/'); 
            if (fn.includes(key)) {
                found = true;
                break;
            }
        }
        return found;
    }

    // in case you have a local folder with encrypted data that needs decrypted
    async decryptFolder(localDir) {
        let files = this.listLocalFiles(localDir);

        for (f of files) {
            if (f.substring(0, f.length - 4) === ".enc") {
                let dF = f.substring(0, f.length - 4);
                let e = new Encryptor();

                await encryptor.decryptFile(f, 
                    dF, 
                    this.config.get("encryption.passphrase"));

                this.logger.consoleAppend("decrypted file: [" + decryptedFile + "]");
        
                await this.delay(1500);
                fs.unlink(f, function (err) {
                    if (err) {
                        this.logger.consoleAppend("error deleting the enc file: " + err);
                    } else {
                        this.logger.consoleAppend("deleted encrypted file: " + f);
                    }
                });
            }
        }
    }

    // list all of the s3 keys
    async listS3Keys(params, allKeys) {
        //var self = this;
        let data = await this.s3.listObjectsV2(params).promise();
        var contents = data.Contents;
        contents.forEach(function(content) {
            allKeys.push(content.Key);
        });

        if (data.IsTruncated === true) {
            this.logger.consoleAppend("fetching continuation.");
            params.ContinuationToken = data.NextContinuationToken;
            allKeys = await this.listS3Keys(params, allKeys);
        } 
        
        return allKeys;
    }

    // 
    // check all s3 keys to make sure there is a local file
    // if no local file - delete the key from s3
    //
    async doPruneExtraS3Objects(localFolder, bucket, s3Folder) {
        var params = {
            Bucket: bucket,
            Prefix: s3Folder
        };

        let allKeys = [];
        allKeys = await this.listS3Keys(params, allKeys);
        this.logger.consoleAppend("s3 objects found: " + allKeys.length);
        const files = this.listLocalFiles(localFolder);
        this.logger.consoleAppend("local files found: " + files.length);
        let i = 0;
        for (let k of allKeys) {
            i++;
            if (this.runStatus === false) {
                break;
            }

            if (i % 100 === 0) {
                this.logger.consoleAppend("[" + i + "] of [" + allKeys.length + "] - checking: " + k);
            } 

            if (!this.isS3ObjectLocal(k, files) === true) {
                this.logger.consoleAppend("[" + i + "] of [" + allKeys.length + "] did not find local file for key: [" + k + "] - deleting from s3");
                let delResult = await this.s3.deleteObject({Bucket: bucket, Key: k}).promise();
                if (delResult.err) {
                    this.logger.consoleAppend("error deleting object: " + delResult.err);
                }
            }
        }

        this.logger.consoleAppend("finished.");
    }

     // restore job
    async doRestore(localFolder, bucket, s3Folder, threads) {
        let promises = [];
        let limit;
        if (threads) {
            this.logger.consoleAppend("setting threads: " + threads);
            limit = pLimit(parseInt(threads, 10));
        } else {
            limit = pLimit(parseInt(this.config.get("config.numThreads"), 10));
        }

        var params = {
            Bucket: bucket,
            Prefix: s3Folder
        };

        let allKeys = [];
        allKeys = await this.listS3Keys(params, allKeys);
        this.logger.consoleAppend("objects found: " + allKeys.length);

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
            stats.startTime = Date.now();

            promises.push(
                limit(() => this.processFileForDownload(
                    localFolder,
                    bucket,
                    k,
                    stats)
                )
            );
        }

        Promise.all(promises).then((values) => {
            this.logger.consoleAppend("restore finished");
        });
    }

    // list the top level folders in a bucket
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

        //this.logger.consoleAppend(f + " - processing");

        // analyze the file to see if we need to upload
        // does files exist on s3 bucket.  if so, is it outdated?
        let doUpload = await this.analyzeFile(f, key, bucket);

        // see if we need to upload
        if (doUpload === true) {

            if (this.encrypt === true) {
                let uploadKey = key + ".enc";

                // now encrypt and upload
                let encryptor = new Encryptor(this.logger);
                let encKey = this.config.get("encryption.passphrase");
                let i = 1;
                while (i < 3) {
                    const uploadRes = await encryptor.encryptFileAndUploadStream(f, 
                        encKey, this.s3, bucket, 
                        uploadKey);

                    if (uploadRes.success === true) {
                        this.logger.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + "] - [" + uploadKey + "] - s3 object uploaded");
                        break;
                    } else {
                        this.logger.consoleAppend("try [" + i + " of 2] ERROR uploading [" + uploadKey + "] : " + uploadRes.errCode);

                        if (uploadRes.errCode.includes("UnknownEndpoint")) {
                            this.logger.consoleAppend("endpoint down - will not retry and setting runStatus = false");
                            this.runStatus = false;
                            i = 2;
                        }

                        if (i == 2) {
                            this.addErrorFile(f);
                        }
                        i++;
                        await this.delay(5000);
                    }
                }
            } else {
                // do not encrypt - just upload
                let i = 0;
                while (i < 3) {
                    let uploadRes = await this.uploadFileAsStream(f, bucket, key);
                    if (uploadRes.success === true) {
                        this.logger.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + "] - [" + key + "] - s3 object uploaded");
                        break;
                    } else {
                        this.logger.consoleAppend("try [" + i + "] ERROR uploading [" + key + "] : " + uploadRes.errCode);

                        if (uploadRes.errCode.includes("UnknownEndpoint")) {
                            this.logger.consoleAppend("endpoint down - will not retry and setting runStatus = false");
                            this.runStatus = false;
                            i = 2;
                        }

                        if (i == 2) {
                            this.addErrorFile(f);
                        }
                        i++;
                        await this.delay(5000);
                    }
                }
            }  
        } else {
            this.logger.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + "] - [" + key + "] - s3 object is current");
        }

        // do a little timing
        if (stats.fCounter % 5 === 0) {
            let t = Date.now();
            let ms = t - stats.startTime;
            let m = Math.round(ms / 60000);
            let s = ((ms % 60000) / 1000).toFixed(0);
            let rate = 1;
            if (m !== 0) {
                rate = Math.round(stats.fCounter / m);
            }
            this.logger.consoleAppend("rate per min: " + rate);
            let eta = Math.round((stats.fCount - stats.fCounter) / rate);
            this.updateRuntime(m,s, eta);

            // print memory usage
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            this.logger.consoleAppend("memory usage: " + Math.round(used * 100) / 100 + "MB");

            // see if we have a stop file 
            try {
                if (fs.existsSync("./stop")) {
                    this.logger.consoleAppend("stop file found - setting run status to false.");
                    this.setRunStatus(false);
                }
            } catch (err) {
                this.logger.consoleAppend("error checking for stop file: " + err);
            }
        }
    }

    // upload a file via streams
    async uploadFileAsStream (f, bucket, key) {
        let resObj = { success: false, errCode: 'none' };

        let readStream = fs.createReadStream(f);
        let ws = new PassThrough();

        var body = readStream
            .pipe(ws);

        let self = this;
        var r = await new Promise((resolve, reject) => {
            var opts = {queueSize: 2, partSize: 1024 * 1024 * 10};
            this.s3.upload({Bucket: bucket, Key: key, Body: body}, opts).
            on('httpUploadProgress', function(evt) {
                self.logger.consoleAppend("Progress: " + evt.loaded + "/" +  evt.total);
            }).
            send(function(err, data) {
                if (err) {
                    self.logger.consoleAppend("error uploading: " + err);
                    resObj.errCode = err.code;
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });

        resObj.success = r;
        return (resObj);
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
        let data = "";
        try {
            data = await this.s3.headObject(params).promise();
        } catch (err) {
            if (err.code === 'NotFound') {
                return doUpload;
            } else if (err.code === 'UnknownEndpoint') {
                this.logger.consoleAppend("s3 headObject : cannot contact host - runStatus to false");
                this.runStatus = false;
                return doUpload;
            } else {
                this.logger.consoleAppend("headObject error: " + err.code + " - uploading");
                return doUpload;
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
            } 
        } catch (error) {
            this.logger.consoleAppend("error checking dates for file [" + f + "] - assume outdated.");
            s3Outdated = true;
        }
        
        // if all of our tests passed, then do not upload
        if (objectExists === true && s3Outdated === false) {
            doUpload = false;
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

        // setup the directory for download
        let writeDir = localDir + "/" + key.substring(0, key.lastIndexOf("/"));
        let writeFile = key.substring(key.lastIndexOf("/") + 1);
        writeDir = writeDir.replace(/\//g, '\\');
        let fullPath = writeDir + "\\" + writeFile;
        this.logger.consoleAppend("[" + stats.fCounter + " - " + stats.fCount + "] - downloading object: " + key);
    
        // make sure target directory exists on local folder
        fs.mkdirSync(writeDir, { recursive: true});

        var params = {
            Bucket: bucket,
            Key: key
        }
    
        // download the object
        if (key.substring(key.length - 4) === ".enc") {
            let e = new Encryptor();
            try {
                fullPath = fullPath.substring(0, fullPath.length - 4);

                if (fs.existsSync(fullPath)) {
                    this.logger.consoleAppend("object exists in restore point - skipping...");
                    return;
                }

                await e.downloadStreamAndDecrypt(this.s3, 
                    bucket, key, 
                    this.config.get("encryption.passphrase"), 
                    fullPath,
                    this.guimode
                );
                //await this.delay(1000);

            } catch (err) {
                console.log("error : " + err);
            }
        } else {
            if (fs.existsSync(fullPath)) {
                let data = "";
                data = await this.s3.headObject(params).promise();
                let stats = fs.statSync(fullPath);
                let s3Date = new Date(data.LastModified);
                let fileDate = new Date(stats.mtime);
                if (fileDate > s3Date) {
                    this.logger.consoleAppend("file already exists on restore point and is current - skipping.");
                    return;
                }
            }
            
            let readStream = this.s3.getObject(params).createReadStream();
            let fileSize = 0;
            let pm = new ProgressMonitor(fileSize, this.logger, key);
            let ws = fs.createWriteStream(fullPath);
            let result = await new Promise((resolve, reject) => {
                ws.on('finish', () => {
                    resolve(true);
                });
                
                ws.on('end', () => {
                    resolve(true);
                });

                ws.on('error', () => {
                    reject(false);
                });

                readStream
                    .pipe(pm)
                    .pipe(ws);
            });
        }


        // do a little timing
        if (stats.fCounter % 10 === 0) {
            let t = Date.now();
            let ms = t - stats.startTime;
            let m = Math.round(ms / 60000);
            let s = ((ms % 60000) / 1000).toFixed(0);
            let rate = 1;
            if (m !== 0) {
                rate = Math.round(stats.fCounter / m);
            }
            this.logger.consoleAppend("rate per min: " + rate);
            let eta = Math.round((stats.fCount - stats.fCounter) / rate);
            this.updateRuntime(m,s, eta);

            // see if we have a stop file 
            try {
                if (fs.existsSync("./stop")) {
                    this.logger.consoleAppend("stop file found - setting run status to false.");
                    this.setRunStatus(false);
                }
            } catch (err) {
                this.logger.consoleAppend("error checking for stop file: " + err);
            }

            // print mem usage
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            this.logger.consoleAppend("memory usage: " + Math.round(used * 100) / 100 + "MB");
        } 
    }

    //
    // delay x number of ms
    //
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    //
    // get a list of the local files that we want to work with
    // exclude dirs will be a list of top level directories that we want
    // to exclude from the backup
    //
    listLocalFiles(dirPath, arrayOfFiles, excludeDirs) {
        var self = this;
        let files = [];

        try {
            files = fs.readdirSync(dirPath);
        } catch (err) {
            this.logger.consoleAppend(err.stack);
        }
      
        var self = this;
        arrayOfFiles = arrayOfFiles || [];

        files.forEach(function(file) {
            let abs = path.join(dirPath, file);
            if (fs.statSync(abs).isDirectory()) {
                
                let excludeThis = false;

                if (excludeDirs) {
                    for (let d of excludeDirs.split(',')) {
                        if (abs.toLowerCase().includes(d.toLowerCase())) {
                            excludeThis = true;
                            self.logger.consoleAppend("excluding directory: " + abs);
                            break;
                        }
                    }
                }

                if (excludeThis === false) {
                    if (fs.readdirSync(abs).length === 0) {
                        self.logger.consoleAppend("dir: [" + abs + "] is empty.  adding to objects that need uploaded");
                        arrayOfFiles.push(abs);
                    } else {
                        arrayOfFiles = self.listLocalFiles(abs, arrayOfFiles);
                    }
                }
            } else {
                arrayOfFiles.push(abs)
            }
        })
      
        return arrayOfFiles
    }

}

module.exports = BackupJob;