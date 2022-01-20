const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AppendInitVect = require('./append-init-vect.js');
const RemoveInitVect = require('./remove-init-vect.js');
const ProgressMonitor = require('./progress-monitor');
const stream = require('stream');
const logger = require('./console-logger');



class Encryptor {

    logger;

    constructor(logger) {
        this.logger = logger;
    }


    async encryptFile(inFile, outFile, password) {
        let initVect = crypto.randomBytes(16);
        let k = this.getCipherKey(password);
        let readStream = fs.createReadStream(inFile);
        let gzip = zlib.createGzip();
        let cipher = crypto.createCipheriv("aes-256-cbc", k, initVect);
        let appendInitVect = new AppendInitVect(initVect);
        let writeStream = fs.createWriteStream(outFile);

        readStream
            .pipe(gzip)
            .pipe(cipher)
            .pipe(appendInitVect)
            .pipe(writeStream);
    }

    //
    // decrypt a specific file
    //
    async decryptFile(inFile, outFile, password) {
        var readIv = 
            fs.createReadStream(inFile, { end: 15 });

        let initVect = '';
        initVect = await new Promise((resolve, reject) => {
                readIv.on('data', (chunk) => {
                    resolve(chunk);
                });
        });

        if (!initVect) {
            console.log("error reading init vector from file - returning");
            return;
        }
        readIv.close();

        let readStream = fs.createReadStream(inFile, { start: 16 });
        let cipherKey = this.getCipherKey(password);
        let decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, initVect);
        let unzip = zlib.createGunzip();
        let writeStream = fs.createWriteStream(outFile);
        readStream
            .pipe(decipher)
            .pipe(unzip)
            .pipe(writeStream);
    }

    async encryptFileAndUploadStream(inFile, password, s3, bucket, key) {
        let resObj = { success: false, errCode: 'none'};
        
        let initVect = crypto.randomBytes(16);
        let k = this.getCipherKey(password);
        let readStream = fs.createReadStream(inFile);
        let gzip = zlib.createGzip();
        let cipher = crypto.createCipheriv("aes-256-cbc", k, initVect);
        let appendInitVect = new AppendInitVect(initVect);

        var body = readStream
            .pipe(gzip)
            .pipe(cipher)
            .pipe(appendInitVect);


        let self = this;
        var r = await new Promise((resolve, reject) => {
            var opts = {queueSize: 2, partSize: 1024 * 1024 * 10};
            s3.upload({Bucket: bucket, Key: key, Body: body}, opts).
            on('httpUploadProgress', function(evt) {
                self.logger.consoleAppend("Progress: " + evt.loaded + "/" +  evt.total);
            }).
            send(function(err, data) {
                if (err) {
                    self.logger.consoleAppend("error uploading: " + err);
                    resObj.errCode = err.code;
                    resolve(false);
                } else {
                    //self.logger.consoleAppend("uploaded file at: " + data.Location);
                    resolve(true);
                }
            });
        });

        resObj.success = r;

        return(resObj);
    }

    //
    // download object and decrypt before writing to disk
    //
    async downloadStreamAndDecrypt(s3, s3bucket, s3key, passphrase, writeFile, guimode) {
        // get initVect
        var params = {
            Bucket: s3bucket,
            Key: s3key
        }

        let rs = s3.getObject(params).createReadStream();
        let gotIv = false;
        var iv;
        var decipher = null;
        let cipherKey = this.getCipherKey(passphrase);
        let unzip = zlib.createGunzip();
        let fileSize = 0;
        let pm = new ProgressMonitor(fileSize, this.logger, s3key);
        let ws = fs.createWriteStream(writeFile);

        iv = await new Promise((resolve, reject) => {
            rs.once('readable', () => {
                if (gotIv === false) {
                    iv = rs.read(16);
                    gotIv = true;
                    resolve(iv);
                }
            });
        });

        decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);


        let result = await new Promise((resolve, reject) => {
            ws.on('end', () => {
                resolve(true);
            });

            ws.on('finish', () => {
                resolve(true);
            });

            ws.on('error', () => {
                reject(false);
            });

            rs.pipe(decipher)
                .pipe(unzip)
                .pipe(pm)
                .pipe(ws);
        });

        return(result);
    }

    getCipherKey(password) {
        return crypto.createHash('sha256').update(password).digest();
    }

}

module.exports = Encryptor;
