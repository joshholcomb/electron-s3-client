const { Transform } = require('stream');

class ProgressMonitor extends Transform {
    constructor(totalBytes, guimode, key, opts) {
        super(opts);
        this.totalBytes = totalBytes;
        this.processedBytes = 0;
        this.guimode = guimode;
        this.key = key;
    }

    _transform(chunk, encoding, cb) {
        this.processedBytes += chunk.length;
        this.push(chunk);
        let processedKb = Math.round(this.processedBytes / 1024);
        let totalKb = Math.round(this.totalBytes / 1024);

        if (processedKb > 1000 && 
            processedKb % 1000 === 0) {
            this.consoleAppend(this.key + " - [" + processedKb + "KB] of [" + totalKb + "KB]");
        }

        // callback
        cb();
    }

    consoleAppend(msg) {
        if (this.guimode === true) {
            var ta = document.getElementById("txtConsole");
            var val = ta.value;
            if (val) {
                ta.value = val + '\n' + msg;
            } else {
                ta.value = msg;
            }
        
            // scroll to end
            ta.scrollTop = ta.scrollHeight;
        
            // if more than 200 lines - remove all but 200 lines
            var txt = ta.value.length ? ta.value.split(/\n/g) : [];
            ta.value = txt.slice(-200).join("\n");
        } else {
            console.log(msg);
        }
    }
}

module.exports = ProgressMonitor;