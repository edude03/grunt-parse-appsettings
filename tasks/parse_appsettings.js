/*
 * grunt-parse-appsettings
 * https://github.com/edude03/parse-appsettings
 *
 * Copyright (c) 2014 Michael Francis
 * Licensed under the MIT license.
 */

'use strict';

var vm = require('vm'),
    fs = require('fs-extra'),
    crypto = require('crypto'),
    util = require('util'),
    path = require('path'),
    async = require('async'),
    done,
    config,
    _grunt; 



var require = function() {
    //There is a performance hit for leaking arguments
    //but that's probably insignificant
    /* 
       Save the arguments on this function for later 
       retrieval, similar to this.foo = bar 
    */
    require._require = [].slice.call(arguments);
}

require.config = function(config) {
    //console.log('from config', arguments);
    this._config = config;
}

/**
 * cleans up the output of converting a function to a string then serializing it
 * by replacing the escaped control characters
 * such as '\n' (newline) and replacing them with their non-escaped
 * equivelants
 * @param  {String} fn  a string in the form of functionName: 'function(){}'
 * @return {String}     A string with the control charcters and quotes removed
 *                      like functionName: function() {}
 */
var cleanFn = function(fn) {
    //First split the function into name and value
    var out = fn.match(RegExp(/(.*):\s?'(.*)'/)),
        name = out[1],
        val = out[2];

    /* Clean up the function part to remove all the newlines and such */
    //Things to replace
    var replacements = {
        '\\\\n': "\n",
        '\\\\r': "\r",
        '\\\\t': "\t",
    }

    //For each replacement
    for (var r in replacements) {
        //Perform the replacement
        val = val.replace(RegExp(r, 'g'), replacements[r]);
    }

    //Finally, compose it back into a string and return
    return util.format("%s: %s", name, val);
}

var writeFile = function(err, newPaths) {
    var output = "";

    //Replace the updated paths
    sandbox.require._config.paths = newPaths;


    sandbox.require._config.config.text.onXhrComplete = sandbox.require._config.config.text.onXhrComplete.toString();

    var requireConfig = util.format("require.config(%s);", util.inspect(sandbox.require._config, {depth: 10}));
    var requireFn = util.format("require(%s, %s)", util.inspect(sandbox.require._require[0]), sandbox.require._require[1].toString());
    var fnRegex = /onXhrComplete:\s?'function(.*)'/;
    var fn = requireConfig.match(fnRegex)[0];

    requireConfig = requireConfig.replace(fnRegex, cleanFn(fn));
    output = output.concat(requireConfig, '\n', requireFn);

   
    //Pass the new name of appsettings back to grunt
    _grunt.config.set('appsettings', {
        fileName: appsettingsName + '.js'
    });
    
    //Write the output to a file and call the grunt 
    //done function to signal we're finished.
    fs.writeFile('../build-tmp/js/core/appsettings.js', output, done);
}


var sandbox = {
    require: require
}


module.exports = function(grunt) {
    grunt.registerMultiTask('parse-appsettings', 'Parses a require.js data-main file', function() {
        //Signal grunt that this task is async, and get a callback to 
        //call when it's done
        done = this.async();
        _grunt = grunt;

        //Read Appsettings in from the disk
        fs.readFile('../build-tmp/js/core/appsettings.js', 'utf8', function(err, data) {
            if (err) {throw err}
            //Excute the appsettings inside a sandbox so we can extract
            //the data that's normally passed to require() and require.config()
            vm.runInNewContext(data, sandbox, 'appsettings.js');

            var paths = sandbox.require._config.paths,
                pathArr = [];

            //Convert the object into an array of objects so we can reduce it easily
            for (var moduleName in paths) {
                var module = {};

                module[moduleName] = paths[moduleName];

                pathArr.push(module);
            }

            /**
             * Takes each {moduleName, modulePath}, computes the sha1 hash
             * of the module, renames it and updates the name in the hash
             *
             * @param  {Object}   newPaths An Object whose keys are the module name, and
             *                             values are the path to the module without the
             *                             trailing .js
             *
             * @param  {Object}   pathObj  {moduleName, modulePath} tuples
             * @param  {Function} callback Called when the current interation is done
             */
            async.reduce(pathArr, {}, function(newPaths, pathObj, callback) {
                var moduleName = Object.keys(pathObj)[0],
                    modulePath = pathObj[moduleName],
                    modPath = util.format('./%s.js', modulePath);

                fs.readFile(modPath, 'utf8', function(err, contents) {
                    //If err, call the callback with no change to the paths)
                    //This file will be excluded from the output, 
                    if (err) {
                        callback(null, newPaths);
                        return;
                    }

                    //Calculate the SHA1 hash of the file
                    var hashSum = crypto.createHash('sha1').update(contents);

                    //Convert the hash to hex and only use the first 8 chars of the hash
                    var hash = hashSum.digest('hex').substr(0, 8);

                    //The directory the module is in
                    var basePath = path.dirname(modPath),
                        //The current name of module (including the .js)
                        oldName = path.basename(modPath),

                        //The new name of the file including the hash
                        newName = util.format('%s.%s', hash, oldName),

                        //The output directory
                        outputDir = '../build-tmp';

                    fs.rename(path.join(outputDir, basePath, oldName), path.join(outputDir, basePath, newName));
                    //console.log(oldName, newName);

                    //Remove the '.js' from the end
                    var newPath = path.join(basePath, newName.slice(0, -3));
                    newPaths[moduleName] = newPath;

                    //Tell Async we're done this interation
                    callback(null, newPaths);
                });
            }, writeFile)
        })

    });

};
