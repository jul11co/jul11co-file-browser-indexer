// lib/utils.js

var path = require('path');
var fs = require('fs');
var urlutil = require('url');

var mkdirp = require('mkdirp');
var jsonfile = require('jsonfile');

function fileExists(file_path) {
  try {
    var stats = fs.statSync(file_path);
    if (stats.isFile()) {
      return true;
    }
  } catch (e) {
  }
  return false;
}

function directoryExists(directory) {
  try {
    var stats = fs.statSync(directory);
    if (stats.isDirectory()) {
      return true;
    }
  } catch (e) {
  }
  return false;
}

function ensureDirectoryExists(directory) {
  try {
    var stats = fs.statSync(directory);
    // if (stats.isDirectory()) {
    //   console.log('Directory exists: ' + directory);
    // }
  } catch (e) {
    // console.log(e);
    if (e.code == 'ENOENT') {
      // fs.mkdirSync(directory);
      mkdirp.sync(directory);
      console.log('Directory created: ' + directory);
    }
  }
}

function isHttpUrl(string) {
  var pattern = /^((http|https):\/\/)/;
  return pattern.test(string);
}

function isValidLink(link_href) {
  if (!link_href || link_href === '') return false;
  if (link_href.indexOf('#') == 0 
    || link_href.indexOf('mailto:') >= 0 
    || link_href.indexOf('javascript:') == 0) {
    return false;
  }
  return true;
}

function urlGetHost(_url) {
  if (!_url || _url == '') return '';
  var host_url = '';
  var url_obj = urlutil.parse(_url);
  if (url_obj.slashes) {
    host_url = url_obj.protocol + '//' + url_obj.host;
  } else {
    host_url = url_obj.protocol + url_obj.host;
  }
  return host_url;
}

function ellipsisMiddle(str, max_length, first_part_length, last_part_length) {
  if (!max_length) max_length = 100;
  if (!first_part_length) first_part_length = 40;
  if (!last_part_length) last_part_length = 20;
  if (str.length > max_length) {
    return str.substr(0, first_part_length) + '...' + str.substr(str.length-last_part_length, str.length);
  }
  return str;
}

// http://stackoverflow.com/questions/2998784/
function numberPad(num, size) {
  var s = "000000000" + num;
  return s.substr(s.length-size);
}

function escapeRegExp(string) {
  return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function replaceAll(string, find, replace) {
  return string.replace(new RegExp(escapeRegExp(find), 'g'), replace);
}

function extractSubstring(original, prefix, suffix) {
  if (!original) return '';
  var tmp = original.substring(original.indexOf(prefix) + prefix.length);
  tmp = tmp.substring(0, tmp.indexOf(suffix));
  return tmp;
}

function trimText(input, max_length) {
  if (!input || input == '') return '';
  max_length = max_length || 60;
  var output = input.trim();
  if (output.length > max_length) {
    output = output.substring(0, max_length) + '...';
  }
  return output;
}

function getUniqueFileName(file_names, file_name) {
  var result_file_name = file_name;
  var collision = false;
  for (var i = 0; i < file_names.length; i++) {
    if (file_name == file_names[i].file_name) {
      collision = true;
      file_names[i].current_index++;
      var file_name_ext = path.extname(file_name);
      var file_name_base = path.basename(file_name, file_name_ext);
      result_file_name = file_name_base + '(' + file_names[i].current_index + ')' + file_name_ext;
    }
  }
  if (!collision) {
    file_names.push({
      file_name: file_name,
      current_index: 0
    });
  }
  return result_file_name;
}

function getUniqueFilePath(file_path) {
  var result_file_dir = path.dirname(file_path);
  var result_file_path = file_path;
  var file_index = 0;
  while (fileExists(result_file_path)) {
    file_index++;
    var file_ext = path.extname(result_file_path);
    var file_name = path.basename(result_file_path, file_ext) + '(' + file_index + ')' + file_ext;
    result_file_path = path.join(result_file_dir, file_name);
  }
  return result_file_path;
}

var loadFromJsonFile = function(file) {
  var info = {};
  try {
    var stats = fs.statSync(file);
    if (stats.isFile()) {
      info = jsonfile.readFileSync(file);
    }
  } catch (e) {
    console.log(e);
  }
  return info;
}

var saveToJsonFile = function(info, file) {
  var err = null;
  try {
    jsonfile.writeFileSync(file, info, { spaces: 2 });
  } catch (e) {
    err = e;
  }
  return err;
}

var parseFileSize = function(string) {
  var file_size = -1;
  if (string) {
    if (string.indexOf('KB')) {
      var size = string.replace('KB','');
      size = parseInt(size);
      if (isNaN(size)) {
        console.log('Invalid size');
        return -1;
      }
      file_size = size*1024;
    } else if (string.indexOf('MB')) {
      var size = string.replace('MB','');
      size = parseInt(min_size);
      if (isNaN(size)) {
        console.log('Invalid size');
        return -1;
      }
      file_size = size*1024*1024;
    } else if (string.indexOf('GB')) {
      var size = string.replace('GB','');
      size = parseInt(size);
      if (isNaN(size)) {
        console.log('Invalid size');
        return -1;
      }
      file_size = size*1024*1024*1024;
    }
  }
  return file_size;
}

module.exports = {
  fileExists: fileExists,
  directoryExists: directoryExists,
  ensureDirectoryExists: ensureDirectoryExists,

  parseFileSize: parseFileSize,

  isValidLink: isValidLink,
  urlGetHost: urlGetHost,
  ellipsisMiddle: ellipsisMiddle,
  numberPad: numberPad,
  isHttpUrl: isHttpUrl,

  trimText: trimText,

  replaceAll: replaceAll,
  extractSubstring: extractSubstring,

  getUniqueFileName: getUniqueFileName,
  getUniqueFilePath: getUniqueFilePath,

  loadFromJsonFile: loadFromJsonFile,
  saveToJsonFile: saveToJsonFile
}
