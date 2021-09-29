const { Transform } = require('stream');
const ConsoleLogger = require('./console-logger');
const log = require('./console-logger');

class ProgressMonitor extends Transform {
    constructor(totalBytes, logger, key, opts) {
        super(opts);
        this.totalBytes = totalBytes;
        this.processedBytes = 0;
        this.key = key;
        this.logger = logger;
    }

    _transform(chunk, encoding, cb) {
        this.processedBytes += chunk.length;
        this.push(chunk);
        let processedKb = Math.round(this.processedBytes / 1024);
        let totalKb = Math.round(this.totalBytes / 1024);

        if (processedKb > 1000 && 
            processedKb % 1000 === 0) {
            this.logger.consoleAppend(this.key + " - [" + processedKb + "KB] of [" + totalKb + "KB]");
        }

        // callback
        cb();
    }
}

module.exports = ProgressMonitor;