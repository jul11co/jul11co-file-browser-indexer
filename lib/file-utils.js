// lib/file-utils.js

var path = require('path');
var fs = require('fs');

var async = require('async');
var fse = require('fs-extra');

var utils = require('jul11co-utils');

var getFileStatsSync = function(file_path) {
  var stats = undefined;
  try {
    stats = fs.lstatSync(file_path);
  } catch(e) {
    console.error(e);
  }
  return stats;
}

var scanDir = function(dir_path, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  // console.log('Directory:', utils.ellipsisMiddle(dir_path));

  var dirlist = [];
  var filelist = [];

  fs.readdir(dir_path, function(err, files) {
    if (err) return callback(err);

    async.eachSeries(files, function(file, cb) {
      
      // if (file.indexOf('.') == 0) {
      //   return cb();
      // }

      if (file == '.DS_Store') return cb();
      if (file.indexOf('._') == 0) return cb();

      var file_path = path.join(dir_path, file);

      var stats = undefined;
      try {
        stats = fs.lstatSync(file_path);
      } catch(e) {
        console.log(e);
        return cb();
      }
      if (!stats) return cb();
      
      // console.log(stats);
      if (stats.isFile()) {

        if (options.min_file_size && stats['size'] < min_file_size) return cb();

        var file_type = path.extname(file).replace('.','').toLowerCase();
        if (options.file_types && options.file_types.indexOf(file_type) == -1) return cb();

        var file_info = {
          path: file_path,
          name: file,
          type: file_type,
          size: stats['size'],
          atime: stats['atime'],
          mtime: stats['mtime'],
          ctime: stats['ctime']
        };

        filelist.push(file_info);
        cb();
      } else if (stats.isDirectory() && options.recursive) {

        dirlist.push({
          path: file_path,
          name: file,
          atime: stats['atime'],
          mtime: stats['mtime'],
          ctime: stats['ctime']
        });

        scanDir(file_path, options, function(err, files, dirs) {
          if (err) return cb(err);

          filelist = filelist.concat(files);
          dirlist = dirlist.concat(dirs);

          cb();
        });
      } else {
        cb();
      }
    }, function(err) {
      callback(err, filelist, dirlist);
    });
  });
}

var checkDirExists = function(dir_path, exists_map) {
  exists_map = exists_map || {};

  if (dir_path == '/') return true;
  
  if (typeof exists_map[dir_path] != 'undefined') {
    return exists_map[dir_path];
  }
  
  if (!checkDirExists(path.dirname(dir_path), exists_map)) {
    exists_map[dir_path] = false;
    return false;
  }
  
  var exists = utils.directoryExists(dir_path);
  exists_map[dir_path] = exists;
  
  return exists;
}

var checkFileExists = function(file_path, exists_map) {
  exists_map = exists_map || {};
  
  if (!checkDirExists(path.dirname(file_path), exists_map)) {
    return false;
  }
  
  return utils.fileExists(file_path);
}

exports.getFileStatsSync = getFileStatsSync;
exports.scanDir = scanDir;
exports.checkDirExists = checkDirExists;
exports.checkFileExists = checkFileExists;

