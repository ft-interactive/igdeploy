'use strict';

var fs = require('fs'),
    path = require('path'),
    chalk = require('chalk'),
    async = require('async');

module.exports = function uploadDirectoryContents(sftp, localDirName, remoteDirName, done) {
  // Ensure it exists and is a directory
  sftp.stat(remoteDirName, function (err, stats) {
    if (err)
      return done(err);
    
    if (!stats.isDirectory())
      return done(new Error('Target path is not a directory: ' + remoteDirName));

    var allLocalFiles = fs.readdirSync(localDirName);

    async.eachSeries(allLocalFiles, function (item, done) {
      var from = path.join(localDirName, item),
          to = path.join(remoteDirName, item);

      // check it's a file
      var stats = fs.statSync(from);
      if (stats.isFile()) {
        sftp.fastPut(from, to, {mode: parseInt('0775', 8)}, function (err) {
          if (err)
            done(err);
          else {
            console.log(chalk.yellow('---> Uploaded'), item);
            done(null);
          }
        });
      }
      else if (stats.isDirectory()) {
        // recursively upload the child dir
        sftp.mkdir(to, {mode: parseInt('0775', 8)}, function (err) {
          if (err) return done(err);

          uploadDirectoryContents(sftp, from, to, done);
        });
      }
      else {
        // something already exists and it's not a dir
        console.log('Unknown object', stats);
        throw new Error('Local filesystem object is neither a file nor a directory: ' + from);
      }
    }, function (err) {
      if (err) return done(err);
      
      // all async upload operations completed successfully, including any recursive dir uploads.
      done();
    });

  });
};
