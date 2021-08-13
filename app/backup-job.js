
var myConsole = new nodeConsole.Console(process.stdout, process.stderr); // for console logging
const path = require("path");                   
const fs = require('fs');                     // for filesystem work
const AWS = require('aws-sdk');
const Encryptor = require('./file-encrypt');    // file encryption

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

    constructor(s3, localFolder, s3Bucket, s3Folder) {
        this.s3 = s3;
        this.localFolder = localFolder;
        this.s3Bucket = s3Bucket;
        this.s3Folder = s3Folder;
    }

    // TODO: implement
    doBackup(s3, localFolder, s3Bucket, s3Folder) {
        myConsole.log("traversing directory [" + folderName + "]");
        const files = this.getAllFiles(folderName);
        consoleAppend("files found: [" + files.length + "]");
        
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

    getAllFiles(dirPath, arrayOfFiles) {
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