const JSZip = require('jszip');
const { loadAsync } = JSZip;
const { join, dirname } = require('path');
const fs = require('fs');
// const unzipper = require('unzipper')
const jetpack = require('fs-jetpack');
const originalFs = require('original-fs');

async function extractZip(filePath, destination) {
  // var zip = new JSZip();
  // zip.loadAsync(fs.readFileSync(filePath)).then(function (contents) {
  //   Object.keys(contents.files).forEach(function (filename) {
  //     // const file = contents.files[filename];
  //     const file = contents.file(filename);
  //     if (file) {
  //       file.async('nodebuffer').then(function (fileData) {
  //         var dest = destination + '/' + filename;
  //         console.log('---dest', dest);
  //         jetpack.write(dest, fileData);
  //       })
  //     }
  //
  //   })
  // })
  // return
  fs.readFile(filePath, function(err, data) {
      if (!err) {
          var zip = new JSZip();
          zip.loadAsync(data).then(function(contents) {
              Object.keys(contents.files).forEach(function(filename) {
                // console.log('---filename', filename);
                const file = zip.file(filename);
                if (file) {
                  file.async('nodebuffer').then(function(content) {
                      var dest = destination + '/' + filename;
                      console.log('---dest', dest);
                      if (filename.endsWith('.asar')) {
                        console.log('-----skipping');
                        originalFs.writeFileSync(dest, content)
                      } else {
                        jetpack.write(dest, content);
                      }
                  });
                }
              });
          });
      }
  });
};

async function _extractZip(filePath, destination) {
  const zip = await loadAsync(fs.readFileSync(filePath));
  const zipFileKeys = Object.keys(zip.files);
  // console.log('---zip', zip);

  // console.log('----zip.files', zip.files);
  console.log('---zipFileKeys[0]', zipFileKeys[0]);

  console.log('----zip.files[zipFileKeys[0]]', zip.files[zipFileKeys[0]]);

  const mainDir = await zip.files[zipFileKeys[0]]._data;

  console.log('----destination', destination);

  await fs.promises.writeFile(destination + '/app.app', mainDir)

  return

  return Promise.all(
    zipFileKeys.map((filename) => {
      const isFile = !zip.files[filename].dir;
      const fullPath = join(destination, filename);
      const directory = (isFile && dirname(fullPath)) || fullPath;
      const content = zip.files[filename].async('nodebuffer');

      return fs.promises
        .mkdir(directory, { recursive: true })
        .then(async () => {
          return isFile ? await content : false;
        })
        .then(async (data) => {
          console.log('---fullPath', fullPath);
          return data ? await fs.promises.writeFile(fullPath, data) : true;
        });
    }),
  );
};

async function _extractZip(localPathFilename, destination) {
  // console.log('---__dirname', __dirname);

  // console.log('====destination', destination);

  // const unzip = require('./zip.js');
  // unzip(localPathFilename, destination);
  //

  // require('unzip').Extract({path:'./'})

  // var readStream = fs.createReadStream('path/to/archive.zip');
  // var writeStream = fstream.Writer('output/path');
  //
  // readStream
  //   .pipe(unzip.Parse())
  //   .pipe(writeStream)

  // require('unzip').Extract({path: localPathFilename})

  // var yauzl = require("yauzl");
  //
  // yauzl.open(localPathFilename, {lazyEntries: true}, function(err, zipfile) {
  //   if (err) throw err;
  //   zipfile.readEntry();
  //   zipfile.on("entry", function(entry) {
  //     if (/\/$/.test(entry.fileName)) {
  //       // Directory file names end with '/'.
  //       // Note that entires for directories themselves are optional.
  //       // An entry's fileName implicitly requires its parent directories to exist.
  //       zipfile.readEntry();
  //     } else {
  //       // file entry
  //       zipfile.openReadStream(entry, function(err, readStream) {
  //         if (err) throw err;
  //         readStream.on("end", function() {
  //           zipfile.readEntry();
  //         });
  //         readStream.pipe(somewhere);
  //       });
  //     }
  //   });
  // });

  console.log('---localPathFilename', localPathFilename);
  console.log('---destination', destination);

  // var fs = require('fs')

  // fs.createReadStream(localPathFilename)
  //   .pipe(unzipper.Extract({ path: destination }));

  jetpack.createReadStream(localPathFilename)
    .pipe(unzipper.Parse())
    .on('entry', function (entry) {
      const fileName = entry.path;
      const type = entry.type; // 'Directory' or 'File'
      const size = entry.vars.uncompressedSize; // There is also compressedSize;
      if (fileName.match(/\.app\/$/)) {
        // entry.pipe(jetpack.createWriteStream(destination + '/asd/'));
        // entry.pipe(jetpack.createWriteStream(destination + '/asd.app'));
        entry.pipe(jetpack.createWriteStream(destination + '/' + fileName));
      } else {
        entry.autodrain();
      }
    });
}

module.exports = extractZip;
