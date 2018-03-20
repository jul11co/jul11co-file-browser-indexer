#!/usr/bin/env node

var fs = require('fs');
var path = require('path');

var async = require('async');
var fse = require('fs-extra');
var chalk = require('chalk');
var moment = require('moment');

var bytes = require('bytes');
var open = require('open');
var natsort = require('natsort');

var JsonStore = require('jul11co-wdt').JsonStore;
var JobQueue = require('jul11co-wdt').JobQueue;

var utils = require('jul11co-utils');

var comicFile = require('./lib/comic-file');
var photoFile = require('./lib/photo-file');

function printUsage() {
  console.log('Usage: file-browser <data-dir> [OPTIONS]');
  console.log('       file-browser -i, --index /path/to/files.json [data-dir] [OPTIONS]');
  console.log('');
  console.log('OPTIONS:');
  console.log('     --verbose                   : verbose');
  console.log('     --check-exists              : check for file/folder existences');
  console.log('     --no-thumbs                 : do not generate thumbnals');
  console.log('');
}

if (process.argv.indexOf('-h') >= 0 
  || process.argv.indexOf('--help') >= 0
  || process.argv.length < 3) {
  printUsage();
  process.exit();
}

var options = {};
var argv = [];
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] == '--index' || process.argv[i] == '-i') {
    options.index_file = process.argv[i+1];
    i++;
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

// console.log(options);

if (argv.length < 1 && !options.index_file) {
  printUsage();
  process.exit();
}

var data_dir = argv[0];
if (options.index_file) {
  data_dir = argv[0] || path.dirname(options.index_file);
  console.log('Index file:', options.index_file);
}
data_dir = path.resolve(data_dir);
console.log('Input directory:', data_dir);

var config = {
  thumbnals: !(options.no_thumbs)
};

var all_dirs = [];

var dirs_map = {};
var files_map = {};

var IMAGE_FILE_TYPES = ['jpg','jpeg','png','gif'];
var VIDEO_FILE_TYPES = ['mp4','webm'];
var COMIC_FILE_TYPES = ['cbz','cbr','zip'];

var file_types_map = {};
var popular_file_types = [];

var image_files = [];
var video_files = [];
var all_files = [];

if (options.listen_port) {
  options.listen_port = parseInt(options.listen_port);
  if (isNaN(options.listen_port)) {
    console.log('Invalid listern port: ' + options.listen_port);
    process.exit();
  }
}

var cache_dir = path.join(process.env['HOME'], '.jul11co', 'file-browser', 'cache');
fse.ensureDirSync(cache_dir);
var thumbs_dir = path.join(process.env['HOME'], '.jul11co', 'file-browser', 'thumbs');
fse.ensureDirSync(thumbs_dir);

var listen_port = options.listen_port || 31118;

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

  var dirlist = [];
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

var getParentDirs = function(_path) {
  var parents = [];
  var parent = path.dirname(_path);
  if (parent && parent != '' && parent != '.') {
    var _parents = getParentDirs(parent);
    if (_parents.length) parents = parents.concat(_parents);
    parents.push(parent);
  } 
  // else if (parent == '.') {
  //   parents.push(parent);
  // }
  return parents;
}

var sortItems = function(items, field, order) {
  if (order == 'desc') {
    var sorter = natsort({ desc: true });
    items.sort(function(a,b) {
      // if (a[field] > b[field]) return -1;
      // if (a[field] < b[field]) return 1;
      // return 0;
      return sorter(a[field], b[field]);
    });
  } else {
    var sorter = natsort();
    items.sort(function(a,b) {
      // if (a[field] > b[field]) return 1;
      // if (a[field] < b[field]) return -1;
      // return 0;
      return sorter(a[field], b[field]);
    });
  }
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

var startServer = function() {
  var express = require('express');
  var session = require('express-session');

  var app = express();

  // view engine setup
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.use(session({
    secret: 'jul11co-file-browser',
    resave: true,
    saveUninitialized: true
  }));
  app.use(express.static(path.join(__dirname, 'public')))

  // GET /
  // GET /?dir=...
  // GET /?images=1
  // GET /?file_type=...
  app.get('/', function(req, res) {
    var dirs = [];
    var files = [];

    var dir_path = req.query.dir ? decodeURIComponent(req.query.dir) : '.';
    var total_size = 0;

    // console.log(dir_parents);
    var parents = [];
    if (dir_path != '.') {
      var dir_parents = getParentDirs(dir_path);
      parents = dir_parents.map(function(parent_path) {
        return {path: parent_path, name: path.basename(parent_path)};
      });
    }

    if (req.query.from_dir) {
      req.query.from_dir = decodeURIComponent(req.query.from_dir);
    }

    // console.log('Path:', dir_path);
    if (req.query.images) {
      if (req.query.from_dir) {
        var matched_image_files = image_files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_image_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = image_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    } 
    else if (req.query.videos) {
      if (req.query.from_dir) {
        var matched_video_files = video_files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_video_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = video_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    }
    else if (req.query.files) {
      if (req.query.from_dir) {
        var matched_files = all_files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = all_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    }
    else if (req.query.file_type) {
      if (req.query.from_dir) {
        var matched_files = file_types_map[req.query.file_type].files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = file_types_map[req.query.file_type].files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    }
    else if (dir_path && dirs_map[dir_path]) {
      var dir_entry = dirs_map[dir_path];
      dirs = dir_entry.subdirs.map(function(dir_relpath) {
        return {
          name: dirs_map[dir_relpath].name,
          path: dirs_map[dir_relpath].path,
          size: dirs_map[dir_relpath].size,
          atime: dirs_map[dir_relpath].atime,
          mtime: dirs_map[dir_relpath].mtime,
          ctime: dirs_map[dir_relpath].ctime,
          subdirs_count: dirs_map[dir_relpath].subdirs.length,
          files_count: dirs_map[dir_relpath].files.length
        }
      });
      files = dir_entry.files.map(function(file_relpath) {
        return files_map[file_relpath];
      });
    }

    var dir_file_types = [];
    var dir_file_types_map = {};
    
    if (req.query.from_dir) {
      files.forEach(function(file) {
        if (file.type && file.type != '') {
          if (!dir_file_types_map[file.type]) {
            dir_file_types_map[file.type] = {};
            dir_file_types_map[file.type].count = 0;
            dir_file_types_map[file.type].files = [];
          }
          dir_file_types_map[file.type].count++;
        }
      });
      for(var file_type in dir_file_types_map) {
        dir_file_types.push({
          type: file_type, 
          count: dir_file_types_map[file_type].count
        });
      }
      dir_file_types.sort(function(a,b) {
        if (a.count>b.count) return -1;
        if (a.count<b.count) return 1;
        return 0;
      });
    }

    dirs.forEach(function(dir){ total_size += dir.size || 0; });
    files.forEach(function(file) { total_size += file.size || 0; })

    var query = Object.assign({}, req.query);

    // console.log('Dirs:', dirs.length);
    // console.log('Files:', files.length);
    if (query.sort == 'size') {
      sortItems(dirs, 'size', query.order || 'desc');
      sortItems(files, 'size', query.order || 'desc');
      if (req.session) {
        req.session.sort = query.sort;
        req.session.order = query.order || 'desc';
      }
    } else if (query.sort == 'mtime') {
      sortItems(dirs, 'mtime', query.order || 'desc');
      sortItems(files, 'mtime', query.order || 'desc');
      if (req.session) {
        req.session.sort = query.sort;
        req.session.order = query.order || 'desc';
      }
    } else if (query.sort == 'type') {
      sortItems(files, 'type', query.order || 'asc');
      if (req.session) {
        req.session.sort = query.sort;
        req.session.order = query.order || 'asc';
      }
    } else if (query.sort != 'name' && req.session.sort) {
      // console.log(req.session.sort, req.session.order);
      sortItems(dirs, req.session.sort, query.order || req.session.order);
      sortItems(files, req.session.sort, query.order || req.session.order);
      query.sort = req.session.sort;
      query.order = query.order || req.session.order;
    } else {
      sortItems(dirs, 'name', query.order || 'asc');
      sortItems(files, 'name', query.order || 'asc');
      if (req.session) {
        delete req.session.sort;
        delete req.session.order;
      }
    }

    query.limit = query.limit ? parseInt(query.limit) : 1000;
    query.skip = query.skip ? parseInt(query.skip) : 0;
    
    var start_index = Math.min(query.skip, files.length);
    var end_index = Math.min(query.skip + query.limit, files.length);
    var files_length = files.length;
    files = files.slice(start_index, end_index);

    if (options.check_exists) {
      var exists_map = {};
      dirs.forEach(function(dir) {
        dir.missing = !checkDirExists(path.join(data_dir, dir.path), exists_map);
      });
      files.forEach(function(file) {
        file.missing = !checkFileExists(path.join(data_dir, file.relpath), exists_map);
      });
    }

    res.render('file-browser', {
      config: config,
      query: query,
      parents: parents,
      dir_path: dir_path,
      dir_name: path.basename(dir_path),
      dir_file_types: dir_file_types,
      total_size: total_size,
      dirs: dirs,
      files: files,
      files_length: files_length,
      files_count: all_files.length,
      images_count: image_files.length,
      videos_count: video_files.length,
      popular_file_types: popular_file_types,
      path: path,
      bytes: bytes,
      moment: moment,
      ellipsisMiddle: ellipsisMiddle
    });
  });

  app.get('/reload_index', function(req, res) {
    reloadIndex(function(err) {
      if (err) return res.status(500).send({error: err.message});
      res.redirect('/');
    });
  });

  // GET /open?path=...
  app.get('/open', function(req, res) {
    var fpath = path.join(data_dir, decodeURIComponent(req.query.path));
    open(fpath);
    return res.json({ok: 1});
  });

  var updateParentDirSize = function(frelpath) {
    var parent_dirs = getParentDirs(frelpath);
    if (parent_dirs && parent_dirs.length) {
      var dir_size_map = {};
      parent_dirs.forEach(function(parent_dir) {
        if (dirs_map[parent_dir]) {
          dirs_map[parent_dir].size = getDirSize(parent_dir, dir_size_map);
        }
      });
    }
  }

  // POST /delete/path=...
  app.post('/delete', function(req, res) {
    var frelpath = decodeURIComponent(req.query.path);
    var fpath = path.join(data_dir, frelpath);

    console.log('Delete path:', fpath);
    if (utils.fileExists(fpath)) {
      console.log('Delete file:', fpath);
      fse.remove(fpath, function(err) {
        if (err) {
          console.log(err);
          return res.status(500).send({error: err.message});
        }
        // update file map & parent folder sizes
        if (files_map[frelpath]) {
          var parent_path = path.dirname(frelpath);
          if (dirs_map[parent_path]) {
            dirs_map[parent_path].files = dirs_map[parent_path].files.filter(function(file_relpath) {
              return file_relpath != frelpath;
            });
          }
          updateParentDirSize(frelpath);
        }
        
        res.json({deleted: 1, type: 'file', abs_path: fpath});
      });
    } else if (utils.directoryExists(fpath)) {
      console.log('Delete folder:', fpath);
      fse.remove(fpath, function(err) {
        if (err) {
          console.log(err);
          return res.status(500).send({error: err.message});
        }
        // update file map & parent folder sizes
        if (dirs_map[frelpath]) {
          delete dirs_map[frelpath];
          var parent_path = path.dirname(frelpath);
          if (dirs_map[parent_path]) {
            dirs_map[parent_path].subdirs = dirs_map[parent_path].subdirs.filter(function(file_relpath) {
              return file_relpath != frelpath;
            });
          }
          updateParentDirSize(frelpath);
        }
        res.json({deleted: 1, type: 'folder', abs_path: fpath});
      });
    } else {
      return res.status(400).send({error: 'Path not exist'});
    }
  });

  var getFile = function(req, res) {
    var filepath = path.join(data_dir, decodeURIComponent(req.query.path));
    return res.sendFile(filepath);
  }

  // GET /file?path=...
  app.get('/file', getFile);
  app.get('/files/:filename', getFile);

  var stat_map = {};

  // GET /video?path=...
  app.get('/video', function(req, res) {
    var filepath = path.join(data_dir, decodeURIComponent(req.query.path));
    if (!stat_map[filepath]) {
      stat_map[filepath] = fs.statSync(filepath);
    }
    var stat = stat_map[filepath];
    var fileSize = stat.size
    var range = req.headers.range

    if (range) {
      var parts = range.replace(/bytes=/, "").split("-")
      var start = parseInt(parts[0], 10)
      var end = parts[1]
        ? parseInt(parts[1], 10)
        : fileSize-1

      var chunksize = (end-start)+1
      var file = fs.createReadStream(filepath, {start, end})
      var head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      }

      if (path.extname(filepath) == '.webm') {
        head['Content-Type'] = 'video/webm';
      }

      res.writeHead(206, head)
      file.pipe(res)
    } else {
      var head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      }
      if (path.extname(filepath) == '.webm') {
        head['Content-Type'] = 'video/webm';
      }
      res.writeHead(200, head)
      fs.createReadStream(filepath).pipe(res)
    }
  });

  var comic_cache = {};

  // GET /comic?path=...
  // GET /comic?path=...&info=true
  // GET /comic?path=...&page=NUM
  app.get('/comic', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    var filepath = path.join(data_dir, decodeURIComponent(req.query.path));
    var filepath_hash = utils.md5Hash(filepath);
    
    if (req.query.page) {
      var page_num = parseInt(req.query.page);
      if (isNaN(page_num)) return res.status(400).send({error: 'Invalid page number'});

      var extractPage = function(page_file_name) {
        comicFile.extractPage(filepath, page_file_name, {
          targetDir: path.join(cache_dir, filepath_hash[0], filepath_hash[1]+filepath_hash[2], filepath_hash)
        }, function(err, page_file_path) {
          if (err) return res.status(500).send({error: 'Extract page failed! ' + err.message});
          if (!page_file_path) return res.status(500).send({error: 'Cannot extract page!'});

          res.sendFile(page_file_path);
        });
      }

      if (comic_cache[filepath_hash] && comic_cache[filepath_hash]['pages'] 
        && comic_cache[filepath_hash]['pages'].length>page_num) {
        return extractPage(comic_cache[filepath_hash]['pages'][page_num]);
      } else {
        comicFile.getInfo(filepath, function(err, result) {
          if (err) return res.status(500).send({error: 'Get file info failed! ' + err.message});
          if (!result) return res.status(500).send({error: 'Cannot get file info!'});

          comic_cache[filepath_hash] = result;
          return extractPage(result['pages'][page_num]);
        });
      }
    } else {
      if (comic_cache[filepath_hash]) return res.json(comic_cache[filepath_hash]);

      comicFile.getInfo(filepath, function(err, result) {
        if (err) return res.status(500).send({error: 'Get file info failed! ' + err.message});
        if (!result) return res.status(500).send({error: 'Cannot get file info!'});
        
        // console.log(result);

        comic_cache[filepath_hash] = result;
        return res.json(result);
      });
    }
  });

  // GET /thumb?path=...
  app.get('/thumb', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    var filepath = path.join(data_dir, decodeURIComponent(req.query.path));
    var filepath_hash = utils.md5Hash(filepath);
    
    var thumb_filepath = path.join(thumbs_dir, filepath_hash[0], 
      filepath_hash[1]+filepath_hash[2], filepath_hash);

    fse.ensureDirSync(path.dirname(thumb_filepath));

    if (utils.fileExists(thumb_filepath)) {
      return res.sendFile(thumb_filepath);
    }

    var fileext = path.extname(filepath);
    if (fileext.indexOf('.') == 0) fileext = fileext.replace('.','');

    if (COMIC_FILE_TYPES.indexOf(fileext) != -1) {
      comicFile.generateCoverImage(filepath, thumb_filepath, {
        tmpdir: path.join(cache_dir, filepath_hash[0], filepath_hash[1]+filepath_hash[2], filepath_hash),
        cover_width: 60,
        cover_height: 60
      }, function(err, result) {
        if (err) return res.status(500).send({error: 'Generate thumb failed! ' + err.message});
        if (!result || !result.cover_image) return res.status(500).send({error: 'Cannot generate thumb!'});

        return res.sendFile(thumb_filepath);
      });
    } else if (IMAGE_FILE_TYPES.indexOf(fileext) != -1) {
      photoFile.generateThumbImage(filepath, thumb_filepath, {
        thumb_width: 60,
        thumb_height: 60
      }, function(err) {
        if (err) return res.status(500).send({error: 'Generate thumb failed! ' + err.message});

        return res.sendFile(thumb_filepath);
      });
    } else {
      return res.status(404).send();
    }
  });

  var startListen = function() {
    app.listen(listen_port, function () {
      console.log('Listening on http://localhost:'+listen_port);
      if (!options.no_open) open('http://localhost:'+listen_port);
    }).on('error', function(err) {
    if (err.code == 'EADDRINUSE') {
        setTimeout(function() {
          listen_port = listen_port + 1;
          startListen();
        });
      } else {
        console.log(err);
      }
    });
  }

  startListen();
}

var addDirToMap = function(dir) {
  var dir_path = dir.path;
  var dir_relpath = (dir_path == data_dir) ? '.' : path.relative(data_dir, dir_path);

  // console.log(dir_relpath);

  if (!dirs_map[dir_relpath]) {
    dirs_map[dir_relpath] = {};
    dirs_map[dir_relpath].name = path.basename(dir_relpath);
    dirs_map[dir_relpath].path = dir_relpath;
    dirs_map[dir_relpath].size = 0;
    dirs_map[dir_relpath].files = [];
    dirs_map[dir_relpath].subdirs = [];
  }
  if (dir.atime) dirs_map[dir_relpath].atime = dir.atime;
  if (dir.mtime) dirs_map[dir_relpath].mtime = dir.mtime;
  if (dir.ctime) dirs_map[dir_relpath].ctime = dir.ctime;

  if (dir_path != data_dir) {
    var parent_dir_entry = addDirToMap({ path: path.dirname(dir_path) });
    if (parent_dir_entry.subdirs.indexOf(dir_relpath) == -1) {
      parent_dir_entry.subdirs.push(dir_relpath);
    }
  }

  return dirs_map[dir_relpath];
}

var getDirSize = function(dir_relpath, dir_size_map) {
  // console.log('getDirSize:', dir_relpath);

  dir_size_map = dir_size_map || {};
  
  if (!dir_relpath) return 0;
  if (!dirs_map[dir_relpath]) return 0;
  if (dir_size_map[dir_relpath]) return dir_size_map[dir_relpath];

  if (dirs_map[dir_relpath].subdirs.length == 0) {
    dir_size_map[dir_relpath] = dirs_map[dir_relpath].size;
    return dirs_map[dir_relpath].size;
  }

  var dir_size = dirs_map[dir_relpath].size; // size of files (if any)
  dirs_map[dir_relpath].subdirs.forEach(function(subdir_relpath) {
    dir_size += getDirSize(subdir_relpath, dir_size_map);
  });

  dir_size_map[dir_relpath] = dir_size;
  return dir_size;
}

var createDirsIndex = function(dirs) {
  console.log('Dirs:', dirs.length);

  dirs.forEach(function(dir) {
    addDirToMap(dir);
  });
}

var recalculateDirsSize = function() {
  // calculate directory size
  for(var dir_relpath in dirs_map) {
    dirs_map[dir_relpath].size = getDirSize(dir_relpath);
  }
}

var createFilesIndex = function(files) {

  console.log('Files:', files.length);

  var total_files_size = 0;
  files.forEach(function(file) { 
    total_files_size += file.size;
  });
  console.log('Size:', bytes(total_files_size));

  files.forEach(function(file) {

    file.relpath = path.relative(data_dir, file.path);
    file.type = (file.type) ? file.type.toLowerCase() : '';

    files_map[file.relpath] = file;

    if (IMAGE_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_image = true;
      image_files.push(file.relpath);
    } else if (VIDEO_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_video = true;
      video_files.push(file.relpath);
    } else if (COMIC_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_comic = true;
    }
    all_files.push(file.relpath);

    if (file.type && file.type != '') {
      if (!file_types_map[file.type]) {
        file_types_map[file.type] = {};
        file_types_map[file.type].count = 0;
        file_types_map[file.type].files = [];
      }
      file_types_map[file.type].count++;
      file_types_map[file.type].files.push(file.relpath);
    }
    
    var parent_dir_entry = addDirToMap({ path: path.dirname(file.path) });
    if (parent_dir_entry.files.indexOf(file.relpath) == -1) {
      parent_dir_entry.size += file.size;
      parent_dir_entry.files.push(file.relpath);
    }

    // console.log('File:', file.relpath);
    // console.log('Dir:', dir_relpath);
  });

  // get popular file types
  var file_types = [];
  for(var file_type in file_types_map) {
    file_types.push({type: file_type, count: file_types_map[file_type].count});
  }
  file_types.sort(function(a,b) {
    if (a.count>b.count) return -1;
    if (a.count<b.count) return 1;
    return 0;
  });
  if (file_types.length > 10) popular_file_types = file_types.slice(0, 10);
  else popular_file_types = file_types.slice(0);
}

var loadIndex = function(callback) {

  // var supported_file_types = ['mp4','mkv','avi','wmv','png','gif','jpg','jpeg','txt'];

  if (options.index_file) {
    if (!utils.fileExists(options.index_file)) {
      console.log('File not found:', options.index_file);
      return callback(new Error('File not found: ' + options.index_file));
    }

    var tmp_files_map = utils.loadFromJsonFile(options.index_file);
    var tmp_dirs_map = {};
    var dirs = [];
    var files = [];

    for (var file_relpath in tmp_files_map) {
      // console.log('File:', file_relpath);

      var file_info = tmp_files_map[file_relpath];

      file_info.path = path.join(data_dir, file_relpath);

      file_info.name = file_info.filename || file_info.name || path.basename(file_relpath);
      file_info.size = file_info.filesize || file_info.size || 0;
      file_info.type = file_info.filetype || file_info.type || '';

      files.push(file_info);

      var dir_path = path.dirname(file_info.path);
      if (!tmp_dirs_map[dir_path]) {
        // console.log('Dir:', dir_path);
        tmp_dirs_map[dir_path] = {
          path: dir_path
        }
        dirs.push(tmp_dirs_map[dir_path]);
      }
    }

    // files = files.filter(function(file) { 
    //   return supported_file_types.indexOf(file.type) != -1;
    // });

    createDirsIndex(dirs);
    createFilesIndex(files);
    recalculateDirsSize();

    return callback();
  } else {
    var scan_opts = {recursive: true};
    // scan_opts.file_types = supported_file_types;

    console.log('Scanning input dir...');
    scanDir(data_dir, scan_opts, function(err, files, dirs) {
      if (err) {
        console.log('Scan dir error!', data_dir);
        console.log(err);
        return callback(err);
      }
      
      // files = files.filter(function(file) { 
      //   return supported_file_types.indexOf(file.type) != -1;
      // });

      createDirsIndex(dirs);
      createFilesIndex(files);
      recalculateDirsSize();

      return callback();
    });
  }
}

var reloadIndex = function(callback) {
  all_dirs = [];

  dirs_map = {};
  files_map = {};

  file_types_map = {};
  popular_file_types = [];

  image_files = [];
  video_files = [];
  all_files = [];

  loadIndex(callback);
}

// Load index & start server in the first time
loadIndex(function(err) {
  if (err) {
    process.exit();
  }
  startServer();
});
