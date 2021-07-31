const Store = require('./store');

const config = new Store({
    configName: 'default',
    defaults: {
        "s3": {
            "accessKey": "josh",
            "secretAccessKey": "test",
            "endpoint": "myendpoint"
        },
        "encryption": {
            "encryptionKey": "testkey",
            "encryptionFolder": "folder"
        }
    }
  });

  console.log("config loaded.")
  console.log("s3 endpoint: " + config.get("s3.endpoint"));