/*\
title: $:/plugins/rimir/file-pipeline/finalize-route
type: application/javascript
module-type: route

POST /api/file-pipeline-finalize — resize a selected frame to thumbnail,
move to _generated/ folder, and clean up _derived/ frames.

Body: { sourceUri, frameUri }
Response: { thumbnailUri }

\*/
"use strict";

var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

var logger = new $tw.utils.Logger("file-pipeline", {colour: "magenta"});

var uriResolver = null;
try {
	uriResolver = require("$:/plugins/rimir/file-upload/uri-resolver");
} catch(e) {}

exports.method = "POST";
exports.path = /^\/api\/file-pipeline-finalize$/;

exports.handler = function(request, response, state) {
	var data;
	try {
		data = JSON.parse(state.data || "{}");
	} catch(e) {
		sendJson(response, 400, {error: "Invalid JSON body"});
		return;
	}

	var sourceUri = data.sourceUri;
	var frameUri = data.frameUri;

	if(!sourceUri) {
		sendJson(response, 400, {error: "Missing sourceUri"});
		return;
	}

	if(!uriResolver) {
		sendJson(response, 500, {error: "file-upload plugin required"});
		return;
	}

	// Resolve source URI
	var sourceResolved = uriResolver.resolveSecure(sourceUri);
	if(!sourceResolved) {
		sendJson(response, 403, {error: "Cannot resolve source URI"});
		return;
	}

	var sourceParsed = path.parse(sourceResolved.filePath);

	// Helper: clean up _derived/<source-basename>/
	function cleanupDerived() {
		var derivedDir = path.join(sourceParsed.dir, "_derived", sourceParsed.base);
		try {
			if(fs.existsSync(derivedDir)) {
				var files = fs.readdirSync(derivedDir);
				for(var i = 0; i < files.length; i++) {
					fs.unlinkSync(path.join(derivedDir, files[i]));
				}
				fs.rmdirSync(derivedDir);
				var derivedParent = path.join(sourceParsed.dir, "_derived");
				var remaining = fs.readdirSync(derivedParent);
				if(remaining.length === 0) {
					fs.rmdirSync(derivedParent);
				}
			}
		} catch(e) {
			logger.log("Derived cleanup error: " + e.message);
		}
	}

	// No frame selected — cleanup only (cancel/skip)
	if(!frameUri) {
		logger.log("Cleaning up derived frames (cancelled) for " + sourceParsed.base);
		cleanupDerived();
		sendJson(response, 200, {cleaned: true});
		return;
	}

	// Resolve frame URI
	var frameResolved = uriResolver.resolveSecure(frameUri);
	if(!frameResolved) {
		sendJson(response, 403, {error: "Cannot resolve frame URI"});
		return;
	}
	if(!fs.existsSync(frameResolved.filePath)) {
		sendJson(response, 404, {error: "Frame file not found: " + frameUri});
		return;
	}

	// Read thumbnail resolution from config
	var resTiddler = $tw.wiki.getTiddler("$:/config/rimir/file-pipeline/thumb-resolution");
	var resolution = (resTiddler && resTiddler.fields.text || "200").trim();
	if(/^\d+$/.test(resolution)) {
		resolution = resolution + "x" + resolution;
	}

	// Compute output: <source-dir>/_generated/<source-name>_thumb.png
	var generatedDir = path.join(sourceParsed.dir, "_generated");
	$tw.utils.createDirectory(generatedDir);
	var outputPath = path.join(generatedDir, sourceParsed.name + "_thumb.png");

	// Resize frame using ImageMagick
	var command = 'magick "' + frameResolved.filePath + '" -thumbnail "' + resolution + '>" "' + outputPath + '"';
	logger.log("Resizing frame to thumbnail: " + sourceParsed.name + "_thumb.png (" + resolution + ")");

	child_process.exec(command, {
		cwd: $tw.boot.wikiPath,
		timeout: 30000
	}, function(err) {
		if(err) {
			logger.log("Thumbnail resize failed: " + err.message);
			sendJson(response, 500, {error: "Thumbnail resize failed: " + err.message});
			return;
		}
		logger.log("Thumbnail created: " + outputPath);

		// Clean up all extracted frames
		cleanupDerived();
		logger.log("Cleaned up derived frames for " + sourceParsed.base);

		// Build thumbnail URI
		var sourceUriDir = sourceUri.substring(0, sourceUri.lastIndexOf("/"));
		var thumbnailUri = sourceUriDir + "/_generated/" + sourceParsed.name + "_thumb.png";

		sendJson(response, 200, {thumbnailUri: thumbnailUri});
	});
};

function sendJson(response, statusCode, data) {
	var body = JSON.stringify(data);
	response.writeHead(statusCode, {
		"Content-Type": "application/json"
	});
	response.end(body);
}
