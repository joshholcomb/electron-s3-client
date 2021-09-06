const { Transform } = require('stream');

class ProgressMonitor extends Transform {
    constructor(totalBytes, file, guimode, startTime, opts) {
        super(opts);
        this.totalBytes = totalBytes;
        this.processedBytes = 0;
        this.file = file;
        this.guimode = guimode;
        this.startTime = startTime;
    }

    _transform(chunk, encoding, cb) {
        this.processedBytes += chunk.length;
        this.push(chunk);
        let processedKb = Math.round(this.processedBytes / 1024);
        let totalKb = Math.round(this.totalBytes / 1024);
        this.updateProgress(totalKb, processedKb);

        // timing
        let t = Date.now();
        let ms = t - this.startTime;
        let m = Math.round(ms / 60000);
        let s = ((ms % 60000) / 1000).toFixed(0);
        this.updateRuntime(m,s);

        // callback
        cb();
    }

    updateProgress(totalKb, processedKb) {
        let p = `${processedKb}KB of ${totalKb}KB`;
        if (this.guimode === true) {
            let l = document.getElementById("progress");
            l.textContent = p;
        } else {
            console.log(this.file + " - [" + processedKb + "KB] of [" + totalKb + "KB]");
        }
    }

    // update runtime if in guimode
    updateRuntime(m, s) {
        let dur = `${m}:${(s < 10 ? "0" : "")}${s}`;
        if (this.guimode === true) {
            let l = document.getElementById("lblRunTime");
            l.textContent = dur;
        } else {
            console.log("runtime: " + dur + " - eta: " + eta);
        }
    }
}

module.exports = ProgressMonitor;