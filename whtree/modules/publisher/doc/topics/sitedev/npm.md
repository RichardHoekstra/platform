# Using NPM with WebHare

You can use NPM to download JavaScript modules to use when developing websites
in WebHare.

Most commands should be executed in the root of your design, eg:
`whcd mymodule/webdesigns/mydesign`

## Updating/installing dependencies on new modules
You can use `npm install <module>` to install modules, eg `npm install jquery`.
You should execute this command either from your module or your webdesign
root directory (both already contain the necessary `package.json` file if you
created the module and webdesign using `wh module`)

Packages loaded at the module level are available to all webdesigns in this
module (per the normal `node_modules` lookup rules).

Please note that a WebHare webdesign never needs to explicitly install `dompack`
as this package is automatically provided by the assetpack builder (and will
replace any user-supplied dompack anyway)

### Example: jQuery
To add jQuery, run this on your command line:

```bash
whcd mymodule/webdesigns/mydesign # go to your design directory
npm install jquery # install the dependency
```

and then in your JavaScript code:

```javascript
import $ from 'jquery';
$.ready(...);
```

### Example: font-awesome
To add FontAwesome, run this on your command line:

```bash
whcd mymodule/webdesigns/mydesign
npm install font-awesome@4
```

and then add to your JavaScript code:

```javascript
import 'font-awesome/css/font-awesome.css';
```

Note that we generally recommend to use JavaScript `import` for CSS files and
not `@import` as the former allows the bundler to de-duplicate the CSS import.


## Shipped node_modules
WebHare ships with some node_modules of its own to implement various funtionality (eg bundling). These NPM modules
are stored in whtree/node_modules and only accessible to built-in modules to prevent accidental undeclared dependencies

Some of these builtin modules are exported through `@webhare/deps`.
