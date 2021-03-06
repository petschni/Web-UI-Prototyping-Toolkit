/**
 * Copyright 2014 IBM Corp.
 * 
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

"use strict";
var less = require("less");
var path = require("path");
var utils = require("./utils");
var fs = require("../node_modules/less/lib/less/fs");

var logger = utils.createLogger({sourceFilePath : __filename});

var createDefaultOptions = function(){
    var options = {
        depends: false,
        compress: false,
        cleancss: false,
        max_line_len: -1,
        optimization: 1,
        silent: false,
        verbose: false,
        lint: false,
        paths: [],
        color: true,
        strictImports: false,
        insecure: false,
        rootpath: '',
        relativeUrls: false,
        ieCompat: true,
        strictMath: false,
        strictUnits: false,
        globalVariables: '',
        modifyVariables: '',
        urlArgs: ''
    };
    return options;
};

var checkArgFunc = function(arg, option) {
    if (!option) {
        throw new Error(arg + " option requires a parameter");
    }
    return true;
};

var checkBooleanArg = function(arg) {
    var onOff = /^((on|t|true|y|yes)|(off|f|false|n|no))$/i.exec(arg);
    if (!onOff) {
        throw new Error(" unable to parse "+arg+" as a boolean. use one of on/t/true/y/yes/off/f/false/n/no");
    }
    return Boolean(onOff[2]);
};

var parseVariableOption = function(option) {
    var parts = option.split('=', 2);
    return '@' + parts[0] + ': ' + parts[1] + ';\n';
};

var processArg = function(arg, options, cleancssOptions){
    switch (arg) {
        case 'v':
        case 'version':
            throw new Error("lessc " + less.version.join('.') + " (Less Compiler) [JavaScript]");
        case 'verbose':
            options.verbose = true;
            break;
        case 's':
        case 'silent':
            options.silent = true;
            break;
        case 'l':
        case 'lint':
            options.lint = true;
            break;
        case 'strict-imports':
            options.strictImports = true;
            break;
        case 'h':
        case 'help':
            require('../lib/less/lessc_helper').printUsage();
            throw new Error("Help")
        case 'x':
        case 'compress':
            options.compress = true;
            break;
        case 'insecure':
            options.insecure = true;
            break;
        case 'M':
        case 'depends':
            options.depends = true;
            break;
        case 'clean-css':
            options.cleancss = true;
            break;
        case 'max-line-len':
            if (checkArgFunc(arg, match[2])) {
                options.maxLineLen = parseInt(match[2], 10);
                if (options.maxLineLen <= 0) {
                    options.maxLineLen = -1;
                }
            }
            break;
        case 'no-color':
            options.color = false;
            break;
        case 'no-ie-compat':
            options.ieCompat = false;
            break;
        case 'no-js':
            options.javascriptEnabled = false;
            break;
        case 'include-path':
            if (checkArgFunc(arg, match[2])) {
                options.paths = match[2].split(os.type().match(/Windows/) ? ';' : ':')
                    .map(function(p) {
                        if (p) {
                            return path.resolve(process.cwd(), p);
                        }
                    });
            }
            break;
        case 'O0': options.optimization = 0; break;
        case 'O1': options.optimization = 1; break;
        case 'O2': options.optimization = 2; break;
        case 'line-numbers':
            if (checkArgFunc(arg, match[2])) {
                options.dumpLineNumbers = match[2];
            }
            break;
        case 'source-map':
            if (!match[2]) {
                options.sourceMap = true;
            } else {
                options.sourceMap = match[2];
            }
            break;
        case 'source-map-rootpath':
            if (checkArgFunc(arg, match[2])) {
                options.sourceMapRootpath = match[2];
            }
            break;
        case 'source-map-basepath':
            if (checkArgFunc(arg, match[2])) {
                options.sourceMapBasepath = match[2];
            }
            break;
        case 'source-map-map-inline':
            options.sourceMap = true;
            options.sourceMapFileInline = true;
            break;
        case 'source-map-less-inline':
            options.outputSourceFiles = true;
            break;
        case 'source-map-url':
            if (checkArgFunc(arg, match[2])) {
                options.sourceMapURL = match[2];
            }
            break;
        case 'rp':
        case 'rootpath':
            if (checkArgFunc(arg, match[2])) {
                options.rootpath = match[2].replace(/\\/g, '/');
            }
            break;
        case "ru":
        case "relative-urls":
            options.relativeUrls = true;
            break;
        case "sm":
        case "strict-math":
            if (checkArgFunc(arg, match[2])) {
                options.strictMath = checkBooleanArg(match[2]);
            }
            break;
        case "su":
        case "strict-units":
            if (checkArgFunc(arg, match[2])) {
                options.strictUnits = checkBooleanArg(match[2]);
            }
            break;
        case "global-var":
            if (checkArgFunc(arg, match[2])) {
                options.globalVariables += parseVariableOption(match[2]);
            }
            break;
        case "modify-var":
            if (checkArgFunc(arg, match[2])) {
                options.modifyVariables += parseVariableOption(match[2]);
            }
            break;
        case "clean-option":
            var cleanOptionArgs = match[2].split(":");
            switch(cleanOptionArgs[0]) {
                case "--keep-line-breaks":
                case "-b":
                    cleancssOptions.keepBreaks = true;
                    break;
                case "--s0":
                    cleancssOptions.keepSpecialComments = 0;
                    break;
                case "--s1":
                    cleancssOptions.keepSpecialComments = 1;
                    break;
                case "--skip-advanced":
                    cleancssOptions.noAdvanced = true;
                    break;
                case "--advanced":
                    cleancssOptions.noAdvanced = false;
                    break;
                case "--compatibility":
                    cleancssOptions.compatibility = cleanOptionArgs[1];
                    break;
                default:
                    logger.info("unrecognised clean-css option '" + cleanOptionArgs[0] + "'");
                    logger.info("we support only arguments that make sense for less, '--keep-line-breaks', '-b'");
                    logger.info("'--s0', '--s1', '--advanced', '--skip-advanced', '--compatibility'");
                    throw new Error("Incorrect usage");
            }
            break;
        case 'url-args':
            if (checkArgFunc(arg, match[2])) {
                options.urlArgs = match[2];
            }
            break;
        default:
            require('../lib/less/lessc_helper').printUsage();
            throw new Error("Incorrect usage");
    }

};

module.exports = {
    /**
     * Lists all files that are included from passed lessFilePath when compiling
     * Accepts callback fn(depPathsArray, lessFilePath)
     * @param lessFilePath
     * @param fileContents
     * @param callBack
     */
    listDependencies : function(lessFilePath, fileContents, callBack){

        var baseDir = path.dirname(lessFilePath);
        var cssName = lessFilePath.substring(0, lessFilePath.lastIndexOf(".")) + ".css";
        var parserConfig = { depends: true,
            compress: false,
            cleancss: false,
            max_line_len: -1,
            optimization: 1,
            silent: true,
            verbose: false,
            lint: false,
            paths: [ baseDir ],
            color: false,
            strictImports: false,
            insecure: false,
            rootpath: '',
            relativeUrls: false,
            ieCompat: true,
            strictMath: false,
            strictUnits: false,
            globalVariables: '',
            modifyVariables: '',
            urlArgs: '',
            sourceMapOutputFilename: cssName,
            sourceMapBasepath: baseDir,
            filename: lessFilePath
        };
        var start = new Date().getTime();
        var parser = new less.Parser(parserConfig);
        parser.parse('' + fileContents, function (err, tree) {
            var done = new Date().getTime();
            logger.info("Analyzed deps in " + (done - start) + "ms");
            var lessDepPaths = [];
            for(var fp in parser.imports.files){
                lessDepPaths.push(fp);
            }
            logger.info("Parsed dependencies: ", lessDepPaths);
            if(typeof callBack === 'function'){
                callBack(lessDepPaths, lessFilePath);
            }
        });
    },

    compile: function (lessFilePath, lessParentDirs, fileContents, basePath, successFunction, writeFiles, additionalParserArgs) {
        logger.info("Compiling " + lessFilePath + " ...");
        var cssFilePath = lessFilePath.substring(0, lessFilePath.lastIndexOf(".")) + ".css";
        var cssFilename = path.basename(cssFilePath);
        var write = false;
        if(writeFiles){
            write = true;
        }
        var sourceMapName = cssFilename + ".map";
//        var sourceMapURL = cssFilePath.substring(basePath.length) + ".map";
        var sourceMapURL = './' +sourceMapName; //cssFilePath.substring(basePath.length) + ".map";
        var compiledSourceMap, compiledCss;
        var parserArgs = {
            depends: true,
            compress: false,
            cleancss: false,
            max_line_len: -1,
            optimization: 1,
            silent: false,
            verbose: true,
            lint: false,
            paths: lessParentDirs,
            color: false,
            strictImports: false,
            insecure: false,
            relativeUrls: true,
            ieCompat: true,
            strictMath: false,
            strictUnits: false,
//            globalVariables: '@themeNameDynamic:"amelia"',
//            modifyVariables: '@themeName:@themeNameDynamic',
            globalVars: {'themeName':'amelia'},
            modifyVars: {'themeName':'amelia'},
            urlArgs: '',
            outputSourceFiles: true,
//            sourceMapURL : sourceMapURL,
            sourceMapURL : sourceMapURL,
            sourceMappingURL : sourceMapURL,
            sourceMap: sourceMapName,
            sourceMapBasepath: basePath,
            filename: lessFilePath,
            writeSourceMap: function (output) {
                compiledSourceMap = output;
                var filename = sourceMapName;

                if(write){
                    logger.info("Writing source map to  "+ filename + " : "+utils.formatByteSize((output+"").length));
                    fs.writeFile(filename, output, 'utf8');
                }
            }
        };
        var parserConfig = parserArgs;
        var toCssArgs = { silent: false,
            verbose: true,
            ieCompat: true,
            compress: false,
            relativeUrls: true,
            cleancss: false,
            cleancssOptions: {},
            sourceMap: true,
            sourceMapFilename: sourceMapName,
//            sourceMapURL : sourceMapURL,
            sourceMapURL : sourceMapURL,
            sourceMappingURL : sourceMapURL,
            sourceMapOutputFilename: undefined,
            sourceMapBasepath: basePath,
            sourceMapRootpath: '',
            outputSourceFiles: true,
            writeSourceMap: parserArgs.writeSourceMap,
            maxLineLen: undefined,
            strictMath: false,
            strictUnits: false,
            urlArgs: ''
        };
        try {
            var start = new Date().getTime();
            logger.debug("Parsing lesscss " + lessFilePath + " with args:", parserConfig);
            var parser = new less.Parser(parserConfig);
            parser.parse(fileContents, function (err, tree) {
                if(err){
                    logger.error("lesscss parsing error while parsing " + lessFilePath, err);
                    logger.error("lesscss parsing error " + err.filename+":" + err.line + " " + err.extract);
                    throw err;
                }
                try {
                    var lessDepPaths = [];
                    for(var fp in parser.imports.files){
                        lessDepPaths.push(fp);
                    }
                    logger.debug("Creating css from parsed lesscss for" + lessFilePath + " with args:", toCssArgs);
                    var csscode = tree.toCSS(toCssArgs);
                    compiledCss = csscode;
                    var taken = (new Date().getTime() - start);
                    logger.info("Compiled "+lessFilePath+" in " + taken + "ms");
                    if(write){
                        logger.info("Writing css to  "+ cssFilePath + " : "+utils.formatByteSize((compiledCss+"").length));
                        fs.writeFile(cssFilePath, compiledCss+"");
                        fs.writeFile(cssFilePath+".map", compiledSourceMap+"");
                    }
                    if (typeof successFunction === 'function') {
                        try {
                            successFunction(csscode, compiledSourceMap, lessDepPaths);
                        } catch (SuccessFunctionError) {
                            logger.error("Error in successFunction", SuccessFunctionError);
                            console.trace(SuccessFunctionError);
                            throw new Error(SuccessFunctionError);
                        }
                    }
                } catch (ParseToCssError) {
                    logger.error("Could not parse to css " + lessFilePath, ParseToCssError);
                    console.trace(ParseToCssError);
                    throw new Error(ParseToCssError);
                }
            }, additionalParserArgs);
        } catch (LessCompilerError) {
            logger.error("LESS COMPILER ERROR FOR " + lessFilePath, arguments);
            var lce = LessCompilerError;
            logger.error(lce.type + " error in " + lce.filename + ":"+lce.line+","+lce.column+" :  " + lce.message);
            console.trace(LessCompilerError);
//            throw LessCompilerError;
            successFunction('body{background-color:#FF0000 !important;}', '', []);
        }
    }
};

