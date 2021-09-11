# electron-s3-client
electron-js s3 client

# objective
Electron based s3 client to backup files from local machine to a configured s3 bucket.  
* targets: s3 (aws or minio)
* encryption: client side encryption before upload
* compression: gzip data before upload when encryption is selected.



# configuration
conf directory will hold certificate and json config file.  

## certificates
When you connect to a minio server using your own certificate (openssl) you will need to provide
your ca certificate to connect using the s3-client.  This is not required when connecting to aws.s

## config file
This file will be created after first run with user settings.  On first run, click on file->config settings to configure
your client to connect to your s3 endpoint.

# gui and cli
to run the gui
- download repo
- npm install
- npm start

to run the cli
- download repo
- npm install
- node app\s3-client.js --command --options

