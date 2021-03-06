//
// command line utility to schedule jobs via task scheduler
//


//
// globals
//
const { Main } = require('electron');
const yargs = require('yargs');
const BackupJob = require('./backup-job');
const Store = require('./store');
// end globals



// catch errors
process.on('uncaughtException', (err) => {
    console.log("error: " + err);
});

// catch kill signals
process.once('SIGINT', function (code) {
    console.log('SIGINT received...');
    process.exit(0);
});

process.once('SIGTERM', function (code) {
    console.log('SIGTERM received...');
    process.exit(0);
});




//
// parse command line args
//
const argv = yargs
    .command('backup', 'backs up specified folder')
    .command('listfolders', 'lists the top level folders in this bucket')
    .command('restore', 'restore data to local directory')
    .command('pruneBackup', 'prune extra s3 objects from backup')
    .command('config', 'command to configure the app', {
        endpoint: {
            describe: 's3 endpoint to use',
            demandOption: false,
            type: 'text'
        },
        s3access: {
            describe: 's3 access key',
            demandOption: false,
            type: 'text'
        },
        s3secret: {
            describe: 's3 secret key',
            demandOption: false,
            type: 'text'
        },
        bucket: {
            describe: 'default s3 bucket',
            demandOption: false,
            type: 'text'
        },
        encPass: {
            describe: 'encryption password',
            demandOption: false,
            type: 'text'
        },
        tmpDir: {
            describe: 'tmp dir for encrypted files',
            demandOption: false,
            type: 'text'
        },
        print: {
            describe: 'print config',
            demandOption: false,
            type: 'boolean'
        }
    })
    .option('threads', {
        description: 'number of threads for job',
        type: 'text'
    })
    .option('localdir', {
        alias: 'l',
        description: 'local directory',
        type: 'text',
    })
    .option('s3bucket', {
        alias: 'b',
        description: 's3 bucket to work with',
        type: 'text',
    })
    .option('s3folder', {
        alias: 'f',
        description: 's3 folder to work with',
        type: 'text',
    })
    .option('encrypt', {
        alias: 'e',
        description: 'flag to request encryption',
        type: 'boolean',
    })
    .option('excludedirs', {
        description: 'comma separated list of top level directories to exclude from backup',
        type: 'text'
    })
    .argv;



// setup config
const config = new Store({
    configName: 'default',
    defaults: {
        "s3": {
            "accessKey": "josh",
            "secretAccessKey": "test",
            "endpoint": "myendpoint"
        },
        "encryption": {
            "passphrase": "testkey",
            "tmpDir": "folder"
        },
        "config": {
            "numThreads": "3"
        }
    }
  });


//
// process work
//
async function main() {
    let certFile = "./config/my-ca-cert.crt";

    // backup job
    if (argv.backup === true) {
        console.log("backup initiated\r\n");

        if (!argv.localdir) {
            console.log("missing --localdir option");
            return;
        }

        if (!argv.s3bucket) {
            console.log("missing --s3bucket option");
            return;
        }

        if (!argv.s3folder) {
            console.log("missing --s3folder option");
            return;
        }

        let backupJob = new BackupJob(config, certFile, false);
        backupJob.connectToS3();

        if (argv.encrypt === true) {
            console.log("setting encrypt flag = true\r\n");
            backupJob.setEncryption(true);
        }

        backupJob.doBackup(argv.localdir, 
                argv.s3bucket, 
                argv.s3folder, 
                argv.excludedirs, 
                argv.threads);
    }

    // pruneExtraS3
    // delete files from s3 that are not present in local folder
    // maintenance job
    if (argv.pruneBackup === true) {
        if (!argv.s3bucket) {
            console.log("required option s3 bucket");
            process.exit(1);
        }

        if (!argv.localdir) {
            console.log("required option localdir");
            process.exit(1);
        }

        if (!argv.s3folder) {
            console.log("required option s3folder");
            process.exit(1);
        }

        let backupJob = new BackupJob(config, certFile, false);
        backupJob.connectToS3();

        backupJob.doPruneExtraS3Objects(argv.localdir, argv.s3bucket, argv.s3folder);
    }

    // listfolders job
    if (argv.listfolders === true) {
        let bucket = config.get("s3.defaultBucket");

        if (argv.s3bucket) {
            bucket = argv.s3bucket;
        }
        
        console.log("listing folders for bucket: " + bucket);

        let backupJob = new BackupJob(config, certFile, false);
        backupJob.connectToS3();
        var folders = await backupJob.listBucketFolders(bucket);
        console.log("===results: " + folders.length + "===");

        for (const f of folders) {
            console.log(f.number + " - " + f.name);
        }
    }

    // restore job
    if (argv.restore === true) {
        if (!argv.localdir) {
            console.log("missing --localdir option");
            return;
        }

        let bucket = config.get("s3.defaultBucket");
        if (argv.s3bucket) {
            bucket = argv.s3bucket;
        }

        let backupJob = new BackupJob(config, certFile, false);
        backupJob.connectToS3();
        backupJob.doRestore(argv.localdir, bucket, argv.s3folder, argv.thread);
    }

    // config app
    if (argv.config === true) {
        if (argv.threads) {
            config.set("config.numThreads", argv.threads);
            console.log("config - set threads to : " + argv.threads);
        }

        if (argv.endpoint) {
            config.set("s3.endpoint", argv.endpoint);
            console.log("config - set endpoint to : " + argv.endpoint);
        }

        if (argv.s3access) {
            config.set("s3.accessKey", argv.s3access);
            console.log("config - set s3 access key to : " + argv.s3access);
        }

        if (argv.s3secret) {
            config.set("s3.secretAccessKey", argv.s3secret);
            console.log("config - set s3 secret key to : " + argv.s3secret);
        }

        if (argv.bucket) {
            config.set("s3.defaultBucket", argv.bucket);
            console.log("config - set defaultBucket to : " + argv.bucket);
        }

        if (argv.encPass) {
            config.set("encryption.passphrase", argv.encPass);
            console.log("config - set encryption.passphrase to : " + argv.encPass);
        }

        if (argv.tmpDir) {
            config.set("encryption.tmpDir", argv.tmpDir);
            console.log ("config - set encryption.tmpDir to : " + argv.tmpDir);
        }

        if (argv.print === "true") {
            console.log("config: " + JSON.stringify(config.data, null, 2));
        }
        
    }
}



main();



