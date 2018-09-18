var util = require('util');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var fse = require('fs-extra');
var sharp = require('sharp'); 

var pdf_cache_dir = path.join(process.env['HOME'], '.jul11co', 'pdf-file');
fse.ensureDirSync(pdf_cache_dir);

// ----

var PDFImage = require("pdf-image").PDFImage;
 
PDFImage.prototype.constructGetInfoCommand = function () {
  return util.format(
    "pdfinfo \"%s\"",
    this.pdfFilePath
  );
}

PDFImage.prototype.getOutputImagePathForPage = function (pageNumber) {
  var imageFileName = crypto.createHash('md5').update(this.pdfFilePath).digest("hex");
  return path.join(
    this.outputDirectory,
    imageFileName + "-" + pageNumber + "." + this.convertExtension
  );
}

PDFImage.prototype.constructConvertCommandForPage = function (pageNumber) {
  var pdfFilePath = this.pdfFilePath;
  var outputImagePath = this.getOutputImagePathForPage(pageNumber);
  var convertOptionsString = this.constructConvertOptions();
  var command = util.format(
    "%s %s\"%s[%d]\" \"%s\"",
    this.useGM ? "gm convert" : "convert",
    convertOptionsString ? convertOptionsString + " " : "",
    pdfFilePath, pageNumber, outputImagePath
  );
  console.log(command);
  return command;
}
// ----

var fileExists = function(file_path) {
  try {
    var stats = fs.statSync(file_path);
    if (stats.isFile()) {
      return true;
    }
  } catch (e) {
  }
  return false;
}

var resizeImageFile = function(image_file, thumb_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  options = options || {};

  var thumb_width = options.thumb_width || 256;
  var thumb_height = options.thumb_height; // || 256;

  sharp(image_file)
    .resize(thumb_width, thumb_height)
    .toFile(thumb_file, function(err, info) {
      if (err) return callback(err);
      callback();
    });
}

// ----

exports.getInfo = function(pdf_file, callback) {
  // console.log('getInfo:', pdf_file);
  var pdfImage = new PDFImage(pdf_file);
  pdfImage.getInfo().then(function(info) {
    callback(null, info);
  }, function(err) {
    callback(err);
  });
}

exports.getNumberOfPages = function(pdf_file, callback) {
  var pdfImage = new PDFImage(pdf_file);
  pdfImage.numberOfPages().then(function(numberOfPages) {
    callback(null, numberOfPages);
  }, function(err) {
    callback(err);
  });
}

exports.getPage = function(pdf_file, page_number, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var tmpdir = options.tmpdir || path.join(pdf_cache_dir, 'tmp', path.basename(pdf_file));
  fse.ensureDirSync(tmpdir);

  if (options.no_cache) {
    fse.emptyDirSync(tmpdir);
  }

  var time_start = new Date();

  var pdfImage = new PDFImage(pdf_file, {
    outputDirectory: tmpdir,
    convertOptions: {
      '-quality': options.quality || 100,
      '-density': options.density || 200,
      '-trim': null,
      '-flatten': null,
      '-colorspace': 'sRGB'
    }
  });
  pdfImage.numberOfPages().then(function(numberOfPages) {
    if (options.verbose) console.log('getPage:', 'numberOfPages', new Date()-time_start);
    if (options.verbose) time_start = new Date();

    if (numberOfPages == 0) {
      console.log('ERROR: The PDF file has no pages');
      return callback(new Error('PDF file has no pages!'));
    }
    if (numberOfPages <= page_number) {
      console.log('ERROR: The PDF file has no specified page (page out of range)');
      return callback(new Error('Page out of range'));
    }

    pdfImage.convertPage(page_number).then(function(image_path) {
      if (options.verbose) console.log('getPage:', 'convertPage', new Date()-time_start);

      callback(null, image_path);
    }, function(err) {
      console.log('ERROR: Extract page failed.');
      callback(err);
    });
  }, function(err) {
    console.log('ERROR: Get pages of PDF file failed.');
    callback(err);
  });
}

exports.extractCoverImage = function(pdf_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  var tmpdir = options.tmpdir || path.join(pdf_cache_dir, 'tmp', path.basename(pdf_file));
  fse.ensureDirSync(tmpdir);

  var pdfImage = new PDFImage(pdf_file, {
    outputDirectory: tmpdir,
    convertOptions: {
      '-quality': options.quality || 100,
      '-density': options.density || 200,
      '-trim': null,
      '-flatten': null,
      '-colorspace': 'sRGB'
    }
  });
  pdfImage.convertPage(0).then(function(imagePath) {
    // 0-th page (first page) of the slide.pdf is available as slide-0.png 
    callback(null, imagePath);
  }, function(err) {
    callback(err);
  });
}

exports.generateCoverImage = function(pdf_file, cover_image, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var result = {};

  if (fileExists(cover_image)) {
    result.cover_image = cover_image;
    return callback(null, result);
  }

  var tmpdir = options.tmpdir || path.join(pdf_cache_dir, 'tmp', path.basename(pdf_file));
  fse.ensureDirSync(tmpdir);

  // fse.emptyDirSync(tmpdir); // cleaned if exists, created if not exist

  var convertOptions = {
    '-quality': options.quality || 80,
    '-density': options.density || 100,
    '-trim': null,
    '-flatten': null
  };
  if (options.thumbnail) {
    convertOptions['-thumbnail'] = options.thumb_width || 240;
  }

  var pdfImage = new PDFImage(pdf_file, {
    outputDirectory: tmpdir,
    convertOptions: convertOptions
  });

  if (options.verbose) console.log('generateCoverImage:', 'getInfo', pdf_file);
  pdfImage.getInfo().then(function(info) {

    result.pdfinfo = info;

    var numberOfPages = info['Pages'] || 0;
    if (numberOfPages == 0) {
      console.log('ERROR: The PDF file has no pages');
      return callback(new Error('PDF file has no pages!'));
    }

    result.pages_count = numberOfPages;

    if (options.verbose) console.log('generateCoverImage:', 'convertPage', 0, pdf_file);
    pdfImage.convertPage(0).then(function(image_path) {

      fse.ensureDirSync(path.dirname(cover_image));
      if (options.verbose) console.log('generateCoverImage:', 'Cover image:', cover_image);

      // if (options.thumbnail) {

      //   if (options.verbose) console.log('generateCoverImage:', 'resizeImageFile', pdf_file);
      //   // resize cover page
      //   resizeImageFile(image_path, cover_image, {
      //     thumb_width: options.thumb_width || 240, 
      //     // thumb_height: options.thumb_width || 320
      //   }, function(err) {
      //     if (err) return callback(err);

      //     // result.cover_file = cover_file;
      //     if (!err) result.cover_image = cover_image;

      //     callback(null, result);
      //   });
      // } else {
        fse.copySync(image_path, cover_image, { overwrite: true, preserveTimestamps: true });

        result.cover_image = cover_image;

        callback(null, result);
      // }
    }, function(err) {
      callback(err);
    });

  }, function(err) {
    callback(err);
  });
}
