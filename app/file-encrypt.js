const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const AppendInitVect = require('./append-init-vect.js');


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

    async decryptFile(inFile, outFile, password) {
        console.log("reading encFile: [" + inFile + "]");

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
