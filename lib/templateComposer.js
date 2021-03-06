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

var fs = require("fs"), path = require("path"), utils = require("./utils");

var logger = utils.createLogger({sourceFilePath : __filename});

function Placeholder(args) {
    this.name = args.name;
    this.type = args.type;
    this.start = args.start;
    this.end = args.end;
    this.tag = args.tag;
    this.args = args.args;
    if (!args.hasOwnProperty('filepath')) {
        throw new Error("missing filepath");
    }
    this.filepath = args.filepath;
}


function TemplateComposer(args) {
    var runtime;
    var dropPointTypes, dropPointPrefixes, maxCompilationRuns = 100;

    var dropPointPrefix = '<!-- ';
    var dropPointPostfix = ' -->';
    var dropPointSeparatorName = ':';
    var dropPointSeparatorArgs = ',';

    var parseArgs = function (args) {
        runtime = args.runtime;
        var uc = runtime.readUserConfig();
        dropPointTypes = uc.dropPointTypes;
        maxCompilationRuns = uc.maxCompilationRuns;
    };

    var createPlaceholder = function (args) {
        var ph = new Placeholder(args);
        if (runtime.isDebug()) {
            logger.info("Constructed placeholder: ", ph);
        }
        if (ph.name.indexOf('=') > 0) throw new Error();
        return ph;
    };

    function findDropPoints(filepath, content, partType) {
        if (arguments.length !== 3) {
            throw new Error('findDropPoints requires 3 args');
        }
        var contents = '' + content;
        var crit = dropPointPrefix + partType + dropPointSeparatorName;
        var dropPointNames = [];
        var startIdx = 0;
        var result;
        while ((result = contents.indexOf(crit, startIdx)) >= 0) {
            var end = contents.indexOf(dropPointPostfix, result);
            var name = contents.substring(result + crit.length, end);
            var type = partType;
            if (type === 'content') {
                var contentColonIdx = name.indexOf(dropPointSeparatorName);
                var contentNameOnly;
                if (contentColonIdx > 0) {
                    contentNameOnly = name.substring(0, contentColonIdx);
                } else {
                    contentNameOnly = name;
                }
                var dpargs = undefined;
                if (contentNameOnly.indexOf('(') > 0) {
                    dpargs = [contentNameOnly.substring(contentNameOnly.indexOf('(') + 1, contentNameOnly.length - 1)];
                    contentNameOnly = contentNameOnly.substring(0, contentNameOnly.indexOf('('));
                }

                dropPointNames.push(createPlaceholder({
                    name: contentNameOnly,
                    start: result,
                    end: end + 4,
                    type: partType,
                    tag: content.substring(result, end + 4),
                    filepath: filepath,
                    args: dpargs
                }));
            } else if (type === "layout" || type === "wrap") {
                if (name.charAt(name.length - 1) === ')') {
                    var layoutArgsText = name.substring(name.indexOf('(') + 1, name.length - 1);
                    var layoutArgs = layoutArgsText.split(';');
                    var foundByName = false;
                    var allByName = true;
                    layoutArgs.forEach(function (a) {
                        if (a.indexOf('=') >= 0) {
                            foundByName = true;
                        } else {
                            allByName = false;
                        }
                    });
                    if (foundByName !== allByName) {
                        throw new Error("All or none of the droppoints should be assigned by name : layout:" + name);
                    }
                    dropPointNames.push(createPlaceholder({
                        name: name.substring(0, name.indexOf('(')),
                        start: result,
                        end: end + 4,
                        type: partType,
                        tag: content.substring(result, end + 4),
                        filepath: filepath,
                        args: layoutArgs
                    }));
                } else {
                    var colonIdx = name.indexOf(dropPointSeparatorName);
                    var nameOnly;
                    if (colonIdx > 0) {
                        nameOnly = name.substring(0, colonIdx);
                    } else {
                        nameOnly = name;
                    }
                    var argsText = name.substring(colonIdx + 1);
                    var args = argsText.split(dropPointSeparatorArgs);
                    if (nameOnly.length === 0) {
                        throw new Error("Illegal nameOnly");
                    }
                    dropPointNames.push(createPlaceholder({
                        name: nameOnly,
                        start: result,
                        end: end + 4,
                        type: partType,
                        tag: content.substring(result, end + 4),
                        filepath: filepath,
                        args: args
                    }));
                }
            } else {
                if (name.length === 0) {
                    throw new Error("Illegal name");
                }
                dropPointNames.push(createPlaceholder({
                    name: name,
                    start: result,
                    tag: content.substring(result, end + 4),
                    end: end + 4,
                    type: partType,
                    filepath: filepath,
                    args: []

                }));
            }
            startIdx = end + 4;
        }
        replaceRelativeReferences(dropPointNames);
        return dropPointNames;
    }

    function resolveRelativePath(relativeFilePath, referenceFilePath) {
        return path.normalize(path.dirname(referenceFilePath) + "/" + relativeFilePath);
    }

    function replaceRelativeReferences(dropPointsArray) {
        dropPointsArray.forEach(function (dp) {
            if (utils.isRelativePath(dp.name)) {
                var initName = dp.name;
                var ap = resolveRelativePath(dp.name + ".html", dp.filepath);
                var ref = runtime.createUrlPathForFile(ap);
                dp.name = ref.substring(1, ref.length - 5);
                if (runtime.isAppPath(ap)) {
                    dp.name = '/' + dp.name;
                }
                logger.info("Set name for " + initName + " in " + dp.filepath + " to " + dp.name);
            }
        })
    }


    function findAllDropPoints(filepath, contents, partTypePrefixes) {
        var partNames = [];
        partTypePrefixes.forEach(function (type, idx) {
            var f = findDropPoints(filepath, contents, type);
            if (f && f.length) {
                f.forEach(function (pn) {
                    partNames.push(pn);
                });
            }
        });
        return partNames;
    }

    this.findAllDropPoints = function (filepath, contents, partTypePrefixes) {
        return findAllDropPoints(filepath, contents, partTypePrefixes);
    };

    function replacePartContents(content, part, partContents, addMarkers) {
        var am = false;
        if(typeof addMarkers === 'boolean'){
            am = addMarkers;
        }
        if(am){
            var partArgs = "";
            if (part.args && part.args.length > 0) {
                partArgs = ":" + part.args.join();
            }
            var prefix = '<!-- begin_' + part.type + '-' + part.name + partArgs + ' -->';
            var postfix = '<!-- end_' + part.type + '-' + part.name + partArgs + ' -->';
            return content.substring(0, part.start) + prefix + partContents + postfix + content.substring(part.end);
        }else{
            return content.substring(0, part.start) + partContents + content.substring(part.end);
        }

    }

    this.replacePartContents = replacePartContents;

    function replacePartContentsWithoutMarking(content, part, partContents) {
        return content.substring(0, part.start) + partContents + content.substring(part.end);
    }

    function replaceFilePlaceholder(part, composed) {
        var partContents;
        try{
            var fileName = runtime.resolveFilePathForPlaceHolder(part);
            if (!runtime.isExistingFilePath(fileName)) {

            } else {
                var partData = readFragment(fileName);
                partContents = ("" + partData.content).trim();
            }

        }catch(e){
            logger.error("Error while processing part");
            logger.info("Error while parsing part: ", part);
            console.trace();
            partContents = createErrorMarkup('Could not process ' + part.type + ':' + part.name);
        }
        return replacePartContents(composed, part, partContents);

    }

    function createErrorMarkup(msg){
        return '<div style="background-color: #f08080">'+msg+'</div>';
    }

    function replaceLayoutPlaceholderByName(layoutPlaceholder, composed) {
        var layoutTemplatePath = runtime.resolveFilePathForPlaceHolder(layoutPlaceholder);
        var layoutTemplateContents = readFragment(layoutTemplatePath);
        var layoutTemplate = layoutTemplateContents.content.trim();
        var layoutContentDropPoints = findDropPoints(layoutTemplatePath, layoutTemplate, "content");
        if (runtime.isDebug()) {
            logger.info("Found content drop points in " + layoutTemplatePath + ":", layoutContentDropPoints);
        }
        layoutContentDropPoints.reverse();
        logger.info("Processing layout placeholder by name : ", layoutPlaceholder);
        var layoutPlaceholderArgs = layoutPlaceholder.args;
        layoutPlaceholderArgs.reverse();
        if (!(layoutPlaceholderArgs.length > 0 && layoutPlaceholderArgs[0].indexOf('=') > 0)) {
            throw new Error("Not leveraging name based mapping");
        }
        var placeholderArgsByName = {};
        layoutPlaceholderArgs.forEach(function (phArg) {
            var argName = phArg.substring(0, phArg.indexOf('='));
            var argValue = phArg.substring(phArg.indexOf('=') + 1);
            var argValues;
            if (argValue.indexOf(',') > 0) {
                argValues = argValue.split(',');
            } else {
                argValues = [argValue];
            }
            logger.info(argName + " == ", argValues);
            placeholderArgsByName[argName] = argValues;
        });
        logger.info("generated args by name : ", placeholderArgsByName);
        //by name
        for (var dpIdx = 0; dpIdx < layoutContentDropPoints.length; dpIdx += 1) {
            var layoutContentDropPoint = layoutContentDropPoints[dpIdx];
            logger.info("Placeholder args: ", layoutContentDropPoint);
            var specifiedArgs = placeholderArgsByName[layoutContentDropPoint.name];
            logger.info("Specified args for " + layoutContentDropPoint.name + ":", specifiedArgs);
            if (runtime.isDebug()) {
                logger.info("Found args for droppoint " + layoutContentDropPoint.name + ": ", specifiedArgs);
            }
            var namedDropPointReplacement = '';
            if(utils.isDefined(specifiedArgs)){
                specifiedArgs.forEach(function (s) {
                    if (s.charAt(0) === "'" || s.charAt(0) === '"') {
                        namedDropPointReplacement += s.substring(1, s.length - 1);
                    } else {
                        if (!startsWithDropPointPrefix(s)) {
                            throw new Error("Missing type prefix (eg file:) in " + s);
                        }
                        namedDropPointReplacement += dropPointPrefix + s + dropPointPostfix;
                    }
                });

            }
            if (layoutContentDropPoints[dpIdx].args) {
                logger.info("CONTENT WITH WRAP ARGS : ", layoutContentDropPoints[dpIdx]);
                var wrapperArg = layoutContentDropPoints[dpIdx].args[0];
                var wrapperName = wrapperArg.substring(wrapperArg.indexOf('=')+1);
                var up = (wrapperName.charAt(0) === '/' ? wrapperName : '/' + wrapperName)+".html";
                var wrapperFilePath = runtime.findFileForUrlPathname(up);
                var wrapperContents = runtime.readFile(wrapperFilePath);
                var contentDropPoints = findDropPoints(wrapperFilePath, wrapperContents, "content");
                contentDropPoints.forEach(function(wdp){
                    if(wdp.name === 'main'){
                        namedDropPointReplacement = replacePartContents(wrapperContents, wdp, namedDropPointReplacement);
                    }
                });
            }
            logger.info("REPLACING NAMED for droppoint with '" + namedDropPointReplacement + "' in markup :" + layoutTemplate);
            layoutTemplate = replacePartContents(layoutTemplate, layoutContentDropPoint, namedDropPointReplacement);
        }
        return replacePartContents(composed, layoutPlaceholder, layoutTemplate);
    }

    function replaceLayoutPlaceholderByOrder(layoutPlaceholder, composed) {
        try {
            var layoutTemplatePath = runtime.resolveFilePathForPlaceHolder(layoutPlaceholder);
        }catch(lpe){
            logger.error("Could not process layoutPlaceholder " + layoutPlaceholder.placeholder);
            return replacePartContents(composed, layoutPlaceholder, createErrorMarkup("Could not process layoutPlaceholder " + layoutPlaceholder.placeholder));
        }
        var layoutTemplateContents = readFragment(layoutTemplatePath);
        var layoutTemplate = layoutTemplateContents.content.trim();
        var layoutContentDropPoints = findDropPoints(layoutTemplatePath, layoutTemplate, "content");
        if (runtime.isDebug()) {
            logger.info("Found content drop points in " + layoutTemplatePath + ":", layoutContentDropPoints);
        }
        layoutContentDropPoints.reverse();
        var layoutPlaceholderArgs = layoutPlaceholder.args;
        layoutPlaceholderArgs.reverse();
        if(layoutPlaceholderArgs.length > 0){
            var parIdx = layoutPlaceholderArgs[0].indexOf('(');
            var eqIdx = layoutPlaceholderArgs[0].indexOf('=');
            if(eqIdx > 0 && (parIdx < 0 || parIdx > eqIdx )){
                throw new Error("Mapping by name ");
            }
        }
        //by order
        for (var dpIdx = 0; dpIdx < layoutContentDropPoints.length; dpIdx += 1) {
            var currentDroppoint = layoutContentDropPoints[dpIdx];
            var currentDroppointArgs = layoutPlaceholderArgs[dpIdx];
            console.log("Processing content droppoint " + dpIdx + ": ", currentDroppoint);
            console.log("Processing content droppoint " + dpIdx + " with args :", currentDroppointArgs);
            var orderedDropPointReplacement = '';
            if(utils.isDefined(currentDroppointArgs)){
                if (currentDroppointArgs.indexOf(',') > 0) {
                    var splitArgs = currentDroppointArgs.split(',');
                    splitArgs.forEach(function (dpArg) {
                        if (dpArg.charAt(0) === "'" || dpArg.charAt(0) === '"') {
                            orderedDropPointReplacement += dpArg.substring(1, dpArg.length - 1);
                        } else {
                            if (!startsWithDropPointPrefix(dpArg)) {
                                throw new Error("Missing type prefix (eg file:) in " + dpArg);
                            }
                            orderedDropPointReplacement += dropPointPrefix + dpArg + dropPointPostfix;
                        }
                    });
                } else {
                    if (currentDroppointArgs.charAt(0) === "'" || currentDroppointArgs.charAt(0) === '"') {
                        orderedDropPointReplacement = currentDroppointArgs.substring(1, currentDroppointArgs.length - 1);
                    } else {
                        if (!startsWithDropPointPrefix(currentDroppointArgs)) {
                            throw new Error("Missing type prefix (eg file:) in " + currentDroppointArgs);
                        }
                        orderedDropPointReplacement = dropPointPrefix + currentDroppointArgs + dropPointPostfix;
                    }
                }
            }
            if (currentDroppoint.args) {
                logger.info("CONTENT WITH WRAP ARGS : ", currentDroppoint);
                var wrapperArg = currentDroppoint.args[0];
                var wrapperName = wrapperArg.substring(wrapperArg.indexOf('=')+1);
                var up = (wrapperName.charAt(0) === '/' ? wrapperName : '/' + wrapperName)+".html";
                var wrapperFilePath = runtime.findFileForUrlPathname(up);
                var wrapperContents = runtime.readFile(wrapperFilePath);
                var contentDropPoints = findDropPoints(wrapperFilePath, wrapperContents, "content");
                contentDropPoints.forEach(function(wdp){
                    if(wdp.name === 'main'){
                        orderedDropPointReplacement = replacePartContents(wrapperContents, wdp, orderedDropPointReplacement);
                    }
                });
            }
            layoutTemplate = replacePartContents(layoutTemplate, currentDroppoint, orderedDropPointReplacement);
        }
        return replacePartContents(composed, layoutPlaceholder, layoutTemplate);
    }

    function replaceLayoutPlaceholder(layoutPlaceholder, composed) {
        try {
            var layoutTemplatePath = runtime.resolveFilePathForPlaceHolder(layoutPlaceholder);
        } catch (e) {
            logger.error("Could not process layoutPlaceholder " + layoutPlaceholder.type + ":" + layoutPlaceholder.name);
            logger.info("Error for droppoint : ", layoutPlaceholder);
            return replacePartContents(composed, layoutPlaceholder, createErrorMarkup("Could not process layoutPlaceholder " + layoutPlaceholder.type + ":" + layoutPlaceholder.name));
        }
        var layoutTemplateContents = readFragment(layoutTemplatePath);
        var layoutTemplate = layoutTemplateContents.content.trim();
        var layoutContentDropPoints = findDropPoints(layoutTemplatePath, layoutTemplate, "content");
        if (runtime.isDebug()) {
            logger.info("Found content drop points in " + layoutTemplatePath + ":", layoutContentDropPoints);
        }
        layoutContentDropPoints.reverse();
        var layoutPlaceholderArgs = layoutPlaceholder.args;
        layoutPlaceholderArgs.reverse();
        if(layoutPlaceholderArgs.length > 0){
            var parIdx = layoutPlaceholderArgs[0].indexOf('(');
            var eqIdx = layoutPlaceholderArgs[0].indexOf('=');
            if(eqIdx > 0 && (parIdx < 0 || parIdx > eqIdx )){
                return replaceLayoutPlaceholderByName(layoutPlaceholder, composed);
            }
        }
        return replaceLayoutPlaceholderByOrder(layoutPlaceholder, composed);
//        if (layoutPlaceholderArgs.length > 0 && layoutPlaceholderArgs[0].indexOf('=') > 0) {
//            return replaceLayoutPlaceholderByName(layoutPlaceholder, composed);
//        } else {
//            return replaceLayoutPlaceholderByOrder(layoutPlaceholder, composed);
//        }
    }

    var startsWithDropPointPrefix = function (str) {
        var startsWith = false;
        dropPointTypes.forEach(function (tp) {
            if (str.indexOf(tp + ':') === 0) {
                startsWith = true
            }
        });
        return startsWith;
    };

    function prepareEditableRefs(filePath, contents) {
        var urlpath = runtime.createUrlPathForFile(filePath);
        var editableRef = urlpath.substring(1, urlpath.lastIndexOf('.'));
        var cont = true;
        var startIdx = 0;
        var attrname = 'data-editable';
        while (cont) {
            var attrstart = contents.indexOf(attrname, startIdx);
            if (attrstart < startIdx) {
                cont = false;
            } else {
                var emptyAttr = attrname + '=""';
                var emptyAttrVal = (attrstart === contents.indexOf(emptyAttr, startIdx));
                if (contents.charAt(attrstart + attrname.length) !== '=' || emptyAttrVal) {
                    var newAttr = attrname + '="' + editableRef + '" contenteditable="true" ';
                    var attrEnd = attrstart + attrname.length;
                    if (emptyAttrVal) {
                        attrEnd = attrstart + emptyAttr.length;
                    }
                    var newc = contents.substring(0, attrstart) + newAttr + contents.substring(attrEnd);
                    contents = newc;
                } else {

                }
                startIdx = attrstart + 1;
            }
            if (startIdx >= contents.length) {
                cont = false;
            }
        }
        return contents;
    }

    this.prepareEditableRefs = prepareEditableRefs;

    function findAllIndexesOf(find, content) {
        var idxs = [];
        var from = 0;
        while (from < content.length) {
            var match = content.indexOf(find, from);
            if (match < from) {
                from = content.length;
            } else {
                idxs.push(match);
                from = match + 1;
            }
        }
        return idxs;
    }

    function resolveRelativeLinksInProtostarAttributes(filepath, cnt) {
        var selSameDir = '"ps:./';
        var selParentDir = '"ps:../';
        var cont = cnt;
        var parentSelIdxes = findAllIndexesOf(selParentDir, cont);
        parentSelIdxes.sort();
        parentSelIdxes.reverse();
        parentSelIdxes.forEach(function (idx) {
            var nextQuote = cont.indexOf('"', idx + 5);
            var relPath = cnt.substring(idx + 4, nextQuote);
            var resolvedPath = resolveRelativePath(relPath, filepath);
            logger.info("Resolved relative link " + relPath + " to " + resolvedPath);
            var url = runtime.createUrlPathForFile(resolvedPath);
            if (url.indexOf('/ps/') !== 0) {
                url = url.substring(1);
            }
            cont = cont.substring(0, idx + 1) + url + cont.substring(nextQuote);

        });
        var sameSelIdxes = findAllIndexesOf(selSameDir, cont);
        sameSelIdxes.sort();
        sameSelIdxes.reverse();
        sameSelIdxes.forEach(function (idx) {
            var nextQuote = cont.indexOf('"', idx + 5);
            var relPath = cnt.substring(idx + 4, nextQuote);
            logger.info("Found rel link = " + relPath);
            var resolvedPath = resolveRelativePath(relPath, filepath);
            logger.info("Resolved to " + resolvedPath);
            var url = runtime.createUrlPathForFile(resolvedPath);
            if (url.indexOf('/ps/') !== 0) {
                url = url.substring(1);
            }
            logger.info("End result = " + url);
            cont = cont.substring(0, idx + 1) + url + cont.substring(nextQuote);
        });
        var rg = new RegExp('\"ps:', 'g');
        return cont.replace(rg, '"');
    }

    function readFragment(filePath) {
        var contents = prepareEditableRefs(filePath, runtime.readFile(filePath));
        var dropPoints = findAllDropPoints(filePath, contents, ['wrap']);
        if (dropPoints.length > 0) {
            contents = applyWrapPlaceholder(dropPoints[0], contents);
        }
        contents = resolveRelativeLinksInProtostarAttributes(filePath, contents);
        return  {
            content: contents,
            dropPoints: -1
        };
    }

    function applyWrapPlaceholder(partName, composed) {
        var wrapper;
        var partPath = runtime.resolveFilePathForPlaceHolder(partName);
        var wrappedData = readFragment(partPath);
        wrapper = wrappedData.content.trim();
        var contentDropPoints = findDropPoints(partPath, wrapper, "content");
        var mainContentDropPoint = -1;
        contentDropPoints.forEach(function (dp) {
            if (dp.name === 'main') {
                if (mainContentDropPoint !== -1) {
                    throw new Error("Overlapping content:main droppoint in " + partPath);
                }
                mainContentDropPoint = dp;
            }
        });
        if (mainContentDropPoint === -1) {
            throw new Error("Could not find content:main inside " + partPath + " which is being invoked as wrapper");
        }

        composed = replacePartContentsWithoutMarking(composed, partName, ""); //remove the wrap tag
        composed = replacePartContents(wrapper, mainContentDropPoint, composed);
        return composed;//
    }

    function replaceContentPlaceholder(part, composed) {

        return replacePartContents(composed, part, '<!-- content placeholder not called as layout - content:' + part.name + ' -->');
    }

    var compositionRun = function (templateFilename, template, partNames, metadata) {
        var composed = "" + template;
        partNames.sort(function (a, b) {
            return -1 * (a.start - b.start);
        });
        var dirPath = path.dirname(templateFilename);
        var dirName = path.basename(dirPath);
        var wrapped = false;
        if (runtime.isDebug()) {
            logger.info("Composition run for template file name: " + templateFilename);
        }
        partNames.forEach(function (partName, i) {
            if (runtime.isDebug()) {
                logger.info("Processing part: ", partName);
            }
            switch (partName.type) {
                case "file":
                    composed = replaceFilePlaceholder(partName, composed);
                    break;
                case "content":
                    composed = replaceContentPlaceholder(partName, composed);
                    break;
                case "layout":
                    composed = replaceLayoutPlaceholder(partName, composed);
                    break;
                case "wrap":
                    composed = applyWrapPlaceholder(partName, composed);
                    wrapped = true;
                    break;
                case "linkCss":
                    if (partName.name === 'default') {
                        var defaultCssPath = path.join(dirPath, dirName + ".css");
                        if (templateFilename.indexOf("/index.html") < 0) {
                            defaultCssPath = templateFilename.substring(0, templateFilename.lastIndexOf(".") + 1) + "css";
                        }
                        if (runtime.isDebug()) {
                            logger.info("DEFAULT css path = " + defaultCssPath);
                        }
                    } else {
                        defaultCssPath = runtime.resolveFilePathForPlaceHolder(partName);
                    }
                    if (runtime.isDebug()) {
                        logger.info("Found css path = " + defaultCssPath);
                    }
                    if (runtime.isExistingFilePath(defaultCssPath)) {
                        var defaultCssUrl = runtime.createUrlPathForFile(defaultCssPath);
                        metadata.include.style.push(defaultCssUrl);
                    } else {
                        throw new Error("There is no default style to include for " + templateFilename + ": " + defaultCssPath);
                    }
                    composed = replacePartContentsWithoutMarking(composed, partName, ""); //remove the tag
                    break;
                case "linkScript":
                    var defaultScriptPath;
                    if (partName.name === 'default') {
                        defaultScriptPath = path.join(dirPath, dirName + ".js");
                        if (runtime.isDebug()) {
                            logger.info("DEFAULT script path = " + defaultScriptPath);
                        }
                    } else {
                        defaultScriptPath = runtime.resolveFilePathForPlaceHolder(partName);
                    }
                    if (runtime.isDebug()) {
                        if (runtime.isDebug()) {
                            logger.info("Found script path = " + defaultScriptPath);
                        }
                    }
                    if (runtime.isExistingFilePath(defaultScriptPath)) {
                        var defaultScriptUrl = runtime.createUrlPathForFile(defaultScriptPath);
                        metadata.include.script.push(defaultScriptUrl);
                    } else {
                        throw new Error("There is no default script to include for " + templateFilename + ": " + defaultScriptPath);
                    }
                    composed = replacePartContentsWithoutMarking(composed, partName, ""); //remove the tag
                    break;
                default:
                    throw new Error("Unknown type " + partName.type);
            }
        });
        return composed;
    };

    var composeTemplate = function (filePath, fileContents, maxRuns) {
        if (filePath.substring(filePath.lastIndexOf(".") + 1) !== "html") {
            throw new Error("Should be an *.html file : " + filePath);
        }
        var file = resolveRelativeLinksInProtostarAttributes(filePath, prepareEditableRefs(filePath, "" + fileContents));
        var names = findAllDropPoints(filePath, file, dropPointTypes);
        var modificationFile = '' + file;
        var runs = 0;
        var mr = 100;
        if (typeof maxRuns === 'number') {
            mr = maxRuns;
        }
        var metadata = {
            templatePath: filePath,
            include: {
                script: [],
                headScript: [],
                style: []
            }
        };
        while (names && names.length && runs < mr) {
            modificationFile = compositionRun(filePath, modificationFile, names, metadata);
            runs += 1;
            names = findAllDropPoints(filePath, modificationFile, dropPointTypes);
        }
        return {
            content: modificationFile,
            metadata: metadata

        };
    };
    parseArgs(args);
    this.composeTemplate = function (filePath, fileContents, maxRuns) {
        logger.info("Composing template : " + filePath);
        return composeTemplate(filePath, fileContents, maxRuns);
    };
}

var countOccurrencesBetweenIndexes = function (content, search, start, end) {
    if (end < start) {
        throw new Error("end must be greater than start : " + start + " vs " + end);
    }
    var idx = start;
    var count = 0;
    while (idx < end) {

        var potential = content.indexOf(search, idx);
        if (potential >= 0) {
            count += 1
            idx = potential + search.length;
        } else {
            idx = end;
        }
    }

    return count;
};
var findNthOccurrence = function (content, search, n, start) {
    var idx = -1;
    var nextIdx = start;
    var count = 0;
    while (count < n && nextIdx < content.length) {
        var potential = content.indexOf(search, nextIdx);
        if (potential >= 0) {
            count += 1;
            idx = potential;
            nextIdx = potential + search.length;
        } else {
            nextIdx = content.length;

        }
    }
    if (count < n) {
        throw new Error("Could find " + n + "th occurrence of '" + search + "'");
    }
    return idx;
};


module.exports = {
    countOccurrencesBetweenIndexes: countOccurrencesBetweenIndexes,
    findNthOccurrence: findNthOccurrence,
    createTemplateComposer: function (args) {
        return new TemplateComposer(args);
    },
    isDirectory: function (filename) {
        return fs.statSync(filename).isDirectory();
    },
    fileExists: function (filename) {
        return fs.existsSync(filename);
    },
    parseMarker: function (beginMarker, index, closeIdx, contents) {
        var idxUnd = beginMarker.indexOf('_');
        var idxDash = beginMarker.indexOf('-', idxUnd);
        var type = beginMarker.substring(idxUnd + 1, idxDash);
        var name = beginMarker.substring(idxDash + 1, beginMarker.indexOf(' ', idxDash));

        var endMarkerBegin = contents.indexOf('<!-- end_' + type + "-" + name + ' -->');
        var endMarkerEnd = contents.indexOf(' -->', endMarkerBegin);
        var marker = {
            name: name,
            type: type,
            start: index,
            end: endMarkerEnd + 5,
            length: (endMarkerBegin - 1) - (closeIdx + 5),
            content: contents.substring(closeIdx + 5, endMarkerBegin - 1)
        };
        return marker;
    },
    decompile: function (contents) {
        var cnt = contents + "";
        var markers = [];
        var run = true;
        while (run && cnt.indexOf('<!-- begin_') >= 0) {
            logger.info("marker found ..");
            var openMarkerStart = cnt.indexOf('<!-- begin_', 0);
            if (openMarkerStart >= 0) {
                var openMarkerEnd = cnt.indexOf(' -->', openMarkerStart);
                var openMarker = cnt.substring(openMarkerStart, openMarkerEnd + 4);
                var templateDef = openMarker.substring(11, openMarker.length - 4);
                var fragmentType = templateDef.substring(0, templateDef.indexOf("-"));
                var templateName = templateDef.substring(templateDef.indexOf("-") + 1);
                var args = "";
                if (templateDef.indexOf(":") > 0) {
                    args = templateDef.substring(templateDef.indexOf(":"));
                    templateName = templateDef.substring(templateDef.indexOf("-") + 1, templateDef.indexOf(":"));
                }
                logger.info("Template name: '" + templateName + "' of type " + fragmentType);
                logger.info("Found open marker: " + openMarker);

                var closeTag = "<!-- end_" + templateDef + ' -->';
                logger.info("openclosetag=" + closeTag);
                var closeMarkerStart = cnt.indexOf(closeTag, openMarkerEnd + 4);
                if (closeMarkerStart < 0) {
                    throw new Error("Cannot find matching end tag for " + openMarker);
                }
                logger.info("counting outhers, closeMarkerStart = " + closeMarkerStart);
                var openMarkerFull = '<!-- begin_' + fragmentType + "-" + templateName + args + " -->";
                var othersCount = countOccurrencesBetweenIndexes(cnt, openMarkerFull, openMarkerEnd, closeMarkerStart);
                var closeMarker = '<!-- end_' + fragmentType + "-" + templateName + args + " -->";
                if (othersCount > 0) {
                    logger.info("found others: " + othersCount);

                    closeMarkerStart = findNthOccurrence(cnt, closeMarker, othersCount + 1, openMarkerEnd);
                    logger.info("actual close is " + closeMarkerStart);
                }

                var theContent = cnt.substring(openMarkerEnd + 4, closeMarkerStart);
                var closeMarkerEnd = cnt.indexOf(' -->', closeMarkerStart) + 4;
                markers.push({
                    name: templateName,
                    content: theContent,
                    type: fragmentType,
                    start: openMarkerStart,
                    end: closeMarkerEnd + 4
                });
                logger.info("Found open marker: " + openMarker);
                cnt = cnt.substring(0, openMarkerStart) + '<!-- ' + fragmentType + ':' + templateName + args + ' -->' + cnt.substring(closeMarkerEnd);

            } else {
                logger.info("No markers found");
                run = false;
            }
        }

        return {
            content: cnt,
            markers: markers
        };
    },
    decompileRecursive: function (contents) {
        var cnt = contents + "";
        var decompiled = module.exports.decompile(cnt);
        logger.info("Recursive, decompiled root = ", decompiled);
        var changed = true;
        var run = 0;
        while (changed && run < 1000) {
            changed = false;
            run += 1;
            decompiled.markers.forEach(function (m) {
                if (m.content.indexOf('<!-- begin_') >= 0) {
                    var nestedDecompiled = module.exports.decompile(m.content);
                    logger.info("Decompiled nested : " + m.name, nestedDecompiled);
                    changed = true;
                    m.content = nestedDecompiled.content;
                    m.nestedMarkers = [];
                    nestedDecompiled.markers.forEach(function (mr) {
                        decompiled.markers.push(mr);
                        m.nestedMarkers.push(mr);
                    });
                }
            });
        }
        return decompiled;
    },
    replaceMarkedContentWithDropPoints: function (contents) {
        var processed = '' + contents;
        var markers = module.exports.decompile(processed);
        while (markers.length > 0) {
            var m = markers[0];
            processed = (processed.substring(0, m.start) + '<!-- file:' + m.name + ' -->' + processed.substring(m.end + 1));
            markers = module.exports.decompile(processed);
        }
        return processed;
    }
};