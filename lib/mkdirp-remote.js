'use strict';

var path = require('path');

module.exports = function (sftp, dir, done) {
  var pathParts = dir.split('/');
  if (pathParts[0] !== '') throw new Error('bug?');
  pathParts.shift();

  var currentDir = '/';

  function next() {
    var nextPart = pathParts.shift();

    if (nextPart) {
      currentDir = path.resolve(currentDir, nextPart);

      sftp.stat(currentDir, function (err, stats) {
        if (err) {
          sftp.mkdir(currentDir, {mode: parseInt('0775', 8)}, function (err) {
            if (err) return done(err);
            next();
          });
        }
        else if (stats.isDirectory()) {
          next();
        }
        else {
          done(new Error('Failed to create directory because non-directory already present'));
        }
      });
    }
    else {
      // no more dirs to create.
      done();
    }
  }

  // start recursive creation
  next();
};
