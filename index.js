'use strict';

var path = require('path'),
    fs = require('fs'),
    Connection = require('ssh2'),
    chalk = require('chalk'),
    _ = require('lodash'),
    mkdirpRemote = require('./lib/mkdirp-remote'),
    uploadDirectoryContents = require('./lib/upload-directory-contents');

var defaults = {
  port: 22,
  destPrefix: '',
  undo: false
};

var once = function (fn) {
  var called = false;
  return function () {
    if (called) throw new Error('Function called more than once');
    called = true;
    fn.apply(null, arguments);
  };
};

// Function to find the closest .igdeploy file to the current directory.
// Looks first in the current dir, then up a level, etc.
var findClosestFile = function (name) {
  var dir = process.cwd(),
      filePath, stats;
  
  while (dir !== (dir = path.dirname(dir))) {
    filePath = path.join(dir, name);
    // console.log('Looking for', filePath);
    if (fs.existsSync(filePath)) {
      stats = fs.statSync(filePath);
      if (stats.isFile(filePath))
        return filePath;
    }
  }
  return null;
};


module.exports = function (options, _callback) {
  var callback = once(_callback);

  // process options, including any from the closest igdeploy file found
  var extraConfigPath = findClosestFile('.igdeploy');
  if (extraConfigPath) {
    console.log(chalk.cyan('Using additional config from ') + extraConfigPath, '\n');
    options = _.assign({}, extraConfigPath, options);
  }
  else {
    console.log(chalk.red('Warning: no .igdeploy file found'), '\n');
  }
  options = _.assign({}, defaults, JSON.parse(fs.readFileSync(extraConfigPath)), options);

  // validate options
  if (!_.isString(options.username) || !_.isString(options.password))
    return callback(new Error('Username and/or password missing - please define them in an .igdeploy file.'));
  if (!_.isString(options.dest)) return callback(new Error('options.dest missing or not a string'));
  if (!_.isString(options.src)) return callback(new Error('options.src missing or not a string'));
  if (!_.isString(options.host)) return callback(new Error('options.host missing or not a string'));

  // function to get a shortened remote path (relative to dest root) for logging purposes
  function relPath(name) {
    if (options.destPrefix && name.substring(0, options.destPrefix.length) === options.destPrefix)
      return name.substring(options.destPrefix.length + 1);
    return name;
  }


  // configure an ssh connection, `c`
  var c = new Connection();

  c.on('connect', function () {
    console.log(chalk.cyan('✔  Connected to ') + options.host + '\n');
  });

  c.on('banner', function (message) {
    console.log(message);
  });

  c.on('keyboard-interactive', function (name, instructions, instructionsLang, prompts, done) {
    if (prompts) {
      for (var i = prompts.length - 1; i >= 0; i--) {
        if (prompts[i].prompt === 'Password: ') {
          console.log(chalk.cyan('Signing in as ') + options.username);
          done([options.password]);
          return;
        }
      }
    }
    done();
  });

  var finishSSH = once(function (err) {
    if (err) {
      console.log(chalk.red('Closing SSH connection after an error.'));
    }

    c.on('end', function () {
      console.log(chalk.cyan('✔  Closed SSH connection\n'));

      if (err) {
        console.log(chalk.red('✘  Failed'));
        callback(err);
      }
      else {
        console.log(chalk.green('✔  All done\n'));
        callback();
      }
    });

    c.end();
  });


  c.on('ready', function () {
    // we are logged in.
    console.log(chalk.cyan('✔  Authenticated\n'));


    var remoteDir = options.dest.charAt(0) === '/' ? options.dest : path.join(options.destPrefix, options.dest),
        remoteDirTempOld = remoteDir + '__IGDEPLOY_OLD',
        remoteDirTempNew = remoteDir + '__IGDEPLOY_NEW';

    if (options.undo) {
      // we need to undo the previous deployment by swapping the names of the directories.

      console.log(chalk.cyan('Attempting to revert previous deployment...'));

      var moves = [{
        from: remoteDirTempOld,
        to: remoteDirTempOld + '__TMP'
      }, {
        from: remoteDir,
        to: remoteDirTempOld
      }, {
        from: remoteDirTempOld + '__TMP',
        to: remoteDir
      }];

      require('async').eachSeries(moves, function (move, done) {
        var command = 'mv "' + move.from + '" "' + move.to + '"';

        console.log(chalk.cyan('Running command: '), command);

        c.exec(command, function (err) {
          done(err);
        });
      }, function (err) {
        if (!err) console.log(chalk.cyan('✔  Completed mv commands'), '\n');

        finishSSH(err);
      });
    }
    else {
      console.log(chalk.cyan('Starting SFTP session...\n'));

      c.sftp(function (err, sftp) {
        if (err) {
          finishSSH(err);
          return;
        }

        // single function for cleaning up at the end
        var finishSFTP = once(function (err) {
          if (err) console.log(chalk.red('Closing SFTP after error...'));

          sftp.on('close', function () {
            console.log(chalk.cyan('✔  Closed SFTP session'));
            finishSSH(err);
          });

          sftp.end();
        });


        // we need to deploy the folder.

        // ensure that the target dir (*__IGDEPLOY_NEW) doesn't already exist yet
        sftp.stat(remoteDirTempNew, function (err) {
          if (err && err.message !== 'No such file') {
            console.log(chalk.red('Unexpected stat error on remote server: ') + err.message);
            return finishSSH(err);
          }

          if (!err) {
            console.log(chalk.red('Something already exists at ') + remoteDirTempNew);
            console.log(chalk.red('This is probably due to a previous failed deployement. Please delete the folder manually'));
            return finishSSH(new Error('Target directory already exists.'));
          }

          // create the target directory
          mkdirpRemote(sftp, remoteDirTempNew, function (err) {
            if (err) {
              console.log(chalk.red('Failed to create remote directory'));
              finishSFTP(err);
              return;
            }

            console.log(chalk.cyan('Uploading to remote directory: ') + remoteDirTempNew);

            // now we need to actually upload everything...
            uploadDirectoryContents(sftp, options.src, remoteDirTempNew, function (err) {
              if (err) {
                finishSFTP(err);
                return;
              }

              console.log(chalk.cyan('✔  All files uploaded', '\n'));

              // delete the existing *__IGDEPLOY_OLD, if any
              console.log(chalk.cyan('Attempting to delete '), remoteDirTempOld);

              var rmCommand = 'rm -rf "' + remoteDirTempOld + '"';
              c.exec(rmCommand, function (err, stream) {
                if (err) {
                  console.log(chalk.red('Unexpected error when running command: ') + rmCommand);
                  finishSFTP(err);
                  return;
                }

                console.log(chalk.cyan('✔  Deleted'), path.basename(remoteDirTempOld), chalk.cyan('(or it did not exist)'), '\n');

                // now do 2 mv's in series, for an almost-instant deployment...
                sftp.rename(remoteDir, remoteDirTempOld, function (err) {
                  if (err) {
                    if (err.message === 'No such file') {
                      console.log(chalk.cyan('Nothing exists at '), relPath(remoteDir), chalk.cyan('(this is probably the first deployment)'));
                    }
                    else {
                      console.log(chalk.red('Error "' + err.message + '" when trying to move ') +
                        relPath(remoteDir) + ' ---> ' + relPath(remoteDirTempOld));

                      finishSFTP(err);
                      return;
                    }
                  }
                  else {
                    console.log(chalk.cyan('✔  Renamed'), relPath(remoteDir), chalk.cyan('--->'), relPath(remoteDirTempOld), '\n');
                  }

                  sftp.rename(remoteDirTempNew, remoteDir, function (err) {
                    if (err) return finishSFTP(err);

                    // finally, do a chmod command to fix the permissions issue
                    var chmodCommand = 'chmod -R g+w "' + remoteDir + '"';

                    console.log(chalk.cyan('Adding group write permission:'), chmodCommand);
                    c.exec(chmodCommand, function (err, stream) {
                      if (err) throw err;

                      console.log(chalk.cyan('✔  Updated permissions\n'));

                      finishSFTP(); // success
                    });
                  });
                });
              });
            });
          });
        });
      });
    }
  });

  // start the connection
  c.connect({
    host: options.host,
    port: options.port,
    username: options.username,
    password: options.password,
    tryKeyboard: true
  });
};
