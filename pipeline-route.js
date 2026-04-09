/*\
title: $:/plugins/rimir/file-pipeline/pipeline-route
type: application/javascript
module-type: route

POST /api/file-pipeline — run a processing pipeline on an existing file.
Resolves the URI to a filesystem path, selects a pipeline (by name or MIME auto-match),
and executes all command steps. LLM steps are returned as markers for client-side execution.

Body: { uri, pipeline?, mimeType? }
Response: { status: "ok", pipeline: "<name>", results: [...] }

\*/
"use strict";

var path = require("path");
var fs = require("fs");

var executor = require("$:/plugins/rimir/file-pipeline/pipeline-executor");
var logger = new $tw.utils.Logger("file-pipeline", {colour: "magenta"});

// Soft-require file-upload's uri-resolver for shared location registry
var uriResolver = null;
try {
	uriResolver = require("$:/plugins/rimir/file-upload/uri-resolver");
} catch(e) { /* file-upload not installed */ }

exports.method = "POST";
exports.path = /^\/api\/file-pipeline$/;

exports.handler = function(request, response, state) {
	var raw = state.data || "{}";
	var data;
	try {
		data = typeof raw === "string" ? JSON.parse(raw) : raw;
	} catch(e) {
		sendJson(response, 400, {status: "error", error: "Invalid JSON body"});
		return;
	}
	var uri = data.uri;
	var pipelineName = data.pipeline;
	var mimeType = data.mimeType;

	if(!uri) {
		sendJson(response, 400, {status: "error", error: "Missing 'uri' parameter"});
		return;
	}

	// Check if pipelines are enabled
	var enabledTiddler = $tw.wiki.getTiddler("$:/config/rimir/file-pipeline/enabled");
	if(enabledTiddler && (enabledTiddler.fields.text || "").trim() === "no") {
		sendJson(response, 200, {status: "disabled", results: []});
		return;
	}

	// Resolve URI to filesystem path
	var filePath, basePath;
	if(uriResolver) {
		var resolved = uriResolver.resolveSecure(uri);
		if(!resolved) {
			sendJson(response, 403, {status: "error", error: "Cannot resolve URI or path traversal denied: " + uri});
			return;
		}
		filePath = resolved.filePath;
		basePath = path.resolve($tw.boot.wikiPath, resolved.location.basePath);
	} else {
		// Fallback: simple /files/* resolution
		var decoded = decodeURIComponent(uri);
		if(decoded.indexOf("/files/") !== 0) {
			sendJson(response, 400, {status: "error", error: "Cannot resolve URI without file-upload plugin: " + uri});
			return;
		}
		filePath = path.resolve($tw.boot.wikiPath, decoded.substring(1));
		basePath = path.resolve($tw.boot.wikiPath, "files");
	}

	// Security check
	var absPath = path.resolve(filePath);
	var wikiRoot = path.resolve($tw.boot.wikiPath);
	if(absPath.indexOf(wikiRoot) !== 0) {
		sendJson(response, 403, {status: "error", error: "Path traversal denied"});
		return;
	}

	if(!fs.existsSync(absPath)) {
		sendJson(response, 404, {status: "error", error: "File not found: " + uri});
		return;
	}

	// Find pipeline
	var pipeline;
	if(pipelineName && pipelineName !== "auto") {
		pipeline = executor.getPipeline(pipelineName);
		if(!pipeline) {
			sendJson(response, 400, {status: "error", error: "Unknown pipeline: " + pipelineName});
			return;
		}
	} else if(mimeType) {
		pipeline = executor.matchPipeline(mimeType);
		if(!pipeline) {
			sendJson(response, 200, {status: "no-match", results: []});
			return;
		}
	} else {
		// Try to infer MIME type from extension
		var ext = path.extname(uri).toLowerCase();
		var extToMime = {
			".pdf": "application/pdf",
			".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			".jpg": "image/jpeg", ".jpeg": "image/jpeg",
			".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"
		};
		var inferred = extToMime[ext];
		if(inferred) {
			pipeline = executor.matchPipeline(inferred);
		}
		if(!pipeline) {
			sendJson(response, 200, {status: "no-match", results: []});
			return;
		}
	}

	logger.log("Running pipeline '" + pipeline.name + "' on " + uri);

	executor.runPipeline(pipeline, absPath, uri, basePath, function(err, results) {
		if(err) {
			sendJson(response, 500, {status: "error", error: err.message});
			return;
		}
		sendJson(response, 200, {
			status: "ok",
			pipeline: pipeline.name,
			results: results
		});
	});
};

function sendJson(response, statusCode, data) {
	var body = JSON.stringify(data);
	response.writeHead(statusCode, {
		"Content-Type": "application/json"
	});
	response.end(body);
}
