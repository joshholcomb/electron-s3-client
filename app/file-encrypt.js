const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AppendInitVect = require('./append-init-vect.js');
const RemoveInitVect = require('./remove-init-vect.js');
const ProgressMonitor = require('./progress-monitor');
const stream = require('stream');
const Throttle = require('throttle-stream');
const pipeline = require('util').promisify(require("stream").pipeline);


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

    async encryptFileAndUploadStream(inFile, password, s3, bucket, key, kBps, guimode) {
        try {
            let initVect = crypto.randomBytes(16);
            let k = this.getCipherKey(password);
            let readStream = fs.createReadStream(inFile);
            let gzip = zlib.createGzip();
            let cipher = crypto.createCipheriv("aes-256-cbc", k, initVect);
            let appendInitVect = new AppendInitVect(initVect);
            let throttle = new Throttle({ bytes: kBps * 1024, interval: 1000 });
            let stats = fs.statSync(inFile);
            let fileSize = stats.size;
            let pm = new ProgressMonitor(fileSize, inFile, guimode);
            var ws = new stream.PassThrough();
            let p = s3.upload({Bucket: bucket, Key: key, Body: ws }).promise();

            ws.on('error', (err) => {
                console.log("writestream error: " + err);
            });

            ws.on('finish', () => {
                console.log("writestream finished");
            });

            await pipeline(readStream, 
                gzip,
                cipher,
                appendInitVect,
                throttle,
                pm,
                ws);

            p.then(() => {
                console.log("upload completed successfully");
            }).catch((err) => {
                console.log("error uploading file: " + err);
            });
            

        } catch (err) {
            console.log("error encrypting and uploading file: " + err);
        }
    }

    //
    // download object and decrypt before writing to disk
    //
    async downloadStreamAndDecrypt(s3, s3bucket, s3key, passphrase, writeFile, kBps) {
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
        await pipeline(rs, 
            decipher, 
            unzip, 
            throttle, 
            ws);
        
    }

    getCipherKey(password) {
        return crypto.createHash('sha256').update(password).digest();
    }

}

module.exports = Encryptor;
