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
var pdfFile = require('./lib/pdf-file');

var FileStore = require('./lib/file-store');
var fileUtils = require('./lib/file-utils');

var package = require('./package.json');

function printUsage() {
  console.log('Usage: file-browser <data-dir> [OPTIONS]');
  console.log('       file-browser -i, --index /path/to/files.json [data-dir] [OPTIONS]');
  console.log('');
  console.log('OPTIONS:');
  console.log('     --verbose                   : verbose');
  // console.log('     --check-exists              : check for file/folder existences');
  console.log('');
  console.log('     --no-thumbs                 : do not generate thumbnails');
  console.log('     --pdf-thumbs                : generate thumbnails for PDF files');
  console.log('     --zip-thumbs                : generate thumbnails for ZIP files');
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
  thumbnails: !(options.no_thumbs),
  pdf_thumbs: options.pdf_thumbs,
  zip_thumbs: options.zip_thumbs
};

var comic_extract_queue = new JobQueue();
var pdf_thumbnail_queue = new JobQueue();

var filestore = new FileStore();

var IMAGE_FILE_TYPES = ['jpg','jpeg','png','gif'];
var VIDEO_FILE_TYPES = ['mp4','webm'];
var COMIC_FILE_TYPES = ['cbz','cbr','zip'];
var ARCHIVE_FILE_TYPES = ['zip','rar','7z'];
var PDF_FILE_TYPES = ['pdf'];

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

var decodeQueryPath = function(query_path) {
  var decoded_path = query_path;
  try {
    decoded_path = decodeURIComponent(query_path);
  } catch (e) {
    if (e instanceof URIError) {
      decoded_path = query_path;
    } else {
      return null;
    }
  }
  return decoded_path;
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

  app.get('/info', function(req, res) {
    return res.json({
      name: 'File Browser',
      version: package.version,
      data_dir: data_dir
    });
  });

  // GET /
  // GET /?dir=...
  // GET /?images=1
  // GET /?file_type=...
  app.get('/', function(req, res) {
    var dirs = [];
    var files = [];

    var dir_path = req.query.dir ? decodeQueryPath(req.query.dir) : filestore.getRootPath();
    var total_size = 0;

    // console.log(dir_parents);
    var parents = [];
    if (!filestore.isRootPath(dir_path)) {
      var dir_parents = filestore.getParentDirs(dir_path);
      parents = dir_parents.map(function(parent_path) {
        return { path: parent_path, name: path.basename(parent_path) };
      });
    }

    if (req.query.from_dir) {
      req.query.from_dir = decodeQueryPath(req.query.from_dir);
    }

    // console.log('Path:', dir_path);
    if (req.query.images) {
      if (req.query.from_dir) {
        files = filestore.getImageFilesFromDir(req.query.from_dir);
      } else {
        files = filestore.getImageFiles();
      }
    } 
    else if (req.query.videos) {
      if (req.query.from_dir) {
        files = filestore.getVideoFilesFromDir(req.query.from_dir);
      } else {
        files = filestore.getVideoFiles();
      }
    }
    else if (req.query.files) {
      if (req.query.from_dir) {
        files = filestore.getFilesFromDir(req.query.from_dir);
      } else {
        files = filestore.getAllFiles();
      }
    }
    else if (req.query.file_type) {
      if (req.query.from_dir) {
        files = filestore.getMatchedFilesFromDir(req.query.from_dir, req.query.file_type);
      } else {
        files = filestore.getMatchedFiles(req.query.file_type);
      }
    }
    else if (dir_path) {
      dirs = filestore.getSubdirs(dir_path);
      files = filestore.getSubfiles(dir_path);
    }

    if (req.query.q) {
      dirs = filestore.searchDirs(req.query.q);
      files = filestore.searchFiles(req.query.q);
    }

    var dir_file_types = [];
    if (req.query.from_dir) {
      // dir_file_types = filestore.getFileTypes(files);
      dir_file_types = filestore.getFileTypesFromDir(req.query.from_dir);
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

    if (query.listview) {
      if (req.session) req.session.listview = query.listview;
    } else if (req.session) {
      query.listview = req.session.listview;
    }

    query.limit = query.limit ? parseInt(query.limit) : 100;
    query.skip = query.skip ? parseInt(query.skip) : 0;
    
    var dirs_length = dirs.length;
    var files_length = files.length;
    var items_length = dirs_length + files_length;

    var start_index = Math.min(query.skip, items_length);
    var end_index = Math.min(query.skip + query.limit, items_length);

    if (start_index < dirs.length && end_index < dirs.length) {
      dirs = dirs.slice(start_index, end_index);
      files = [];
    } else if (start_index < dirs.length && end_index >= dirs.length) {
      dirs = dirs.slice(start_index); // till end
      files = files.slice(0, end_index-dirs.length);
    } else { // start_index >= dirs.length
      files = files.slice(start_index-dirs.length, end_index-dirs.length);
      dirs = [];
    }

    // if (options.check_exists) {
      var exists_map = {};
      dirs.forEach(function(dir) {
        dir.missing = !fileUtils.checkDirExists(path.join(data_dir, dir.path), exists_map);
      });
      files.forEach(function(file) {
        file.missing = !fileUtils.checkFileExists(path.join(data_dir, file.relpath), exists_map);
      });
    // }

    res.render('file-browser', {
      config: config,
      query: query,
      // nav
      parents: parents,
      dir_path: dir_path,
      dir_name: path.basename(dir_path),
      dir_file_types: dir_file_types,
      total_size: total_size,
      items_length: items_length,
      dirs: dirs,
      dirs_length: dirs_length,
      files: files,
      files_length: files_length,
      // global
      files_count: filestore.getFilesCount(),
      images_count: filestore.getImageFilesCount(),
      videos_count: filestore.getVideoFilesCount(),
      popular_file_types: filestore.getPopularFileTypes(),
      // helpers
      path: path,
      bytes: bytes,
      moment: moment,
      utils: utils
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
    var fpath = path.join(data_dir, decodeQueryPath(req.query.path));
    open(fpath);
    return res.json({ok: 1});
  });

  // POST /delete?path=...
  app.post('/delete', function(req, res) {
    var frelpath = decodeQueryPath(req.query.path);
    var fpath = path.join(data_dir, frelpath);

    filestore.deletePath(frelpath, data_dir, function(err, result) {
      if (err) {
        console.log(err);
        return res.status(500).send({error: err.message});
      }

      res.json(result || {deleted: 1, abs_path: fpath});
    });
  });

  var getFile = function(req, res) {
    var filepath = path.join(data_dir, decodeQueryPath(req.query.path));
    return res.sendFile(filepath);
  }

  // GET /file?path=...
  app.get('/file', getFile);
  app.get('/files/:filename', getFile);

  // GET /video?path=...
  app.get('/video', function(req, res) {
    var filepath = path.join(data_dir, decodeQueryPath(req.query.path));
    var stat = filestore.getFileStats(filepath);
    var fileSize = stat.size;
    var range = req.headers.range;

    if (range) {
      var parts = range.replace(/bytes=/, "").split("-");
      var start = parseInt(parts[0], 10);
      var end = parts[1]
        ? parseInt(parts[1], 10)
        : fileSize-1
        ;

      var chunksize = (end-start)+1;
      var file = fs.createReadStream(filepath, {start, end});
      var head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };

      if (path.extname(filepath) == '.webm') {
        head['Content-Type'] = 'video/webm';
      }

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      var head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      if (path.extname(filepath) == '.webm') {
        head['Content-Type'] = 'video/webm';
      }
      res.writeHead(200, head);
      fs.createReadStream(filepath).pipe(res);
    }
  });

  var comic_cache = {};

  // GET /comic?path=...
  // GET /comic?path=...&info=true
  // GET /comic?path=...&page=NUM
  app.get('/comic', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    var filepath = path.join(data_dir, decodeQueryPath(req.query.path));
    var filepath_hash = utils.md5Hash(filepath);
    
    if (req.query.page) {
      var page_num = parseInt(req.query.page);
      if (isNaN(page_num)) return res.status(400).send({error: 'Invalid page number'});

      var extractPage = function(page_file_name, files) {
        var target_dir = path.join(cache_dir, filepath_hash[0], 
          filepath_hash[1]+filepath_hash[2], filepath_hash);

        if (utils.fileExists(path.join(target_dir, page_file_name))) {
          return res.sendFile(path.join(target_dir, page_file_name));
        }

        comic_extract_queue.pushJob({
          archive_file_path: filepath,
          page_num: page_num,
          page_file_name: page_file_name,
          target_dir: target_dir,
          files: files,
          debug: options.debug,
          verbose: options.verbose
        }, function(args, done) {

          if (utils.fileExists(path.join(args.target_dir, args.page_file_name))) {
            res.sendFile(path.join(args.target_dir, args.page_file_name));
            return done();
          }

          if (args.verbose) console.log('extractPage:', args.page_num, args.page_file_name);

          comicFile.extractPage(args.archive_file_path, args.page_file_name, {
            targetDir: args.target_dir,
            files: args.files,
            debug: args.debug,
            verbose: args.verbose
          }, function(err, page_file_path) {
            if (err) {
              res.status(500).send({error: 'Extract page failed! ' + err.message});
            } else if (!page_file_path) {
              res.status(500).send({error: 'Cannot extract page!'});
            } else {
              res.sendFile(page_file_path);
            }
            done();
          });
        }, function(err) {
          // Job done!
        });
      }

      if (comic_cache[filepath_hash] && comic_cache[filepath_hash]['pages'] 
        && comic_cache[filepath_hash]['pages'].length>page_num) {
        return extractPage(comic_cache[filepath_hash]['pages'][page_num], comic_cache[filepath_hash]['files']);
      } else {
        comicFile.getInfo(filepath, function(err, result) {
          if (err) return res.status(500).send({error: 'Get file info failed! ' + err.message});
          if (!result) return res.status(500).send({error: 'Cannot get file info!'});

          comic_cache[filepath_hash] = result;
          return extractPage(result['pages'][page_num], result['files']);
        });
      }
    } else {
      if (comic_cache[filepath_hash]) return res.json(comic_cache[filepath_hash]);

      comicFile.getInfo(filepath, function(err, result) {
        if (err) return res.status(500).send({error: 'Get file info failed! ' + err.message});
        if (!result) return res.status(500).send({error: 'Cannot get file info!'});
        
        comic_cache[filepath_hash] = result;
        return res.json(result);
      });
    }
  });

  // GET /thumb?path=...
  app.get('/thumb', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    var filepath = path.join(data_dir, decodeQueryPath(req.query.path));
    var filepath_hash = utils.md5Hash(filepath);
    
    var thumb_width = 150;
    var thumb_height = 150;

    var thumb_filepath = path.join(thumbs_dir, filepath_hash[0], 
      filepath_hash[1]+filepath_hash[2], filepath_hash + '-' + thumb_width+'x'+thumb_height);

    fse.ensureDirSync(path.dirname(thumb_filepath));

    if (utils.fileExists(thumb_filepath)) {
      return res.sendFile(thumb_filepath);
    }

    var fileext = path.extname(filepath);
    if (fileext.indexOf('.') == 0) fileext = fileext.replace('.','').toLowerCase();

    if (COMIC_FILE_TYPES.indexOf(fileext) != -1) {
      comicFile.generateCoverImage(filepath, thumb_filepath, {
        tmpdir: path.join(cache_dir, filepath_hash[0], filepath_hash[1]+filepath_hash[2], filepath_hash),
        cover_width: thumb_width,
        cover_height: thumb_height,
        debug: options.debug
      }, function(err, result) {
        if (err) return res.status(500).send({error: 'Generate thumb failed! ' + err.message});
        if (!result || !result.cover_image) return res.status(500).send({error: 'Cannot generate thumb!'});

        return res.sendFile(thumb_filepath);
      });
    } else if (IMAGE_FILE_TYPES.indexOf(fileext) != -1) {
      photoFile.generateThumbImage(filepath, thumb_filepath, {
        thumb_width: thumb_width,
        // thumb_height: thumb_height
      }, function(err) {
        if (err) return res.status(500).send({error: 'Generate thumb failed! ' + err.message});

        return res.sendFile(thumb_filepath);
      });
    } else if (PDF_FILE_TYPES.indexOf(fileext) != -1) {
      // console.log('PDF thumb:', filepath);
      pdfFile.generateCoverImage(filepath, thumb_filepath, {
        verbose: false,
        thumbnail: true,
        thumb_width: thumb_width,
        // thumb_height: thumb_height
      }, function(err) {
        if (err) return res.status(500).send({error: 'Generate thumb failed! ' + err.message});

        return res.sendFile(thumb_filepath);
      });
    }else {
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

var loadIndex = function(callback) {
  if (options.index_file) {
    filestore.importFromIndexFile(options.index_file, data_dir, callback);
  } else {
    filestore.importFromDirectory(data_dir, data_dir, callback);
  }
}

var reloadIndex = function(callback) {
  filestore.resetIndex();
  loadIndex(callback);
}

// Load index & start server in the first time
loadIndex(function(err) {
  if (err) {
    process.exit();
  }
  startServer();
});
