const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const AppendInitVect = require('./append-init-vect.js');


class Encryptor {

    encryptFile(inFile, outFile, password) {

        try {
            let initVect = crypto.randomBytes(16);
            let k = this.getCipherKey(password);
            let readStream = fs.createReadStream(inFile);
            let gzip = zlib.createGzip();
            alert(crypto.getHashes());
            let cipher = crypto.createCipheriv("aes-256-cbc", k, initVect);
            let appendInitVect = new AppendInitVect(initVect);
            let writeStream = fs.createWriteStream(outFile);

            alert("piping stream");
            readStream
                .pipe(gzip)
                .pipe(cipher)
                .pipe(appendInitVect)
                .pipe(writeStream);
        } catch (err) {
            alert(err);
            return;
        }
    }

    decryptFile(inFile, outFile, password) {
        let readIv = fs.createReadStream(inFile, { end: 15 });

        let initVect = '';
        readIv.on('data', (chunk) => {
            initVect = chunk;
        });

        readIv.on('close', () => {
            let readStream = fs.createReadStream(inFile, { start: 16 });
            let cipherKey = this.getCipherKey(password);
            let decipher = crypto.createDecipheriv('aes256', cipherKey, initVect);
            let unzip = zlib.createUnzip();
            let writeStream = fs.createWriteStream(outFile);
            readStream
                .pipe(decipher)
                .pipe(unzip)
                .pipe(writeStream);
        });
    }

    getCipherKey(password) {
        return crypto.createHash('sha256').update(password).digest();
    }
}

module.exports = Encryptor;
