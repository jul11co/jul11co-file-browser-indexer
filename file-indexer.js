#!/usr/bin/env node

var async = require('async');
var fs = require('fs');
var path = require('path');

var fse = require('fs-extra');
var chalk = require('chalk');
var bytes = require('bytes');
var md5file = require('md5-file');
var log = require('single-line-log').stdout;

var utils = require('./lib/utils');

function printUsage() {
  console.log('Usage: file-indexer [OPTIONS] <input-dir> [output-dir]');
  console.log('');
  console.log('OPTIONS:');
  console.log('');
  console.log('  --md5                           : calculate MD5 (slower)');
  console.log('');
  console.log('  --check-duplicates              : check for duplicates (require --md5)');
  console.log('');
  console.log('  --recursive           -r        : scan input directory recursively (default: none)');
  console.log('  --min-size=<NUMBER>[GB,MB,KB]   : scan file with minimum size (default: 10KB)');
  console.log('');
  console.log('  --ignore-path=<PATH>            : ignore a path');
  console.log('  --only-path=<PATH>              : only a path');
  console.log('');
}

if (process.argv.length < 3 || process.argv.indexOf('--help') >= 0) {
  printUsage();
  process.exit();
}

var argv = [];
var options = {};
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] == '--ignore-errors') {
    options.ignore_errors = true;
  } else if (process.argv[i] == '--stop-if-errors' || process.argv[i] == '-e') {
    options.ignore_errors = false;
  } else if (process.argv[i] == '--recursive' || process.argv[i] == '-r') {
    options.recursive = true;
  } else if (process.argv[i].indexOf('--') == 0) {
    var arg = process.argv[i];
    if (arg.indexOf("=") > 0) {
      var arg_kv = arg.split('=');
      arg = arg_kv[0];
      arg = arg.replace('--','');
      arg = utils.replaceAll(arg, '-', '_');
      options[arg] = arg_kv[1];
    } else {
      arg = arg.replace('--','');
      arg = utils.replaceAll(arg, '-', '_');
      options[arg] = true;
    }
  } else {
    argv.push(process.argv[i]);
  }
}

if (typeof options.ignore_errors == 'undefined') {
  options.ignore_errors = true;
}

var min_file_size = 10*1024; // 10KB
if (options.min_size) {
  if (options.min_size.indexOf('KB')) {
    var min_size = options.min_size.replace('KB','');
    min_size = parseInt(min_size);
    if (isNaN(min_size)) {
      console.log('Invalid min size parameter');
      process.exit();
    }
    min_file_size = min_size*1024;
  } else if (options.min_size.indexOf('MB')) {
    var min_size = options.min_size.replace('MB','');
    min_size = parseInt(min_size);
    if (isNaN(min_size)) {
      console.log('Invalid min size parameter');
      process.exit();
    }
    min_file_size = min_size*1024*1024;
  } else if (options.min_size.indexOf('GB')) {
    var min_size = options.min_size.replace('GB','');
    min_size = parseInt(min_size);
    if (isNaN(min_size)) {
      console.log('Invalid min size parameter');
      process.exit();
    }
    min_file_size = min_size*1024*1024*1024;
  }
  console.log('Min. file size:', bytes(min_file_size));
}

function ellipsisMiddle(str, max_length, first_part, last_part) {
  if (!max_length) max_length = 140;
  if (!first_part) first_part = 40;
  if (!last_part) last_part = 20;
  if (str.length > max_length) {
    return str.substr(0, first_part) + '...' + str.substr(str.length-last_part, str.length);
  }
  return str;
}

var scanDir = function(dir_path, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  // console.log(chalk.magenta('Directory:'), ellipsisMiddle(dir_path));
  log(chalk.magenta('Directory:'), ellipsisMiddle(path.relative(options.input_dir, dir_path)));

  var dirlist = [];
  dirlist.push(dir_path);

  var filelist = [];
  fs.readdir(dir_path, function(err, files) {
    if (err) return callback(err);

    async.eachSeries(files, function(file, cb) {
      
      // if (file.indexOf('.') == 0) {
      //   return cb();
      // }

      if (file == '.DS_Store') return cb();

      var file_path = path.join(dir_path, file);

      var stats = undefined;
      try {
        stats = fs.lstatSync(file_path);
      } catch(e) {
        console.log(e.message);
        return cb();
      }
      if (!stats) return cb();
      
      // console.log(stats);
      if (stats.isFile()) {
          if (min_file_size && stats['size'] < min_file_size) return cb();

          var file_info = {
            path: file_path,
            name: file,
            type: path.extname(file).replace('.','').toLowerCase(),
            mode: stats['mode'],
            size: stats['size'],
            atime: stats['atime'],
            mtime: stats['mtime'],
            ctime: stats['ctime'],
          };

          filelist.push(file_info);
          cb();
      } else if (stats.isDirectory() && options.recursive) {
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

////

var INPUT_DIR = argv[0];
options.input_dir = path.resolve(INPUT_DIR);
console.log('Input dir: ' + INPUT_DIR);

var OUTPUT_DIR = argv[1] || INPUT_DIR;
options.output_dir = path.resolve(OUTPUT_DIR);
if (OUTPUT_DIR != INPUT_DIR) {
  console.log('Output dir: ' + OUTPUT_DIR);
  fse.ensureDirSync(OUTPUT_DIR);
}

var files_map = {};
if (utils.fileExists(path.join(OUTPUT_DIR, 'files.json'))) {
  files_map = utils.loadFromJsonFile(path.join(OUTPUT_DIR, 'files.json'));
}
var md5_map = {};
if (options.md5 && utils.fileExists(path.join(OUTPUT_DIR, 'md5.json'))) {
  md5_map = utils.loadFromJsonFile(path.join(OUTPUT_DIR, 'md5.json'));
}

console.log('Scanning files...');
scanDir(INPUT_DIR, options, function(err, files, dirs) {
  if (err) {
    console.log(err.message);
    return;
  }

  log('\r');
  console.log(chalk.blue('Files found:'), files.length);

  var errors = [];
  var processed = [];
  var new_files = [];

  var duplicates = [];
  var duplicates_map = {};

  var total_size = 0;

  var total = files.length;
  var count = 0;

  var md5_map_changed = false;

  async.eachSeries(files, function(file, cb) {
    count++;
    
    total_size += file.size;

    var file_abspath = file.path;
    file.path = path.relative(INPUT_DIR, file.path);

    // console.log(chalk.blue('Progress:'), count + '/' + total);
    // process.stdout.write('' + count + '/' + total + '\r');
    // console.log(chalk.blue('File:'), ellipsisMiddle(file.path), chalk.magenta(bytes(file.size)));
    log(chalk.blue('File:'), count + '/' + total, ellipsisMiddle(file.path), chalk.magenta(bytes(file.size)));

    var file_info = {
      name: file.name,
      type: file.type,
      size: file.size,
      mode: file.mode,
      atime: file.atime,
      mtime: file.mtime,
      ctime: file.ctime
    };
    if (options.md5) {
      if (files_map[file.path] && files_map[file.path].md5) {
        md5_map[file.path] = files_map[file.path].md5;
      } else if (!md5_map[file.path]) {
        file_info.md5 = md5file.sync(file_abspath);
        md5_map[file.path] = file_info.md5;
      } else {
        file_info.md5 = md5_map[file.path];
      }
      console.log('MD5:', file_info.md5);
    }

    if (!files_map[file.path]) {
      log('\r');
      log(chalk.green('New file:'), ellipsisMiddle(file.path), chalk.magenta(bytes(file.size)));
      files_map[file.path] = file_info;
      new_files.push(file.path);
    } else {
      files_map[file.path] = Object.assign(files_map[file.path], file_info);
    }

    if (file_info.md5 && options.check_duplicates) {
      if (duplicates_map[file_info.md5]) {
        duplicates_map[file_info.md5].push(file.path);
      } else {
        duplicates_map[file_info.md5] = [];
        duplicates_map[file_info.md5].push(file.path);
      }
    }

    processed.push(file.path);

    process.nextTick(cb);
  }, function(err) {
    if (err) {
      console.log(chalk.red('Error:'));
      console.log(err.message);
    }

    log('\r');
    console.log('---');
    utils.saveToJsonFile(files_map, path.join(OUTPUT_DIR, 'files.json'));
    if (options.md5) {
      utils.saveToJsonFile(md5_map, path.join(OUTPUT_DIR, 'md5.json'));
    }

    console.log(dirs.length + ' directories, ' + files.length + ' file' + ((files.length != 1) ? 's.': '.'));
    console.log(processed.length + ' processed.');

    console.log(bytes(total_size) + ' total.');

    if (new_files.length) {
      console.log(chalk.green(new_files.length + ' new file(s).'));
    }

    if (options.md5 && options.check_duplicates) {
      duplicates = [];
      
      for (var duplicate in duplicates_map) {
        if (duplicates_map[duplicate].length > 1) {
          duplicates.push({md5: duplicate, files: duplicates_map[duplicate]});
        }
      }

      if (duplicates.length) {
        console.log(duplicates.length + ' duplicate' + ((duplicates.length != 1)?'s.':'.'));
        console.log('---');
        duplicates.forEach(function(duplicate) {
          console.log('  MD5: ' + chalk.yellow(duplicate.md5) + ' (' + duplicate.files.length + '):');
          duplicate.files.forEach(function(file_path) {
            console.log('      - ' + file_path + ' ' + chalk.magenta(bytes(files_map[file_path].size)));
          });
        });
      }
    }

    console.log('Done.');
  });
});