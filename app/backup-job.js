
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
const AWS = require('aws-sdk');
const Encryptor = require('./file-encrypt');    // file encryption
const pLimit = require('p-limit');


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

    // private variables
    s3;

    constructor(localFolder, s3Bucket, s3Folder, config, certFile) {
        this.localFolder = localFolder;
        this.s3Bucket = s3Bucket;
        this.s3Folder = s3Folder;
        this.config = config;
        this.certFile = certFile;
    }

    connectToS3() {
        try {
            fileContents = fs.readFileSync(certFile);
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
    
        this.s3 = s3;
    }

    // TODO: implement
    backupFolderToS3(s3, localFolder, s3Bucket, s3Folder) {
        myConsole.log("traversing directory [" + folderName + "]");
        const files = this.listLocalFiles(folderName);
        console.log("files found: [" + files.length + "]");
        
        var i = 0;
        for (const f of files) {
            i++;


        }

    }

    // TODO: implement
    doRestore(s3, localFolder, s3Bucket, s3Folder) {
        
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