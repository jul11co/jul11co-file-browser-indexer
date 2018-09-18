// lib/file-store.js

var fs = require('fs');
var path = require('path');

var fse = require('fs-extra');
var bytes = require('bytes');

var fileUtils = require('./file-utils');
var utils = require('./utils');

var IMAGE_FILE_TYPES = ['jpg','jpeg','png','gif'];
var VIDEO_FILE_TYPES = ['mp4','webm'];
var COMIC_FILE_TYPES = ['cbz','cbr','zip'];
var ARCHIVE_FILE_TYPES = ['zip','rar','7z'];

var FileStore = function(opts) {
  opts = opts || {};

  if (opts.abs_path_mode) this.abs_path_mode = true;

  this.root_dir = opts.root_dir || '/';

  this.dirs_map = {};
  this.files_map = {};

  this.all_files = [];
  this.image_files = [];
  this.video_files = [];

  this.file_types_map = {};
  this.popular_file_types = [];

  this.stat_map = {};
}

FileStore.prototype.resetIndex = function() {

  this.dirs_map = {};
  this.files_map = {};

  this.all_files = [];
  this.image_files = [];
  this.video_files = [];

  this.file_types_map = {};
  this.popular_file_types = [];
}

///

FileStore.prototype.getFilesCount = function() {
  return this.all_files.length;
}

FileStore.prototype.getAllFiles = function() {
  var self = this;

  var files = self.all_files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

FileStore.prototype.getFiles = FileStore.prototype.getAllFiles;

FileStore.prototype.getFilesFromDir = function(from_dir) {
  var self = this;

  var matched_files = self.all_files;
  if (!self.isRootPath(from_dir)) {
    matched_files = matched_files.filter(function(file_relpath) {
      return file_relpath.indexOf(from_dir) == 0;
    });
  }

  var files = matched_files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

FileStore.prototype.searchFiles = function(query) {
  var self = this;

  var files = [];

  self.all_files.forEach(function(file_relpath) {
    if (self.files_map[file_relpath] && self.files_map[file_relpath].name.indexOf(query) != -1) {
      files.push(self.files_map[file_relpath]);
    }
  });

  return files;
}

FileStore.prototype.searchDirs = function(query) {
  var self = this;

  var dirs = [];
  for (var dir_path in self.dirs_map) {
    if (self.dirs_map[dir_path] && self.dirs_map[dir_path].name.indexOf(query) != -1) {
      dirs.push(self.dirs_map[dir_path]);
    }
  }

  return dirs;
}

//

FileStore.prototype.getImageFilesCount = function() {
  return this.image_files.length;
}

FileStore.prototype.getImageFiles = function() {
  var self = this;
  
  var files = self.image_files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

FileStore.prototype.getImageFilesFromDir = function(from_dir) {
  var self = this;
  
  var matched_image_files = self.image_files;
  if (!self.isRootPath(from_dir)) {
    matched_image_files = matched_image_files.filter(function(file_relpath) {
      return file_relpath.indexOf(from_dir) == 0;
    });
  }

  var files = matched_image_files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

//

FileStore.prototype.getVideoFilesCount = function() {
  return this.video_files.length;
}

FileStore.prototype.getVideoFiles = function() {
  var self = this;
  
  var files = self.video_files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

FileStore.prototype.getVideoFilesFromDir = function(from_dir) {
  var self = this;
  
  var matched_video_files = self.video_files;
  if (!self.isRootPath(from_dir)) {
    matched_video_files = matched_video_files.filter(function(file_relpath) {
      return file_relpath.indexOf(from_dir) == 0;
    });
  }

  var files = matched_video_files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

//

FileStore.prototype.getMatchedFiles = function(file_type) {
  var self = this;

  if (!self.file_types_map[file_type]) {
    return [];
  }
  
  var files = self.file_types_map[file_type].files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

FileStore.prototype.getMatchedFilesFromDir = function(from_dir, file_type) {
  var self = this;

  console.log('getMatchedFilesFromDir:', from_dir);

  if (!self.file_types_map[file_type]) {
    return [];
  }
  
  var matched_files = self.file_types_map[file_type].files;
  if (!self.isRootPath(from_dir)) {
    matched_files = matched_files.filter(function(file_relpath) {
      return file_relpath.indexOf(from_dir) == 0;
    });
  }

  var files = matched_files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

//

FileStore.prototype.getPopularFileTypes = function() {
  return this.popular_file_types;
}

FileStore.prototype.getFileTypes = function(files) {

  var file_types = [];
  var file_types_map = {};
  
  files.forEach(function(file) {
    if (file.type && file.type != '') {
      if (!file_types_map[file.type]) {
        file_types_map[file.type] = {};
        file_types_map[file.type].count = 0;
        file_types_map[file.type].files = [];
      }
      file_types_map[file.type].count++;
    }
  });

  for(var file_type in file_types_map) {
    file_types.push({
      type: file_type, 
      count: file_types_map[file_type].count
    });
  }

  file_types.sort(function(a,b) {
    if (a.count>b.count) return -1;
    if (a.count<b.count) return 1;
    return 0;
  });

  return file_types;
}

FileStore.prototype.getFileTypesFromDir = function(from_dir) {
  var files = this.getFilesFromDir(from_dir);
  return this.getFileTypes(files);
}

//

FileStore.prototype.getSubdirs = function(dir_path) {
  var self = this;

  if (self.isRootPath(dir_path)) {
    dir_path = '.';
  }

  if (!self.dirs_map[dir_path]) {
    return [];
  }

  var dir_entry = self.dirs_map[dir_path];

  var subdirs = dir_entry.subdirs.map(function(dir_relpath) {
    var subdir_entry = self.dirs_map[dir_relpath];
    return {
      name: subdir_entry.name,
      path: subdir_entry.path,
      size: subdir_entry.size,
      atime: subdir_entry.atime,
      mtime: subdir_entry.mtime,
      ctime: subdir_entry.ctime,
      subdirs_count: subdir_entry.subdirs.length,
      files_count: subdir_entry.files.length
    }
  });

  return subdirs;
}

FileStore.prototype.getSubfiles = function(dir_path) {
  var self = this;

  if (self.isRootPath(dir_path)) {
    dir_path = '.';
  }

  if (!self.dirs_map[dir_path]) {
    return [];
  }

  var dir_entry = self.dirs_map[dir_path];

  var files = dir_entry.files.map(function(file_relpath) {
    return self.files_map[file_relpath];
  });

  return files;
}

///

FileStore.prototype.updateParentDirSize = function(frelpath) {
  var self = this;
  var parent_dirs = self.getParentDirs(frelpath, true);
  if (parent_dirs && parent_dirs.length) {
    var dir_size_map = {};
    parent_dirs.forEach(function(parent_dir) {
      if (self.dirs_map[parent_dir]) {
        self.dirs_map[parent_dir].size = self.getDirSize(parent_dir, dir_size_map);
      }
    });
  }
}

FileStore.prototype.deletePath = function(frelpath, data_dir, callback) {
  if (typeof data_dir == 'function') {
    callback = data_dir;
    data_dir = null;
  }

  var self = this;

  var fabspath = (!self.abs_path_mode && data_dir) ? path.join(data_dir, frelpath) : frelpath;

  if (utils.fileExists(fabspath)) {
    console.log('Delete file:', fabspath);

    fse.remove(fabspath, function(err) {
      if (err) return callback(err);

      // update file map & parent folder sizes
      self.removeFileFromMap(frelpath);
      
      return callback(null, {deleted: 1, type: 'file', abs_path: fabspath});
    });
  } else if (utils.directoryExists(fabspath)) {
    console.log('Delete folder:', fabspath);

    fse.remove(fabspath, function(err) {
      if (err) return callback(err);

      // update file map & parent folder sizes
      self.removeDirFromMap(frelpath);

      return callback(null, {deleted: 1, type: 'folder', abs_path: fabspath});
    });
  } else {
    return callback(new Error('Path not found'));
  }
}

FileStore.prototype.getFileStats = function(fpath) {
  var self = this;
  if (!self.stat_map[fpath]) {
    self.stat_map[fpath] = fs.statSync(fpath);
  }
  return self.stat_map[fpath];
}

///

FileStore.prototype.isRootPath = function(_path) {
  if (this.abs_path_mode) {
    return (_path === '/' || _path === this.root_dir || _path === 'ROOT' || _path === '.');
  } else {
    return (_path === this.root_dir || _path === 'ROOT' || _path === '.');
  }
}

FileStore.prototype.getRootPath = function() {
  if (this.abs_path_mode) {
    return this.root_dir;
  } else {
    return 'ROOT';
  }
}

FileStore.prototype.setRootDir = function(root_dir) {
  this.root_dir = root_dir;
}

FileStore.prototype.getRootDir = function() {
  return this.root_dir;
}

FileStore.prototype._recalculateRootPath = function(current_root) {
  if (!this.dirs_map[current_root]) return null;
  if (this.dirs_map[current_root].files.length) return current_root;
  if (this.dirs_map[current_root].subdirs.length > 1) return current_root;
  return (this._recalculateRootPath(this.dirs_map[current_root].subdirs[0]) || current_root);
}

FileStore.prototype.recalculateRootPath = function() {
  this.root_dir = this.recalculateRootPath(this.root_dir) || this.root_dir;
}

FileStore.prototype.getParentDirs = function(_path, with_root) {
  var parents = [];

  if (this.isRootPath(_path)) {
    return parents;
  }

  // console.log('getParentDirs:', _path);

  var parent = path.dirname(_path);
  if (parent) {
    if (this.isRootPath(parent)) {
      if (with_root) parents.push('ROOT');
    } else {
      var _parents = this.getParentDirs(parent);
      if (_parents.length) parents = parents.concat(_parents);
      parents.push(parent);
    }
  }

  return parents;
}

///

FileStore.prototype.removeDirFromMap = function(dir_relpath) {
  var self = this;
  if (self.dirs_map[dir_relpath]) {
    delete self.dirs_map[dir_relpath];

    var parent_path = path.dirname(dir_relpath);
    if (self.dirs_map[parent_path]) {
      self.dirs_map[parent_path].subdirs = self.dirs_map[parent_path].subdirs.filter(function(subdir_relpath) {
        return subdir_relpath != dir_relpath;
      });
    }

    self.updateParentDirSize(dir_relpath);
  }
}

FileStore.prototype.addDirToMap = function(dir, data_dir) {
  var self = this;

  var dir_path = dir.path;
  var dir_relpath = dir.path;

  if (!self.abs_path_mode && data_dir) {
    dir_relpath = (dir_path == data_dir) ? '.' : path.relative(data_dir, dir_path);
  }

  // console.log('addDirToMap:', dir_relpath);

  if (!self.dirs_map[dir_relpath]) {
    self.dirs_map[dir_relpath] = {};
    self.dirs_map[dir_relpath].name = path.basename(dir_relpath);
    self.dirs_map[dir_relpath].path = dir_relpath;
    self.dirs_map[dir_relpath].size = 0;
    self.dirs_map[dir_relpath].files = [];
    self.dirs_map[dir_relpath].subdirs = [];
  }
  if (dir.atime) self.dirs_map[dir_relpath].atime = dir.atime;
  if (dir.mtime) self.dirs_map[dir_relpath].mtime = dir.mtime;
  if (dir.ctime) self.dirs_map[dir_relpath].ctime = dir.ctime;

  // if (!self.abs_path_mode && dir_path != data_dir) {
  //   var parent_dir_entry = self.addDirToMap({ path: path.dirname(dir_path) }, data_dir);
  //   if (parent_dir_entry.subdirs.indexOf(dir_relpath) == -1) {
  //     parent_dir_entry.subdirs.push(dir_relpath);
  //   }
  // }

  if (!self.isRootPath(dir_path)) {
    var parent_dir_entry = self.addDirToMap({ path: path.dirname(dir_path) }, data_dir);
    if (parent_dir_entry.subdirs.indexOf(dir_relpath) == -1) {
      parent_dir_entry.subdirs.push(dir_relpath);
    }
  } 
  else if (self.abs_path_mode && dir_path != 'ROOT') {
    var parent_dir_entry = self.addDirToMap({ path: 'ROOT' }, data_dir);
    if (parent_dir_entry.subdirs.indexOf(dir_relpath) == -1) {
      parent_dir_entry.subdirs.push(dir_relpath);
    }
  }

  return self.dirs_map[dir_relpath];
}

FileStore.prototype.getDirSize = function(dir_relpath, dir_size_map) {
  // console.log('getDirSize:', dir_relpath);

  dir_size_map = dir_size_map || {};
  
  var self = this;

  if (!dir_relpath) return 0;
  if (!self.dirs_map[dir_relpath]) return 0;
  if (dir_size_map[dir_relpath]) return dir_size_map[dir_relpath];

  if (self.dirs_map[dir_relpath].subdirs.length == 0) {
    dir_size_map[dir_relpath] = self.dirs_map[dir_relpath].size;
    return self.dirs_map[dir_relpath].size;
  }

  // var dir_size = dirs_map[dir_relpath].size; // size of files (if any)
  var dir_size = 0;
  self.dirs_map[dir_relpath].files.forEach(function(file_relpath) {
    dir_size += self.files_map[file_relpath].size;
  });
  self.dirs_map[dir_relpath].subdirs.forEach(function(subdir_relpath) {
    dir_size += self.getDirSize(subdir_relpath, dir_size_map);
  });

  dir_size_map[dir_relpath] = dir_size;
  return dir_size;
}

FileStore.prototype.createDirsIndex = function(dirs, data_dir) {
  console.log('Dirs:', dirs.length);
  var self = this;
  dirs.forEach(function(dir) {
    self.addDirToMap(dir, data_dir);
  });
}

FileStore.prototype.recalculateDirsSize = function() {
  var self = this;
  // calculate directory size
  for(var dir_relpath in self.dirs_map) {
    self.dirs_map[dir_relpath].size = self.getDirSize(dir_relpath);
  }
}

//

FileStore.prototype.getFile = function(fpath, data_dir) {
  var frelpath = fpath;
  if (!this.abs_path_mode && data_dir) {
    frelpath = path.relative(data_dir, fpath);
  }
  return this.files_map[frelpath];
}

FileStore.prototype.addFile = function(file, data_dir) {
  var self = this;

  if (file.relpath && !self.files_map[file.relpath]) {

    file.type = (file.type) ? file.type.toLowerCase() : '';

    self.files_map[file.relpath] = file;

    if (IMAGE_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_image = true;
      self.image_files.push(file.relpath);
    } else if (VIDEO_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_video = true;
      self.video_files.push(file.relpath);
    } else if (COMIC_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_comic = true;
    } 
    if (ARCHIVE_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_archive = true;
    }
    self.all_files.push(file.relpath);

    if (file.type && file.type != '') {
      if (!self.file_types_map[file.type]) {
        self.file_types_map[file.type] = {};
        self.file_types_map[file.type].count = 0;
        self.file_types_map[file.type].files = [];
      }
      self.file_types_map[file.type].count++;
      self.file_types_map[file.type].files.push(file.relpath);
    }
    
    var parent_dir_entry = self.addDirToMap({ path: path.dirname(file.path) }, data_dir);
    if (parent_dir_entry.files.indexOf(file.relpath) == -1) {
      parent_dir_entry.size += file.size;
      parent_dir_entry.files.push(file.relpath);
    }
  }
}

FileStore.prototype.updateFile = function(fpath, info, data_dir) {
  var frelpath = fpath;
  if (!this.abs_path_mode && data_dir) {
    frelpath = path.relative(data_dir, fpath);
  }
  if (this.files_map[frelpath]) {
    for (var field in info) {
      this.files_map[frelpath][field] = info[field];
    }
  }
}

FileStore.prototype.removeFileFromMap = function(file_relpath) {
  var self = this;

  if (self.files_map[file_relpath]) {

    var file_info = self.files_map[file_relpath];

    var parent_path = path.dirname(file_path);
    if (self.dirs_map[parent_path]) {
      self.dirs_map[parent_path].files = self.dirs_map[parent_path].files.filter(function(file_relpath) {
        return file_relpath != file_info.relpath;
      });
    }
    
    // remove files from self.all_files
    self.all_files = self.all_files.filter(function(file_relpath) {
      return file_relpath != file_info.relpath;
    });
    // remove files from self.image_files
    if (file_info.type && IMAGE_FILE_TYPES.indexOf(file_info.type) != -1) {
      self.image_files = self.image_files.filter(function(file_relpath) {
        return file_relpath != file_info.relpath;
      });
    }
    // remove files from self.video_files
    if (file_info.type && VIDEO_FILE_TYPES.indexOf(file_info.type) != -1) {
      self.video_files = self.video_files.filter(function(file_relpath) {
        return file_relpath != file_info.relpath;
      });
    }
    // remove files from self.file_types_map
    if (file_info.type && self.file_types_map[file_info.type]) {
      if (self.file_types_map[file_info.type].count > 1) {
        self.file_types_map[file_info.type].count--;
        self.file_types_map[file_info.type].files = self.file_types_map[file_info.type].files.filter(function(file_relpath) {
          return file_relpath != file_info.relpath;
        });
      } else {
        self.file_types_map[file_info.type].count = 0;
        self.file_types_map[file_info.type].files = [];
      }
      // update self.popular_file_types
      self.popular_file_types.forEach(function(popular_file_type) {
        if (popular_file_type.type == file_info.type) {
          popular_file_type.count = self.file_types_map[file_info.type].count;
        }
      });
    }

    delete self.files_map[file_relpath];

    self.updateParentDirSize(file_relpath);
  }
}

FileStore.prototype.createFilesIndex = function(files, data_dir) {

  console.log('Files:', files.length);

  var total_files_size = 0;
  files.forEach(function(file) { 
    total_files_size += file.size;
  });
  console.log('Size:', bytes(total_files_size));

  var self = this;

  files.forEach(function(file) {
    if (!file.relpath) {
      file.relpath = (!self.abs_path_mode && data_dir) ? path.relative(data_dir, file.path) : file.path;
    }
    self.addFile(file, data_dir);
  });

  // get popular file types
  var file_types = [];
  for(var file_type in self.file_types_map) {
    file_types.push({
      type: file_type, 
      count: self.file_types_map[file_type].count
    });
  }
  file_types.sort(function(a,b) {
    if (a.count>b.count) return -1;
    if (a.count<b.count) return 1;
    return 0;
  });
  if (file_types.length > 10) self.popular_file_types = file_types.slice(0, 10);
  else self.popular_file_types = file_types.slice(0);
}

///

FileStore.prototype.importFromIndexFile = function(index_file, data_dir, callback) {
  if (!utils.fileExists(index_file)) {
    console.log('File not found:', index_file);
    return callback(new Error('File not found: ' + index_file));
  }

  var tmp_files_map = utils.loadFromJsonFile(index_file);
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

  this.createDirsIndex(dirs, data_dir);
  this.createFilesIndex(files, data_dir);
  this.recalculateDirsSize();
}

FileStore.prototype.importFromDirectory = function(input_dir, data_dir, callback) {
  var scan_opts = {recursive: true};

  var self = this;

  console.log('Scanning input dir...');
  fileUtils.scanDir(input_dir, scan_opts, function(err, files, dirs) {
    if (err) {
      console.log('Scan dir error!', input_dir, err.message);
      return callback(err);
    }
    
    self.createDirsIndex(dirs, data_dir);
    self.createFilesIndex(files, data_dir);
    self.recalculateDirsSize();

    return callback();
  });
}

module.exports = FileStore;