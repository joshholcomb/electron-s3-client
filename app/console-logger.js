var os = require("os");



class ConsoleLogger {

    constructor(guimode) {
        this.guimode = guimode;
    }

    consoleAppend(msg) {

        // prepend date/time to msg
        let dateTime = new Date();
        msg = dateTime + ": " + msg;

        if (this.guimode === true) {
            var ta = document.getElementById("txtConsole");
            var val = ta.value;
            if (val) {
                ta.value = val + '\r\n' + msg;
            } else {
                ta.value = msg;
            }
        
            // scroll to end
            ta.scrollTop = ta.scrollHeight;
        
            // if more than 200 lines - remove all but 200 lines
            var txt = ta.value.length ? ta.value.split(/\r\n/g) : [];
            ta.value = txt.slice(-200).join('\r\n');
        } else {
            console.log(msg);
        }
    }
}

module.exports = ConsoleLogger;