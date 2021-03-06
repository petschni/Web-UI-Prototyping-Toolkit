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

var path = require("path");
var fs = require("fs");
var wrench = require("wrench");
var jqueryRunner = require("./jqueryRunner");
var lessCompiler = require("./lessCompiler");
var utils = require("./utils");

var logger = utils.createLogger({sourceFilePath : __filename});

function Builder(args) {
    var project, composer, ignoreExcludeFromBuild, targetDir, runtime;
    var cleanupCompiledHtml = true;

    function isFilePath(path) {
        return runtime.isExistingFilePath(path);
    }

    function copyDep(source, target) {
        if (source === runtime.constructProjectPath("")) {
            throw new Error("Trying to copy project dir to " + target);
        }
        logger.info("copy " + source + " = > " + target);
        if (!runtime.isExistingPath(source)) {
            logger.error("NON EXISTING: " + source);

            throw new Error("Non existing path! " + source);
        }
        utils.ensureParentDirExists(target);
        if (isFilePath(source)) {
            logger.info("Copying FILE " + source + " => " + target);


            runtime.writeFile(target, runtime.readFile(source) + "")
        } else {
            logger.info("Copying DIR " + source + " => " + target);
            wrench.copyDirSyncRecursive(source, target, {
                forceDelete: true, // Whether to overwrite existing directory or not
                excludeHiddenUnix: false, // Whether to copy hidden Unix files or not (preceding .)
                preserveFiles: false,  // If we're overwriting something and the file already exists, keep the existing
                preserveTimestamps: true, // Preserve the mtime and atime when copying files
                inflateSymlinks: false // Whether to follow symlinks or not when copying files
//                filter: regexpOrFunction, // A filter to match files against; if matches, do nothing (exclude).
//                whitelist: bool, // if true every file or directory which doesn't match filter will be ignored
//                include: regexpOrFunction, // An include filter (either a regexp or a function)
//                exclude: regexpOrFunction // An exclude filter (either a regexp or a function)
            });

        }
    }

    function createCopySourceFromTargetPath(absoluteTargetDepUrl){
        var copySource;
        var atdu = absoluteTargetDepUrl;
        var td = targetDir;
        var withoutTargetDir = atdu.substring(td.length);
        var bowerTargetPrefix = (td + "/ps/ext/");
        var nodeTargetPrefix = (td + "/ps/nm/");
        var internalDepTargetPrefix = td + "/ps/";
        if(atdu.indexOf(bowerTargetPrefix) === 0){
            var bowerDepName = atdu.substring(bowerTargetPrefix.length, atdu.indexOf('/', bowerTargetPrefix.length));
            copySource = runtime.constructAppPath(['bower_components', bowerDepName]);
        }else if(atdu.indexOf(nodeTargetPrefix) === 0){
            var nodeDepName = atdu.substring(nodeTargetPrefix.length, atdu.indexOf('/', nodeTargetPrefix.length));
            copySource = runtime.constructAppPath(['node_modules', nodeDepName]);
        }else if(atdu.indexOf(internalDepTargetPrefix) === 0){
            var internalDepDirname = atdu.substring(internalDepTargetPrefix.length, atdu.indexOf('/', internalDepTargetPrefix.length));
            copySource = runtime.constructAppPath(['core', internalDepDirname]);

        }else if(atdu.indexOf(td + "/ps/dynamic/") === 0){
            throw new Error("todo: build dynamic resources: " + atdu);
        }else if(runtime.isNamedPathUrlPathname(withoutTargetDir)){
            var npName = runtime.resolveUrlPathnameToNamedPathName(withoutTargetDir);
            var np = runtime.getNamedPath(npName);
            copySource = np.path;
        }else if(runtime.isProjectFileUrlPathname(withoutTargetDir)){
            var projectSource;
            var secondSlash  = withoutTargetDir.indexOf('/', 1);
            var projectChild;
            if(secondSlash > 0){
//                projectChild = withoutTargetDir.substring(1, secondSlash);
                projectChild = path.dirname(withoutTargetDir).substring(1);//withoutTargetDir.substring(1, secondSlash);
            }else{
                projectChild = withoutTargetDir.substring(1);
            }
            projectSource = runtime.constructProjectPath(projectChild);
            copySource = projectSource;
        }else{
            throw new Error("Uncategorized source file target url path : " + atdu);
        }
        return copySource;
    }

    function createCopyTargetFromTargetPath(absoluteTargetDepUrl){
        var copyTarget;
        var atdu = absoluteTargetDepUrl;
        var td = targetDir;
        var withoutTargetDir = atdu.substring(td.length);
        var bowerTargetPrefix = (td + "/ps/ext/");
        var nodeTargetPrefix = (td + "/ps/nm/");
        var internalDepTargetPrefix = td + "/ps/";
        if(atdu.indexOf(bowerTargetPrefix) === 0){
            var bowerDepName = atdu.substring(bowerTargetPrefix.length, atdu.indexOf('/', bowerTargetPrefix.length));
            copyTarget = bowerTargetPrefix + bowerDepName;
        }else if(atdu.indexOf(nodeTargetPrefix) === 0){
            var nodeDepName = atdu.substring(nodeTargetPrefix.length, atdu.indexOf('/', nodeTargetPrefix.length));
            copyTarget = nodeTargetPrefix + nodeDepName;
        }else if(atdu.indexOf(internalDepTargetPrefix) === 0){
            var internalDepDirname = atdu.substring(internalDepTargetPrefix.length, atdu.indexOf('/', internalDepTargetPrefix.length));
            copyTarget = internalDepTargetPrefix + internalDepDirname;
        }else if(atdu.indexOf(td + "/ps/dynamic/") === 0){
            throw new Error("todo: build dynamic resources: " + atdu);
        }else if(runtime.isNamedPathUrlPathname(withoutTargetDir)){
            var npName = runtime.resolveUrlPathnameToNamedPathName(withoutTargetDir);
            var np = runtime.getNamedPath(npName);
            copyTarget = td + np.url
        }else if(runtime.isProjectFileUrlPathname(withoutTargetDir)){
            var secondSlash  = withoutTargetDir.indexOf('/', 1);

            var projectChild;
            if(secondSlash > 0){
                projectChild = path.dirname(withoutTargetDir);
            }else{
                projectChild = withoutTargetDir;
            }
            copyTarget = td + projectChild;
        }else{
            throw new Error("Uncategorized source file target url path : " + atdu);
        }
        return copyTarget;
    }

    // for each dependency (file necessary for properly viewing built project)
    // sourceFile, targetFile, projectPath, targetDir, type (namedpath, project, appfile, ..)

    function copyDependencyDirs(absoluteTargetDepUrl, copiedDirPathsMap){
        var subPart = absoluteTargetDepUrl.substring(targetDir.length+1);
        if(!runtime.isNamedPathUrlPathname('/' + subPart)){
            var projEquivPath = runtime.constructProjectPath(subPart);
            var lessEquiv = projEquivPath.substring(0, projEquivPath.lastIndexOf('.')) + ".less";
            if(projEquivPath.indexOf('.css') === (projEquivPath.length - 4) && !runtime.isExistingFilePath(projEquivPath) && runtime.isExistingFilePath(lessEquiv)){

                lessCompiler.compile(lessEquiv, [path.dirname(lessEquiv) + ""], "" + runtime.readFile(lessEquiv), runtime.constructProjectPath(""), function (css, sourceMap, depPaths) {
                    ensureWriteCss(absoluteTargetDepUrl, css, sourceMap, depPaths);
                });
                return ;
            }
        }

        logger.info("initiate copy dep for target path " + absoluteTargetDepUrl);
        var atdu = absoluteTargetDepUrl;

        if(absoluteTargetDepUrl.indexOf("://") > 0 || absoluteTargetDepUrl.indexOf("//") === 0){
            logger.info("Not copying external url : " + absoluteTargetDepUrl);
            return;
        }
        if(atdu.indexOf("ps:/") === 0){
            atdu = targetDir + atdu.substring(3);
            logger.info("Corrected ps:attr absolute path " + absoluteTargetDepUrl + " -> " + atdu);
        }else if(absoluteTargetDepUrl.indexOf("ps:") === 0){
            var npNameEndSlash = absoluteTargetDepUrl.indexOf('/', 4);
            var npNamePotential = absoluteTargetDepUrl.substring(3, npNameEndSlash);
            logger.info("NAMED PATH POTENTIAL : " + npNamePotential);
            if(runtime.isNamedPathName(npNamePotential)){
                atdu = targetDir + runtime.getNamedPath(npNamePotential).url + absoluteTargetDepUrl.substring(npNameEndSlash);
                logger.info("Corrected named path in ps:attr from " + absoluteTargetDepUrl + " -> " + atdu);
            }else{
                throw new Error("Add handling for non-named-link non root ps: link attrs! " + absoluteTargetDepUrl);
            }

        }else  if(atdu.indexOf('./') === 0 || atdu.indexOf('../') === 0){
            throw new Error("TODO relative support : " + atdu);
        } else if(atdu.indexOf('/') !== 0){
            if(runtime.isNamedPathName(atdu.substring(0, atdu.indexOf('/')))){
                atdu = targetDir + '/' + atdu;//.substring(atdu.indexOf('/')+1);
            }else{
                logger.warn("not handling RELATIVE URL : " + atdu);
                return;
            }
        }else if(absoluteTargetDepUrl.indexOf(targetDir) !== 0){
            atdu = targetDir + absoluteTargetDepUrl;
        }

        if (atdu.indexOf(".less?compile") > 0) {
            var urlPathname = atdu.substring(targetDir.length, atdu.length-8);
            var targetPath = atdu.substring(0, atdu.length-8);
            var sourceFilePath = runtime.findFileForUrlPathname(urlPathname);
            if(!copiedDirPathsMap.hasOwnProperty(sourceFilePath)){
                copiedDirPathsMap[sourceFilePath] = targetPath;
                lessCompiler.compile(sourceFilePath, [path.dirname(sourceFilePath) + ""], "" + runtime.readFile(sourceFilePath), runtime.constructProjectPath(""), function (css, sourceMap, depPaths) {
                    var cssTargetPath = targetPath; //targetDir + "/ps/nm/" + u;
                    ensureWriteCss(cssTargetPath, css, sourceMap, depPaths);
                });
            }else{
                logger.info("Already compiled less " + sourceFilePath + " -> " + targetPath);
            }
        }else{
            var copySource = createCopySourceFromTargetPath(atdu);
            var copyTarget = createCopyTargetFromTargetPath(atdu);

            if(!copiedDirPathsMap.hasOwnProperty(copySource)){
                copiedDirPathsMap[copySource] = copyTarget;
                copyDep(copySource, copyTarget)
            }else{
                logger.info("Already copied " + copySource + " -> " + copyTarget);
            }
        }
    }

    var modifyBuiltMarkupWithJQuery = function ($, window) {
        jqueryRunner.assignUniqueIdsToEditables($);
        if (!ignoreExcludeFromBuild) {
            jqueryRunner.removeMarkupIgnoredForBuild($);
        }
        jqueryRunner.processProtostarAttributes($, function(attrName, attrVal){
            return runtime.determineProtostarAttributeValue(attrName, attrVal, targetDir);
        });
        $("*[data-editable]").attr("contenteditable", "false");
        jqueryRunner.convertAbsoluteToTargetReferences($, targetDir);
        /*metadata.templateTargetPath = createTargetPathForTemplate(metadata.templatePath)
        metadata.targetDir = targetDir;
        jqueryRunner.createPageRelativeReferences($, targetDir, metadata);*/
//        return '<!doctype html>\n' + $("html")[0].outerHTML;
        var doctype = '<!doctype html>';
        return doctype + '\n' + window.document.documentElement.outerHTML; //$("html")[0].outerHTML;
    };

    var modifyBuiltMarkupToRelativeWithJQuery = function ($, window, metadata) {
        jqueryRunner.assignUniqueIdsToEditables($);
        if (!ignoreExcludeFromBuild) {
            jqueryRunner.removeMarkupIgnoredForBuild($);
        }
        jqueryRunner.processProtostarAttributes($, function(attrName, attrVal){
            return runtime.determineProtostarAttributeValue(attrName, attrVal, targetDir);
        });
        $("*[data-editable]").attr("contenteditable", "false");
        jqueryRunner.convertAbsoluteToTargetReferences($, targetDir);
        metadata.templateTargetPath = createTargetPathForTemplate(metadata.templatePath);
         metadata.targetDir = targetDir;
         jqueryRunner.createPageRelativeReferences($, targetDir, metadata);
//        return '<!doctype html>\n' + $("html")[0].outerHTML;
        var doctype = '<!doctype html>';
        return doctype + '\n' + window.document.documentElement.outerHTML; //$("html")[0].outerHTML;
    };




    var postProcessComposed = function (markup, done) {
        if(markup.content.trim().length > 1){
            jqueryRunner.runJQuery(markup.content, modifyBuiltMarkupWithJQuery, function (result, errors, window) {
                var args = {};
                if (typeof window.args === 'object') {
                    args = window.args;
                }
                done(result, errors, args);
            }, markup.metadata);
        }else{
            done(markup.content, null, undefined);
        }

    };
    var postProcessComposedForRelative = function (markup, done) {
        if(markup.content.trim().length > 1){
            jqueryRunner.runJQuery(markup.content, modifyBuiltMarkupToRelativeWithJQuery, function (result, errors, window) {
                var args = {};
                if (typeof window.args === 'object') {
                    args = window.args;
                }
                done(result, errors, args);
            }, markup.metadata);
        }else{
            done(markup.content, null, undefined);
        }
    };

    var targetDirExists = function(){
        var exists = false;
        if (runtime.isExistingPath(targetDir)) {
            if(runtime.isExistingDirPath(targetDir)){
                exists = true;
            }else{
                throw new Error("Build targetDir path exists but it's no directory: " + targetDir);
            }
        }
        return exists;
    };

    var emptyTargetDir = function(){
        var files = runtime.listDir(targetDir);
        files.forEach(function (f) {
            var fp = targetDir + "/" + f;
            if (runtime.isExistingDirPath(fp)) {
                wrench.rmdirSyncRecursive(fp, false);
            } else {
                runtime.deleteFile(fp);
            }
        });
        logger.info("Emptied " + targetDir);
    };

    function ensureWriteCss(targetPath, css, sourceMap, deps) {
        utils.ensureParentDirExists(targetPath);
        logger.info("Writing css to " + targetPath);
        runtime.writeFile(targetPath, "" + css);
        if(targetPath.indexOf('.less') === (targetPath.length-5)){
            var dir = path.dirname(targetPath);
            var baseFileName = path.basename(targetPath);
            baseFileName= baseFileName.substring(0, baseFileName.lastIndexOf('.'));
            var basePath = dir + '/' + baseFileName;
            var cssPath = basePath +  ".css";
            runtime.writeFile(cssPath, "" + css);
            var sourceMapPath = basePath +  ".css.map";

            runtime.writeFile(sourceMapPath, "" + sourceMap);
            if(deps){
                runtime.writeFile(basePath + ".deps.json", JSON.stringify(deps));
                //logger.info("Wrote deps to " + )
            }
        }else if(targetPath.indexOf('.css') === (targetPath.length - 4)){
//            var dir = path.dirname(targetPath);
//            var baseFileName = path.basename(targetPath);
//            baseFileName= baseFileName.substring(0, baseFileName.lastIndexOf('.'));
//            var basePath = dir + '/' + baseFileName;
            var cssPath = targetPath;
            runtime.writeFile(cssPath, "" + css);
            var sourceMapPath = targetPath + ".map";

            runtime.writeFile(sourceMapPath, "" + sourceMap);
            if(deps){
                runtime.writeFile(targetPath + ".deps.json", JSON.stringify(deps));
                //logger.info("Wrote deps to " + )
            }
        }

    }

    var createConcatHtmlDocument = function(htmlDocumentMarkups){
        var concat = "";
        htmlDocumentMarkups.forEach(function (doc) {
            concat += doc;
        });
        concat = concat.replace(new RegExp('\\<!doctype[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<!DOCTYPE[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<html[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\</html\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<head[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\</head\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<body[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\</body\\>', 'g'), '');
        return concat;
    };

    var createTargetPathForTemplate = function(templatePath){
        return targetDir + runtime.createUrlPathForFile(templatePath);
    };

    var copyProjectDependencies = function(){
        var projectConfig = runtime.readProjectConfig();
        if(utils.nestedPathExists(projectConfig, "build", "resourceDirs", "project") && utils.getObjectType(projectConfig.build.resourceDirs.project) === 'Array'){
            projectConfig.build.resourceDirs.project.forEach(function(projPath){
                copyDep(runtime.constructProjectPath(projPath), targetDir + "/" + projPath);
            });
        }
    };

    var finalRun = function(compiledTemplates, callBack){
        var outFiles = [];
        for (var tp in compiledTemplates) {
            var ct = compiledTemplates[tp];
            outFiles.push(ct);
            var targetFilePath = createTargetPathForTemplate(ct.path);//"/" + ct.name;
            runtime.mkdirs(path.dirname(targetFilePath));
            logger.info("Writing file to " + targetFilePath);
            if (cleanupCompiledHtml) {
                logger.info("Removing comments from " + path.basename(targetFilePath));
                var removedComments = utils.removeAllHtmlComments(ct.compiled);
                logger.info("Beautifying " + path.basename(targetFilePath));
                var beautified = utils.beautifyHtml(removedComments);
                runtime.writeFile(targetFilePath, beautified);
            } else {
                runtime.writeFile(targetFilePath, ct.compiled);
            }
            logger.info("Wrote built file " + targetFilePath);
        }
        callBack(outFiles);
    };


    var afterPostProcessing = function(compiledTemplates, callBack){
        var outFiles = [];
        for (var tp in compiledTemplates) {
            var ct = compiledTemplates[tp];
            outFiles.push(ct);
            var targetFilePath = createTargetPathForTemplate(ct.path);//"/" + ct.name;
            runtime.mkdirs(path.dirname(targetFilePath));
            if(false){
                logger.info("Writing file to " + targetFilePath);
                if (cleanupCompiledHtml) {
                    logger.info("Removing comments from " + path.basename(targetFilePath));
                    var removedComments = utils.removeAllHtmlComments(ct.compiled);
                    logger.info("Beautifying " + path.basename(targetFilePath));
                    var beautified = utils.beautifyHtml(removedComments);
                    runtime.writeFile(targetFilePath, beautified);
                } else {
                    runtime.writeFile(targetFilePath, ct.compiled);
                }
                logger.info("Wrote built file " + targetFilePath);
            }
        }
        var markups = [];
        outFiles.forEach(function (of) {
            markups.push(of.compiled);
        });
        var concat = createConcatHtmlDocument(markups);
        jqueryRunner.runJQuery(concat, function ($, window) {
            var config = {
                script:"src",
                link:"href",
                img:"src"
            };
            return jqueryRunner.collectReferenceAttributeValues($, config);
        }, function (result, errors, window) {
            logger.info("Found unique dependency links in pages : ", result);
            var out = result;
            runtime.mkdir(targetDir + "/ps");
            runtime.mkdir(targetDir + "/ps/ext");
            runtime.mkdir(targetDir + "/ps/assets");
            runtime.mkdir(targetDir + "/ps/nm");
            copyProjectDependencies();
            var copiedMap = {};
            for (var scriptDepUrl in out.script) {
                copyDependencyDirs(scriptDepUrl, copiedMap);
            }
            for (var linkDepUrl in out.link) {
                copyDependencyDirs(linkDepUrl, copiedMap);
            }
            for (var imgDepUrl in out.img) {
                copyDependencyDirs(imgDepUrl, copiedMap);
            }
            makeBuildRelative(compiledTemplates, callBack);

            compileThemes();

        });
    };

    var compileThemes = function(){
        var projectConfig = runtime.readProjectConfig();
        if(utils.nestedPathExists(projectConfig, "theming", "enabled") && typeof projectConfig.theming.enabled === 'boolean' && projectConfig.theming.enabled){
            var entryPoint = project.resolveProjectFile(projectConfig.theming.entryPoint);
            var themeNames = projectConfig.theming.themeNames;
            var defaultThemeName = projectConfig.theming.defaultThemeName;
            var themeNameVar = projectConfig.theming.themeNameVar;
            var compileThemes = projectConfig.theming.compileThemes;
            var compileDefaultThemeOnly = projectConfig.theming.compileDefaultThemeOnly;

            logger.info("DEFAULT THEME NAME = " + defaultThemeName);
            logger.info("ENTRY POINT = " + entryPoint);
            themeNames.forEach(function(n, i){
                logger.info("THEME NAME = " + n);
                lessCompiler.compile(entryPoint, [path.dirname(entryPoint) + ""], "" + runtime.readFile(entryPoint), runtime.constructProjectPath(""), function (css, sourceMap, depPaths) {
                    logger.info("Finished compiling THEME = " + n);
                    var cssTargetPath = targetDir + "/" + projectConfig.theming.entryPoint; //targetDir + "/ps/nm/" + u;
                    ensureWriteCss(cssTargetPath + "-" + n + ".css", css, sourceMap, depPaths);
                }, undefined, {
                    globalVars: {themeName:n},
                    modifyVars: {themeName:n}
                });
            });
        }
    };

    var prepareTargetDirectory = function(){
        if (targetDirExists()) {
            if(!runtime.isExistingFilePath(path.join(targetDir, ".protostar-project-built"))){
                throw new Error("targetDir probably wasnt created by protostar (doesnt contain file .protostar-project-built) so refusing to delete/overwrite! " + targetDir);
            }
            emptyTargetDir();
            runtime.writeFile(path.join(targetDir, ".protostar-project-built"), "This directory is created by building a Protostar prototype so can be overwritten by protostar.");
        } else {
            logger.info("Created " + targetDir);
            runtime.mkdirs(targetDir);
            runtime.writeFile(path.join(targetDir, ".protostar-project-built"), "This directory is created by building a Protostar prototype so can be overwritten by protostar.");
        }
    };

    var shouldIncludeNamedPathsInCompilation = function(projectConfig){
        var includeNamedPathsInCompilation = false;
        if(utils.nestedPathExists(projectConfig, "build", "includeNamedPaths") && utils.hasPropertyOfType(projectConfig.build, "includeNamedPaths", "Boolean")){
            includeNamedPathsInCompilation = projectConfig.compilation.includeNamedPaths;
            logger.info("Include named paths in compilation? " + includeNamedPathsInCompilation);
        }
        return includeNamedPathsInCompilation;
    };

    var determineExcludedPaths = function(projectConfig){
        var excludedPaths = [];
        if(utils.nestedPathExists(projectConfig, "build", "excludedPaths") && utils.hasPropertyOfType(projectConfig.build, "excludedPaths", "Array")){
            projectConfig.build.excludedPaths.forEach(function(ep){
                var excludedPath;
                if(ep.indexOf("/") === 0){
                    excludedPath = ep;
                }else{
                    excludedPath = path.normalize(runtime.constructProjectPath(ep));
                }
                logger.info("Excluding path from build: " + excludedPath);
                excludedPaths.push(excludedPath);
            });
        }
        return excludedPaths;
    };

    var buildPrototype = function (callBack) {
        project.updateDynamic();
        prepareTargetDirectory();
        var projectConfig = runtime.readProjectConfig();
        var includeNamedPathsInCompilation = shouldIncludeNamedPathsInCompilation(projectConfig);
        var templates = project.listAllTemplatePaths();
        var excludedPaths = determineExcludedPaths(projectConfig);
        var compiledTemplates = {};
        var count = 0;
        var relativeCount = 0;
        templates.forEach(function (pagePath) {
            var includePage = true;
            excludedPaths.forEach(function(ep){
                if(pagePath.indexOf(ep) === 0){
                    includePage = false;
                }
            });
            if(includePage && (includeNamedPathsInCompilation || !runtime.isNamedPathChild(pagePath))){
                var pageContents = runtime.readFile(pagePath);

                if(pageContents.indexOf('{%') < 0 && pageContents.indexOf('%}')){
                    var pageContentsCompiled = composer.composeTemplate(pagePath, pageContents);
                    logger.debug("Compiled for build: " + pagePath + " with metadata:", pageContentsCompiled.metadata);
                    postProcessComposed(pageContentsCompiled, function (pageContentsPostProcessed) {
                        compiledTemplates[pagePath] = {
                            name: pagePath,
                            path: pagePath,
                            compiled: pageContentsPostProcessed,
                            pageContents: pageContents,
                            pageContentsCompiled: pageContentsCompiled,
                            pageContentsPostProcessed: pageContentsPostProcessed
                        };
                        count += 1;
                        if (count === templates.length) {
                            logger.info("DONE all " + templates.length + " templates are compiled!");
                            afterPostProcessing(compiledTemplates, callBack);
                        }
                    });
                }else{
                    logger.info("Not building file with jekyll directives: " + pagePath);
                }

            }else{
                logger.info("Not including page template in named path: " + pagePath);
                count +=1;
                relativeCount+=1;
            }
        });
    };

    var makeBuildRelative = function(compiledTemplates, callBack){
        var relativeCount = 0;
        var allTemplatePaths = Object.keys(compiledTemplates);
        console.log("TEMPLATE PATHS FOR RELATIVE : ", allTemplatePaths);
        var totalCount = allTemplatePaths.length;
        var results = {};
        allTemplatePaths.forEach(function(templatePath){
            var ct = compiledTemplates[templatePath];
            postProcessComposedForRelative(ct.pageContentsCompiled, function(contentsPostProcessedRelative){
                results[templatePath] = {
                    path : templatePath,
                    compiled : contentsPostProcessedRelative
                };
                relativeCount +=1;
                if(totalCount === relativeCount){
                    console.info("WEVE RUN EM ALL " + totalCount);
                    finalRun(results, callBack);
                }
            });
        });
    };

    this.buildPrototype = buildPrototype;

    var parseArgs = function (args) {
        runtime = args.runtime;
        project = args.project;
        composer = args.composer;
        targetDir = runtime.getTargetDirPath();
        ignoreExcludeFromBuild = args.ignoreExcludeFromBuild || false;
    };
    parseArgs(args);
}

module.exports = {
    createBuilder: function (args) {
        return new Builder(args);
    }
};