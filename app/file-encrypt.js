const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AppendInitVect = require('./append-init-vect.js');
const RemoveInitVect = require('./remove-init-vect.js');
const stream = require('stream');
const { pipeline } = require('stream/promises');
const Throttle = require('throttle-stream');

// sleep function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

    async encryptFileAndUploadStream(inFile, password, s3, bucket, key, kBps) {
        try {
            let initVect = crypto.randomBytes(16);
            let k = this.getCipherKey(password);
            let readStream = fs.createReadStream(inFile);
            let gzip = zlib.createGzip();
            let cipher = crypto.createCipheriv("aes-256-cbc", k, initVect);
            let appendInitVect = new AppendInitVect(initVect);
            let throttle = new Throttle({ bytes: kBps * 1024, interval: 1000 });
            var {writeStream, promise} = this.uploadStream(s3, {Bucket: bucket, Key: key});

            await pipeline(readStream, 
                gzip,
                cipher,
                appendInitVect,
                throttle,
                writeStream);

        } catch (err) {
            console.log("error encrypting and uploading file: " + err);
        }
    }

    uploadStream = (s3, { Bucket, Key }) => {
        const pass = new stream.PassThrough();
        return {
            writeStream: pass,
            promise: s3.upload({ Bucket, Key, Body: pass }).promise(),
        };
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

        var rs = s3.getObject(params).createReadStream();
        var iv = await new Promise(resolve => {
            var gotiv = false
            var ivtemp = null;
            rs.on('readable', () => {
                try {
                    if(gotiv) {
                        console.log("got iv.  returning");
                        return;
                    }
                    
                    ivtemp = rs.read(16);
                    if(ivtemp) {
                        console.log("read iv data.");
                        gotiv = true;
                        resolve(ivtemp);
                    }
                } catch (err) {
                    console.log("error reading iv from stream: " + err);
                }
            });
        });

        try {
            let rs2 = s3.getObject(params).createReadStream();
            let removeInitVect = new RemoveInitVect();
            let cipherKey = this.getCipherKey(passphrase);
            let decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
            let unzip = zlib.createGunzip();
            let writeStream = fs.createWriteStream(writeFile);
            let throttle = new Throttle({ bytes: kBps * 1024, interval: 1000 });

            rs2.on('error', (err) => {
                console.log("error in read stream: " + err);
            });

            removeInitVect.on('error', (err) => {
                console.log("error in remove init vect stream: " + err);
            });

            decipher.on('error', (err) => {
                console.log("error on decipher stream: " + err);
            });

            unzip.on('error', (err) => {
                console.log("error on unzip stream: " + err);
            });

            throttle.on('error', (err) => {
                console.log("error on throttle stream: " + err);
            });

            writeStream.on('error', (err) => {
                console.log("error on write stream: " + err);
            });

            await delay(1000);

            console.log("starting pipeline");
            
            await pipeline(rs2,
                removeInitVect,
                decipher,
                unzip,
                throttle,
                writeStream
            );
            
            console.log("pipeline complete.");
        } catch (err) {
            console.log("error: " + err);
        }
    }

    //
    // decrypt a specific file
    //
    async decryptFile(inFile, outFile, password) {
        var readIv = 
            fs.createReadStream(inFile, { end: 15 });

        let initVect = '';
        readIv.on('data', (chunk) => {
            initVect = chunk;
        });
        await delay(1500);

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

    getCipherKey(password) {
        return crypto.createHash('sha256').update(password).digest();
    }

}

module.exports = Encryptor;
