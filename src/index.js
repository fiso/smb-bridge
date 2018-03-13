const commandLineArgs = require('command-line-args');
const bodyParser = require('body-parser');
const http = require('http');
const express = require('express');
const SMB2 = require('smb2-revival');
const cors = require('cors');

String.prototype.replaceAll = function (target, replacement) {
  return this.split(target).join(replacement);
};

const optionDefinitions = [
  {name: 'smb-endpoint', defaultOption: true, alias: 'e', type: String},
  {name: 'smb-user', alias: 'u', type: String, defaultValue: 'guest'},
  {name: 'smb-password', alias: 'p', type: String, defaultValue: ''},
  {name: 'smb-domain', alias: 'd', type: String, defaultValue: ''},
  {name: 'port', alias: 'P', type: String, defaultValue: '1080'},
];

let options = {};
try {
  options = commandLineArgs(optionDefinitions);
} catch (e) {
  console.warn(e);
}

if (!options['smb-endpoint']) {
  console.error('Missing required option smb-endpoint');
  process.exit(1);
}

function connect () {
  return new SMB2({
    share: options['smb-endpoint'], // '\\\\192.168.2.80\\web',
    domain: options['smb-domain'],
    username: options['smb-user'], // 'admin',
    password: options['smb-password'], // 'haan02',
  });
}

function getFile (smb2Client, path) {
  return new Promise((resolve, reject) => {
    smb2Client.readFile(path, (err, file) => {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        resolve(file);
      }
    });
  });
}

function getDirectoryListing (smb2Client, path, options) {
  return new Promise((resolve, reject) => {
    smb2Client.readdir(path, async (err, entries) => {
      if (err) {
        console.log(err);
        reject(err);
        return;
      }

      entries = entries
        .filter((entry) => !['.', '..'].some((n) => n === entry.filename));

      if (options.recursive) {
        const e = entries.map(async (entry) => {
          return new Promise((resolve, reject) => {
            if (entry.directory) {
              getDirectoryListing(smb2Client, `${path}\\${entry.filename}`,
                options)
              .then((result) => {
                resolve({
                  ...entry,
                  contents: result,
                });
              });
            } else {
              resolve(entry);
            }
          });
        });
        resolve(await Promise.all(e));
      } else {
        resolve(entries);
      }
    });
  });
}

const app = express();
const router = express.Router(); // eslint-disable-line

app.use(bodyParser.json());
app.use(cors());
app.use('/api', router);

router.route('/directory/:directory/:mode?')
  .get(async (req, res) => {
    try {
      const listing = await getDirectoryListing(connect(),
        req.params.directory.replaceAll('~', '\\'),
        {recursive: req.params.mode === 'recursive'});
      console.log(listing);
      res.json({
        listing,
      });
    } catch (error) {
      res.status(500).json({error: error.toString()}).send();
    }
  });

router.route('/file/:filename')
  .get(async (req, res) => {
    try {
      const originalFilename = req.params.filename.substr(
        req.params.filename.lastIndexOf('~') + 1);

      const ending = originalFilename.substr(
        originalFilename.lastIndexOf('.') + 1);

      const mimes = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        svg: 'image/svg+xml',
      };

      res.set({
        'Content-Type': mimes[ending] || 'application/octet-stream',
        'Content-Disposition': `${mimes[ending] ? 'inline' : 'attachment'}; filename="${originalFilename}"`, // eslint-disable-line
      });
      res.send(new Buffer(await getFile(connect(),
        req.params.filename.replaceAll('~', '\\')), 'binary'));
    } catch (error) {
      res.status(500).json({error: error.toString()}).send();
    }
  });

const server = http.createServer(app);

server.listen(options.port, function () {
  console.log(`Acting as bridge for ${options['smb-endpoint']} on port ${options.port}`); // eslint-disable-line
});
