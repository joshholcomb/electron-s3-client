

class ConsoleLogger {

    constructor(guimode) {
        this.guimode = guimode;
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

module.exports = ConsoleLogger;