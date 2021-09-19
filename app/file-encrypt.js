const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AppendInitVect = require('./append-init-vect.js');
const RemoveInitVect = require('./remove-init-vect.js');
const ProgressMonitor = require('./progress-monitor');
const stream = require('stream');
const Throttle = require('throttle-stream');
//const pipeline = require('util').promisify(require("stream").pipeline);
//const { pipeline } = require('stream/promises');


class Encryptor {

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

    //
    // encrypt a file and upload to s3 as a stream
    // return (true/false)
    //
    async encryptFileAndUploadStream(inFile, password, s3, bucket, key, kBps, guimode) {
        let resObj = { success: false, errCode: 'none'};
        
        let initVect = crypto.randomBytes(16);
        let k = this.getCipherKey(password);
        let readStream = fs.createReadStream(inFile);
        let gzip = zlib.createGzip();
        let cipher = crypto.createCipheriv("aes-256-cbc", k, initVect);
        let appendInitVect = new AppendInitVect(initVect);
        let throttle = new Throttle({ bytes: kBps * 1024, interval: 1000 });
        let stats = fs.statSync(inFile);
        let fileSize = stats.size;
        let pm = new ProgressMonitor(fileSize, guimode, key);
        var ws = new stream.PassThrough();
        let p = s3.upload({Bucket: bucket, Key: key, Body: ws }).promise();

        try {
            const upResult = await new Promise((resolve, reject) => {

                p.then(() => {
                    resObj.success = true;
                    resolve(true);
                }).catch((err) => {
                    console.log("caught error in s3.upload promise: " + err);
                    resObj.success = false;
                    resObj.errCode = err.code;
                    ws.emit('error');
                    readStream.unpipe();
                    reject("error uploading s3 object");
                });

                /*
                ws.on('finish', () => {
                    resolve(true);
                });
            
                ws.on('error', () => {
                    resObj.success = false;
                    readStream.unpipe();
                    reject("received error on write stream");
                });
                */

                readStream
                    .pipe(throttle)
                    .pipe(gzip)
                    .pipe(cipher)
                    .pipe(appendInitVect)
                    .pipe(pm)
                    .pipe(ws);
            });

        } catch (err) {
            console.log("error uploading file: " + err);
        }

        return (resObj);

    }

    //
    // download object and decrypt before writing to disk
    //
    async downloadStreamAndDecrypt(s3, s3bucket, s3key, passphrase, writeFile, kBps, guimode) {
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
        let throttle = new Throttle({ bytes: kBps * 1024, interval: 1000 });
        let fileSize = 0;
        let pm = new ProgressMonitor(fileSize, guimode, s3key);
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
                .pipe(throttle)
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
