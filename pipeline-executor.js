/*\
title: $:/plugins/rimir/file-pipeline/pipeline-executor
type: application/javascript
module-type: library

Server-side pipeline executor. Loads pipeline definitions from tagged tiddlers,
matches pipelines by MIME type, and runs command steps sequentially.
LLM steps are returned as markers for client-side execution.

\*/
"use strict";

var child_process = require("child_process");
var fs = require("fs");
var path = require("path");

var PIPELINE_TAG = "$:/tags/rimir/file-pipeline/pipeline";

var _cachedPipelines = null;
var _cachedActions = null;

var logger = new $tw.utils.Logger("file-pipeline", {colour: "magenta"});

// --- Pipeline loading ---

function loadPipelines() {
	var titles = $tw.wiki.filterTiddlers("[all[tiddlers+shadows]tag[" + PIPELINE_TAG + "]]");
	var pipelines = [];
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if(!tiddler) continue;
		try {
			var def = JSON.parse(tiddler.fields.text);
			if(def.name && Array.isArray(def.steps)) {
				def._title = titles[i];
				pipelines.push(def);
			}
		} catch(e) {
			logger.log("Failed to parse pipeline " + titles[i] + ": " + e.message);
		}
	}
	_cachedPipelines = pipelines;
	return pipelines;
}

exports.loadPipelines = loadPipelines;

exports.invalidate = function() {
	_cachedPipelines = null;
	_cachedActions = null;
};

exports.matchPipeline = function(mimeType) {
	var pipelines = _cachedPipelines || loadPipelines();
	for(var i = 0; i < pipelines.length; i++) {
		if(Array.isArray(pipelines[i].match) && pipelines[i].match.indexOf(mimeType) !== -1) {
			return pipelines[i];
		}
	}
	return null;
};

exports.getPipeline = function(name) {
	var pipelines = _cachedPipelines || loadPipelines();
	for(var i = 0; i < pipelines.length; i++) {
		if(pipelines[i].name === name) {
			return pipelines[i];
		}
	}
	return null;
};

// --- runner-actions.json loading ---

function loadActions() {
	if(_cachedActions) return _cachedActions;
	var actionsPath = path.resolve($tw.boot.wikiPath, "runner-actions.json");
	try {
		_cachedActions = JSON.parse(fs.readFileSync(actionsPath, "utf8"));
	} catch(e) {
		logger.log("Cannot read runner-actions.json: " + e.message);
		_cachedActions = {};
	}
	return _cachedActions;
}

// --- Template resolution ---

function resolveTemplate(template, vars) {
	if(!template) return template;
	return template
		.split("{{name}}").join(vars.name || "")
		.split("{{basename}}").join(vars.basename || "")
		.split("{{ext}}").join(vars.ext || "");
}

function resolveConfigRef(value) {
	if(typeof value !== "string") return value;
	var match = value.match(/^\{\{config:(.+)\}\}$/);
	if(!match) return value;
	var tiddler = $tw.wiki.getTiddler(match[1]);
	return (tiddler && tiddler.fields.text || "").trim();
}

function checkCondition(condition) {
	if(!condition) return true;
	var configTitle = condition.config;
	var expectedValue = condition.equals;
	if(!configTitle) return true;
	var tiddler = $tw.wiki.getTiddler(configTitle);
	var actual = (tiddler && tiddler.fields.text || "").trim();
	return actual === expectedValue;
}

// --- Step execution ---

function resolveInput(step, sourcePath, stepResults) {
	if(!step.input || step.input === "source") {
		return sourcePath;
	}
	var ref = step.input.match(/^step:(.+)$/);
	if(ref && stepResults[ref[1]]) {
		var prev = stepResults[ref[1]];
		// For captureStdout steps, there's no output file path
		if(prev.outputPath) return prev.outputPath;
		// Fallback to source if previous step had no file output
		return sourcePath;
	}
	return sourcePath;
}

function buildOutputPath(step, inputPath, sourceDir) {
	if(!step.output) return null;
	var parsed = path.parse(inputPath);
	var vars = {
		name: parsed.name,
		basename: parsed.base,
		ext: parsed.ext
	};
	var relOutput = resolveTemplate(step.output, vars);
	return path.resolve(sourceDir, relOutput);
}

// Some commands (e.g., libreoffice --outdir) write to a directory but the actual
// output file has a different path than what's passed as {{output}}.
// `outputFile` tells the executor where the real result ends up.
function buildOutputFilePath(step, inputPath, sourceDir) {
	if(!step.outputFile) return null;
	var parsed = path.parse(inputPath);
	var vars = {
		name: parsed.name,
		basename: parsed.base,
		ext: parsed.ext
	};
	var relOutput = resolveTemplate(step.outputFile, vars);
	return path.resolve(sourceDir, relOutput);
}

function buildOutputUri(outputPath, canonicalUri, basePath) {
	// Derive the output URI relative to basePath, using the same URI prefix as canonicalUri
	var relToBase = path.relative(basePath, outputPath).replace(/\\/g, "/");
	// Find the URI prefix from canonicalUri: everything before the first path component that matches basePath content
	var uriParts = canonicalUri.split("/");
	var relParts = relToBase.split("/");
	// Walk backwards from canonicalUri to find where basePath maps to
	// Simpler: just use the base directory of canonicalUri's parent
	var uriDir = canonicalUri.substring(0, canonicalUri.lastIndexOf("/"));
	// But output might be in a subdirectory relative to the source file
	// So we compute relative from source file's directory
	var sourceFileDir = path.dirname(path.resolve(basePath, canonicalUri.split("/").slice(1).join("/")));
	// Actually, let's just compute from basePath
	var locationPrefix = canonicalUri.substring(0, canonicalUri.indexOf("/", 1) + 1);
	// For URIs like /files/pdf/report.pdf, prefix = /files/
	// relToBase = pdf/_generated/report_thumb.png
	// result = /files/pdf/_generated/report_thumb.png
	return locationPrefix + relToBase;
}

function executeCommand(step, inputPath, outputPath, callback) {
	var actions = loadActions();
	var actionDef = actions[step.action];
	if(!actionDef || !actionDef.command) {
		logger.log("Runner action not found: " + step.action);
		callback(new Error("Runner action not found: " + step.action));
		return;
	}
	// Create output directory if needed
	if(outputPath) {
		// If outputPath ends with / it IS a directory (e.g., libreoffice --outdir)
		if(outputPath.charAt(outputPath.length - 1) === "/" || outputPath.charAt(outputPath.length - 1) === "\\") {
			$tw.utils.createDirectory(outputPath);
		} else {
			$tw.utils.createDirectory(path.dirname(outputPath));
		}
	}
	// Build command from template
	var command = actionDef.command;
	command = command.split("{{input}}").join('"' + inputPath + '"');
	if(outputPath) {
		command = command.split("{{output}}").join('"' + outputPath + '"');
	}
	// Resolve params
	if(step.params) {
		for(var key in step.params) {
			var val = resolveConfigRef(step.params[key]);
			// Normalize resolution (e.g., "200" → "200x200")
			if(key === "resolution" && /^\d+$/.test(val)) {
				val = val + "x" + val;
			}
			command = command.split("{{" + key + "}}").join(val);
		}
	}
	// Per-step timeout: step.timeout (seconds) > default 5min, 0 = no timeout
	var timeoutMs = step.timeout !== undefined ? parseInt(step.timeout) * 1000 : 300000;
	logger.log("Executing: " + command);
	child_process.exec(command, {
		cwd: $tw.boot.wikiPath,
		maxBuffer: 10 * 1024 * 1024,
		timeout: timeoutMs
	}, function(err, stdout, stderr) {
		if(err) {
			logger.log("Step '" + step.id + "' failed: " + err.message);
			if(stderr) logger.log("stderr: " + stderr);
			callback(err);
			return;
		}
		callback(null, stdout || "");
	});
}

var DEFAULT_SCAN_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

function scanDirectory(dirPath, extensions) {
	var allowedExts = extensions || DEFAULT_SCAN_EXTENSIONS;
	var outputs = [];
	try {
		var files = fs.readdirSync(dirPath);
		for(var i = 0; i < files.length; i++) {
			var ext = path.extname(files[i]).toLowerCase();
			if(allowedExts.indexOf(ext) !== -1) {
				outputs.push({
					filename: files[i],
					filePath: path.join(dirPath, files[i])
				});
			}
		}
	} catch(e) {
		logger.log("scanDir failed: " + e.message);
	}
	return outputs;
}

// --- Main pipeline runner ---

/*
Run a pipeline definition against a file.

Parameters:
  def         — pipeline definition object (from tiddler JSON)
  inputPath   — absolute filesystem path of the source file
  canonicalUri — the source file's canonical URI (e.g., /files/pdf/report.pdf)
  basePath    — absolute filesystem path of the location's basePath
  callback    — function(err, results) where results is an array of step results

Each result in the array:
  { stepId, skipped: true }                                  — condition not met
  { stepId, type: "llm", step: <stepDef>, inputText: "..." } — LLM marker for client
  { stepId, type: "select", step: <stepDef>, outputs: [...] } — select marker for client
  { stepId, uri, outputPath, artifact }                      — single file output
  { stepId, text, artifact }                                 — captured stdout text
  { stepId, outputs: [{filename, uri, filePath}], artifact } — multi-file output (scanDir)
*/
exports.runPipeline = function(def, inputPath, canonicalUri, basePath, callback) {
	var steps = def.steps || [];
	var stepResults = {}; // id → result
	var allResults = [];
	var sourceDir = path.dirname(inputPath);
	var uriDir = canonicalUri.substring(0, canonicalUri.lastIndexOf("/"));

	function runStep(index) {
		if(index >= steps.length) {
			callback(null, allResults);
			return;
		}
		var step = steps[index];
		var stepType = step.type || "command";

		// Check condition
		if(!checkCondition(step.condition)) {
			var skipped = {stepId: step.id, skipped: true};
			stepResults[step.id] = skipped;
			allResults.push(skipped);
			runStep(index + 1);
			return;
		}

		// Select steps are client-side — return marker with candidate outputs from referenced step
		if(stepType === "select") {
			var selectRef = (step.input || "").match(/^step:(.+)$/);
			var candidateOutputs = [];
			if(selectRef && stepResults[selectRef[1]] && stepResults[selectRef[1]].outputs) {
				candidateOutputs = stepResults[selectRef[1]].outputs;
			}
			var selectMarker = {
				stepId: step.id,
				type: "select",
				step: step,
				outputs: candidateOutputs
			};
			stepResults[step.id] = selectMarker;
			allResults.push(selectMarker);
			runStep(index + 1);
			return;
		}

		// LLM steps are client-side — return marker
		if(stepType === "llm") {
			var llmInputPath = resolveInput(step, inputPath, stepResults);
			var inputText = "";
			// If input references a captureStdout step, use its text
			var inputRef = (step.input || "").match(/^step:(.+)$/);
			if(inputRef && stepResults[inputRef[1]] && stepResults[inputRef[1]].text) {
				inputText = stepResults[inputRef[1]].text;
			}
			var marker = {
				stepId: step.id,
				type: "llm",
				step: step,
				inputText: inputText
			};
			stepResults[step.id] = marker;
			allResults.push(marker);
			runStep(index + 1);
			return;
		}

		// Command step
		var stepInput = resolveInput(step, inputPath, stepResults);
		var outputPath = buildOutputPath(step, stepInput, sourceDir);
		var outputFilePath = buildOutputFilePath(step, stepInput, sourceDir);

		executeCommand(step, stepInput, outputPath, function(err, stdout) {
			if(err) {
				// Step failed — skip but continue pipeline
				var errResult = {stepId: step.id, error: err.message};
				stepResults[step.id] = errResult;
				allResults.push(errResult);
				runStep(index + 1);
				return;
			}

			var result = {stepId: step.id, artifact: step.artifact};

			if(step.captureStdout) {
				// Text output from stdout
				var maxSize = parseInt(resolveConfigRef("{{config:$:/config/rimir/file-pipeline/max-extraction-size}}")) || 500000;
				var text = stdout;
				if(text.length > maxSize) {
					text = text.substring(0, maxSize) + "\n\n... [extraction truncated at " + maxSize + " chars]";
				}
				result.text = text;
			} else if(step.scanDir && outputPath) {
				// Multiple output files — scan the output directory
				var scanPath = path.dirname(outputPath);
				var files = scanDirectory(scanPath, step.scanExtensions);
				result.outputs = [];
				for(var f = 0; f < files.length; f++) {
					var relToSource = path.relative(sourceDir, files[f].filePath).replace(/\\/g, "/");
					result.outputs.push({
						filename: files[f].filename,
						uri: uriDir + "/" + relToSource,
						filePath: files[f].filePath
					});
				}
			} else if(outputPath) {
				// Single file output — use outputFilePath for the actual result if available
				var actualOutput = outputFilePath || outputPath;
				var relToSource = path.relative(sourceDir, actualOutput).replace(/\\/g, "/");
				result.uri = uriDir + "/" + relToSource;
				result.outputPath = actualOutput;
			}

			stepResults[step.id] = result;
			allResults.push(result);
			runStep(index + 1);
		});
	}

	runStep(0);
};
