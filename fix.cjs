const fs = require('fs');

function fixFile(filePath) {
  let txt = fs.readFileSync(filePath, 'utf8');
  txt = txt.split('\\`').join('`');
  txt = txt.split('\\$').join('$');
  fs.writeFileSync(filePath, txt);
  console.log('Fixed', filePath);
}

fixFile('src/core/router.js');
fixFile('src/services/gemini.js');
