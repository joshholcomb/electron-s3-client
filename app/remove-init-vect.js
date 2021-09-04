const { Transform } = require('stream');

class RemoveInitVect extends Transform {
    constructor(opts) {
        super(opts);
        this.removed = false;
    }

    _transform(chunk, encoding, cb) {
        if (!this.removed) {
            console.log("removing init vect");
            try {
                let toss = chunk.slice(0,16);
                let keep = chunk.slice(16);
                this.push(keep);
                this.removed = true;
            } catch (err) {
                console.log("transform error: " + err);
            }
        } else {
            try {
                this.push(chunk);
            } catch (err) {
                console.log("transform error: " + err);
            }
        }
        cb();
    }
}

module.exports = RemoveInitVect;