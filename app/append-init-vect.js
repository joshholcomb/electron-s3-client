const { Transform } = require('stream');

class AppendInitVect extends Transform {
    constructor(iv, opts) {
        super(opts);
        this.iv = iv;
        this.appended = false;
    }

    _transform(chunk, encoding, cb) {
        if (!this.appended) {
            this.push(this.iv);
            this.appended = true;
        }
        this.push(chunk);
        cb();
    }
}

module.exports = AppendInitVect;