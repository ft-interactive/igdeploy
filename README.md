# DEPRECATED

Try [ft-graphics-deploy](https://github.com/ft-interactive/ft-graphics-deploy).

---

# igdeploy

For internal FT use. May or may not work when deploying to other servers.

## Usage

```js
var igdeploy = require('igdeploy');

igdeploy(options, function (err) {
  if (err) throw err;
  console.log('deployed!');
});
```

### Options

Options are automatically loaded from a JSON file called `.igdeploy`. It first looks for this file in the current working directory, then in the parent directory, etc. The idea is to put an `.igdeploy` file in your home directory, containing the options `username`, `password` and `host`.

You can also pass options in manually as the first argument. These options are merged with the ones from your `.igdeploy` file. If any options have the same name, the ones passed into the function directly take priority.


#### `src` (string)

* Path to a local directory whose contents you want to upload.

#### `dest` (string)

* A remote path to a directory, into which the files will be uploaded.
* If it doesn't exist, it will be created with a `mkdirp -p`–like process.
* If it does exist, it will be renamed with `__IGDEPLOY_OLD` appended to the name, for recovery purposes (see [undo](#undo-boolean-default-false) below).
  * The previous `*__IGDEPLOY_OLD`, if present, will be rmrf'd. So you only get one 'undo' level.

#### `destPrefix` (string, optional)

* If provided, this will be prefixed to `dest`.
* This is just to provide friendlier logging (i.e. the prefix will be omitted from some logs).

#### `host` (string)

* E.g. `example.com`

#### `undo` (boolean, default: `false`)

* If `true`, it won't upload anything, and instead will attempt to revert the previous deployment.
* This simply uses a few `mv` commands to around `path` with `path__IGDEPLOY_OLD` (where `live` is the path you're deploying to). So if you run it again, it will undo the undo.
