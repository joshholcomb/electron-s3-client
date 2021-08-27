var Throttle = require('throttle');
const fs = require('fs');


var rs = fs.createReadStream("d:\\software\\os\\ubuntu-18.04.4-desktop-amd64.iso");
var ws = fs.createWriteStream("d:\\software\\os\\ubuntu-out.iso");
var t = new Throttle(500);

rs
.pipe(t)
.pipe(ws);


