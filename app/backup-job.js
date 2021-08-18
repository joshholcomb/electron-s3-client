
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
const AWS = require('aws-sdk');
const Encryptor = require('./file-encrypt');    // file encryption
const pLimit = require('p-limit');
var https = require('https');


/*
* class: BackupJob
*   has all data for a backup job
*/
class BackupJob {
    jobName;            // name of the job
    localFolder;        // local folder (src data on backup - target folder on restore)
    s3Bucket;           // s3 bucket containing the data
    s3Folder;           // s3 folder containing the data
    s3;                 // s3 connection object
    dayOfWeek = 0;      // schedule - what day of week to run job
    hourOfDay = 0;      // schedule - what hour of day to run job
    config;             // configuration from config file
    certFile;
    encrypt = false;
    runStatus = true;

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


    // backup a specified folder to a specified s3 target
    backupFolderToS3(localFolder, s3Bucket, s3Folder) {
        let promises = [];
        let limit = pLimit(this.config.get("config.numThreads"));
        console.log("traversing directory [" + localFolder + "]");
        const files = this.listLocalFiles(localFolder);
        console.log("files found: [" + files.length + "]");
        
        var fCount = 0;
        for (const f of files) {
            fCount = fCount + 1;
            const i = fCount;

            if (!this.runStatus) {
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
                    key)
                )
            );
        }

        (async () => {
            const result = await Promise.all(promises);
        });

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
    async processFileForUpload(f, bucket, key) {
        // analyze the file to see if we need to upload
        // does files exist on s3 bucket.  if so, is it outdated?
        let doUpload = await this.analyzeFile(f, key, bucket);
        console.log("\tdoUpload: " + doUpload);


        // see if we need to upload
        if (doUpload === true) {
            // see if we need to encrypt
            console.log("\tdoEncrypt: " + this.encrypt);

            if (this.encrypt === true) {
                console.log("encrypting file: " + f);
                let encryptDir = this.config.get("encryption.tmpDir");
                console.log("encryptionFolder: " + encryptDir);
                let uploadKey = key + ".enc";
                let encFile = encryptDir + "\\" + uploadKey;
                encFile = encFile.replace(/\//g, '\\');
                
                // make sure directory exists
                let e = encFile.substring(0, encFile.lastIndexOf("\\"));
                fs.mkdirSync(e, { recursive: true});

                // now encrypt
                let encryptor = new Encryptor();
                console.log("encrypting file: [" + f + "] to [" + encFile + "]");
                let encKey = this.config.get("encryption.passphrase");
                await encryptor.encryptFile(f, encFile, encKey);

                await this.delay(1500);
                
                // upload the encrypted file
                console.log("uploading encrypted file: " + encFile);
                var params = {Bucket: bucket, Key: uploadKey, Body: ''};
                var fileStream = fs.createReadStream(encFile);
                params.Body = fileStream;
                try {
                    const data = await this.s3.upload(params).promise();
                    console.log("uploaded [" + f + "] to [" + uploadKey + "]");
                } catch (err) {
                    console.log("ERROR - file: " + f + " err: " + err.stack);
                }

                // delete encFile
                console.log("deleting encrypted file: " + encFile);
                fs.unlink(encFile, function (err) {
                    if (err) {
                        console.log("error deleting the encFile : " + err);
                    }
                });
                
            } else {
                // do not encrypt - just upload
                var params = {Bucket: bucket, Key: key, Body: ''};
                var fileStream = fs.createReadStream(f);
                params.Body = fileStream;
                try {
                    const data = await this.s3.upload(params).promise();
                    console.log("uploaded [" + f + "] to [" + key + "]");
                } catch (err) {
                    console.log("ERROR - file: " + f + " err: " + err.stack);
                }
            }   
        } else {
            console.log("file [" + f + "] - s3 object is current");
        }
    }

    //
    // analyze a file to see if we need to upload it
    //
    async analyzeFile(f, key, bucket) {
        let doUpload = true;
        let objectExists = false;
        let s3Outdated = false;

        console.log("analyzing file: " + f);

        // see if object exists in s3
        var params = {
            Bucket: bucket,
            Key: key
        };

        let s3LastModified = null;
        try {
            const data = await this.s3.headObject(params).promise();
        } catch (err) {
            if (err.code === 'NotFound') {
                return doUpload;
            } else {
                console.log("error analyzing file. " + err);
                return false;
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
                console.log("\ts3 file is outdated");
            } else {
                console.log("\ts3 file is current");
            }
        } catch (error) {
            console.log("error getting local file mtime.");
        }
        
        // if all of our tests passed, then do not upload
        if (objectExists === true && s3Outdated === false) {
            doUpload = false;
        } else {
            console.log("tests failed - uploading file");
        }

        return(doUpload);
    }

    // restore job
    async doRestore(localFolder, bucket, s3Folder) {
        let promises = [];
        let limit = pLimit(this.config.get("config.numThreads"));

        var params = {
            Bucket: bucket,
            Prefix: s3Folder
        };

        let data = await this.s3.listObjectsV2(params).promise();
            
        console.log("objects found: " + data.Contents.length);

        var j = 0;
        for (let o of data.Contents) {

            if (this.runStatus === false) {
                break;
            }

            j++;
            const counter = j;

            promises.push(
                limit(() => this.processFileForDownload(
                    localFolder,
                    bucket,
                    o.Key)
                )
            );
        }

        const result = await Promise.all(promises);
    }

    //
    // process a single file for download
    //
    async processFileForDownload(localDir, bucket, key) {
    
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
            console.log("error downloading file: " + err);
        }
        
        // give a 1/2 second for the file write to settle (not sure if we need this)
        await this.delay(2000);
    
        // if encrypted - decrypt file
        // file.enc - length = 8 - pos = 4
        if (key.substring(key.length - 4) === ".enc") {
            console.log("file is encrypted. decrypting now");
            let encryptor = new Encryptor();
            let decryptedFile = fullPath.substring(0, fullPath.length - 4);
         
            await encryptor.decryptFile(fullPath, 
                decryptedFile, 
                this.config.get("encryption.passphrase"));
            
            console.log("decrypted file: [" + decryptedFile + "]");
    
            await this.delay(1500);

            console.log("deleting encrypted file: " + fullPath);
            await this.delay(1500);
            fs.unlink(fullPath, function (err) {
                if (err) {
                    console.log("error deleting the encFile : " + err);
                } else {
                    console.log("deleted encrypted file: " + fullPath);
                }
            });
        }
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

    setBackupSchedule(dayOfWeek, hourOfDay) {
        this.dayOfWeek = dayOfWeek;
        this.hourOfDay = hourOfDay;
    }

    listLocalFiles(dirPath, arrayOfFiles) {
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
                arrayOfFiles = this.getAllFiles(abs, arrayOfFiles)
            } else {
                arrayOfFiles.push(abs)
            }
        })
      
        return arrayOfFiles
    }

}

module.exports = BackupJob;