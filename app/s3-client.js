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



//
// parse command line args
//
const argv = yargs
    .command('backup', 'backs up specified folder')
    .command('listfolders', 'lists the top level folders in this bucket')
    .command('restore', 'restore data to local directory')
    .command('config', 'command to configure the app')
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
    .option('threads', {
        alias: 't',
        description: 'number of threads to use for jobs',
        type: 'text',
    })
    .option('endpoint', {
        description: 'set s3 endpoint',
        type: 'text',
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
        console.log("backup initiated");

        if (!argv.localdir) {
            console.log("missing --localdir option");
            return;
        }

        if (!argv.s3bucket) {
            console.log("missing --s3bucket option");
            return;
        }

        let backupJob = new BackupJob( config, certFile);
        backupJob.connectToS3();

        if (argv.encrypt === true) {
            console.log("setting encrypt flag = true");
            backupJob.setEncryption(true);
        }

        backupJob.backupFolderToS3(argv.localdir, argv.s3bucket, argv.s3folder);
    }

    // listfolders job
    if (argv.listfolders === true) {
        let bucket = argv.s3bucket;
        console.log("listing folders for bucket: " + bucket);

        let backupJob = new BackupJob(config, certFile);
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

        if (!argv.s3bucket) {
            console.log("missing --s3bucket option");
            return;
        }

        let backupJob = new BackupJob(config, certFile);
        backupJob.connectToS3();
        backupJob.doRestore(argv.localdir, argv.s3bucket, argv.s3folder);
    }

    // config app
    if (argv.config === true) {
        if (argv.threads) {
            config.set("config.numThreads", argv.threads);
            console.log("config - set threads to : " + argv.threads);
        }

        if (argv.endpoint) {
            config.set("s3.endpoint", argv.endpoint);
        }
    }
}



main();

