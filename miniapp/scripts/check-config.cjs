const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { validateConfig } = require('@tarojs/plugin-doctor/js-binding');

// Run Taro's own bundled schema validation without the CLI wrapper's home-directory cache.
const filename = path.resolve(__dirname, '../config/index.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const context = { exports: {}, require, process, __dirname: path.dirname(filename) };
vm.runInNewContext(source, context, { filename });
validateConfig(JSON.stringify(context.exports.default),
  'https://raw.githubusercontent.com/NervJS/taro-doctor/main/assets/config_schema.json', false)
  .then((result) => {
    if (!result.isValid) {
      for (const message of result.messages) console.error(message.content);
      process.exitCode = 1;
    } else console.log('Taro project configuration passed the bundled schema validation.');
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
