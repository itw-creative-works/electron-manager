const JSZip = require('jszip');
const fs = require('fs');
const jetpack = require('fs-jetpack');
const originalFs = require('original-fs');

async function extractZip(filePath, destination) {
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
              if (filename.endsWith('.asar')) {
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

module.exports = extractZip;
