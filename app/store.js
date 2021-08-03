const path = require('path');
const fs = require('fs');
var myConsole = new nodeConsole.Console(process.stdout, process.stderr); // for console logging

class Store {
  constructor(opts) {
    // Renderer process has to get `app` module via `remote`, whereas the main process can get it directly
    // app.getPath('userData') will return a string of the user's app data directory path.
    //const userDataPath = (electron.app || electron.remote.app).getPath('userData');
    // We'll use the `configName` property to set the file name and path.join to bring it all together as a string
    var loc = process.cwd();
    this.path = path.join(loc + '/config', opts.configName + '.json');
    this.data = parseDataFile(this.path, opts.defaults);
  }
  
  // This will just return the property on the `data` object
  get(key) {
    // my json is 2 deep
    myConsole.log("getting key: " + key);
    const myArr = key.split(".");
    return this.data[myArr[0]][myArr[1]];
  }
  
  // ...and this will set it
  set(key, val) {
    const myArr = key.split(".");
    this.data[myArr[0]][myArr[1]] = val;
    fs.writeFileSync(this.path, JSON.stringify(this.data));
  }
}

function parseDataFile(filePath, defaults) {
  // We'll try/catch it in case the file doesn't exist yet, which will be the case on the first application run.
  // `fs.readFileSync` will return a JSON string which we then parse into a Javascript object
  try {
    return JSON.parse(fs.readFileSync(filePath));
    
  } catch(error) {
    // if there was some kind of error, return the passed in defaults instead.
    return defaults;
  }
}

// expose the class
module.exports = Store;