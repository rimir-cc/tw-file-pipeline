/*\
title: $:/plugins/rimir/file-pipeline/pipeline-client
type: application/javascript
module-type: library

Browser-side pipeline client. Triggers pipeline execution on the server,
creates artifact tiddlers from results, and handles LLM steps (auto + interactive).

\*/
"use strict";

var STATUS_PREFIX = "$:/temp/rimir/file-pipeline/status/";
var PENDING_PREFIX = "$:/temp/rimir/file-pipeline/pending/";
var CHAT_PREFIX = "$:/temp/rimir/file-pipeline/chat/";
var INTERACTIVE_STATE = "$:/state/rimir/file-pipeline/interactive";

/*
Run a pipeline on a source file.

Options:
  uri        — canonical URI of the file
  pipeline   — pipeline name, or "auto" for MIME-type matching
  mimeType   — MIME type (used for auto-matching)
  sourceTitle — title of the source tiddler (for artifact creation)
  filename   — original filename (for prompt templates)
  onComplete — function(results) called when all steps (incl. LLM) are done
  onError    — function(error) called on failure
  onProgress — function(stepId, status) called per step
*/
exports.runPipeline = function(options) {
	var sourceTitle = options.sourceTitle;
	var uri = options.uri;
	var onComplete = options.onComplete || function() {};
	var onError = options.onError || function() {};
	var onProgress = options.onProgress || function() {};

	// Set status
	setStatus(sourceTitle, "Running pipeline...");

	// Call server route
	$tw.utils.httpRequest({
		url: "/api/file-pipeline",
		type: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-requested-with": "TiddlyWiki"
		},
		data: JSON.stringify({
			uri: uri,
			pipeline: options.pipeline || "auto",
			mimeType: options.mimeType
		}),
		callback: function(err, responseText) {
			if(err) {
				setStatus(sourceTitle, "");
				onError(new Error("Pipeline request failed: " + err));
				return;
			}
			var data;
			try {
				data = JSON.parse(responseText);
			} catch(e) {
				setStatus(sourceTitle, "");
				onError(new Error("Invalid pipeline response"));
				return;
			}
			if(data.status === "error") {
				setStatus(sourceTitle, "");
				onError(new Error(data.error));
				return;
			}
			if(data.status === "disabled" || data.status === "no-match") {
				setStatus(sourceTitle, "");
				onComplete([]);
				return;
			}
			processResults(sourceTitle, options, data.results || [], onComplete, onError, onProgress);
		}
	});
};

/*
Process server results: create artifacts for command steps, execute LLM steps.
*/
function processResults(sourceTitle, options, results, onComplete, onError, onProgress) {
	var extractedText = null;
	var allResults = [];

	function processStep(index) {
		if(index >= results.length) {
			setStatus(sourceTitle, "");
			onComplete(allResults);
			return;
		}
		var result = results[index];
		if(result.skipped || result.error) {
			allResults.push(result);
			processStep(index + 1);
			return;
		}
		onProgress(result.stepId, "processing");

		if(result.type === "llm") {
			// LLM step — execute client-side
			executeLlmStep(result.step, result.inputText, sourceTitle, options.filename, options.llmOptions, function(err, text) {
				if(err) {
					allResults.push({stepId: result.stepId, error: err.message});
					processStep(index + 1);
					return;
				}
				// Create artifact from LLM response
				createTextArtifact(sourceTitle, result.step.artifact, text);
				allResults.push({stepId: result.stepId, text: text, artifact: result.step.artifact});
				processStep(index + 1);
			}, function() {
				// Interactive mode pause — save remaining steps for resume
				savePendingState(sourceTitle, options, results, index, allResults);
			});
			return;
		}

		// Command step — create artifacts from result
		if(result.text !== undefined) {
			// Captured stdout → text artifact
			createTextArtifact(sourceTitle, result.artifact, result.text);
			if(result.artifact && result.artifact.type === "extraction") {
				extractedText = result.text;
			}
		} else if(result.outputs) {
			// Multi-file output → multiple artifacts
			createMultiFileArtifacts(sourceTitle, result.artifact, result.outputs);
		} else if(result.uri) {
			// Single file output
			if(result.artifact && result.artifact.setField) {
				setFieldOnSource(sourceTitle, result.artifact.setField, result.uri);
			} else if(result.artifact && result.artifact.suffix) {
				createFileArtifact(sourceTitle, result.artifact, result.uri);
			}
		}

		allResults.push(result);
		processStep(index + 1);
	}

	processStep(0);
}

// --- Artifact creation ---

function createTextArtifact(sourceTitle, artifact, text) {
	if(!artifact || !artifact.suffix) return;
	var title = sourceTitle + artifact.suffix;
	var fields = {
		title: title,
		text: text,
		type: artifact.tiddlerType || "text/vnd.tiddlywiki",
		"_artifact_source": sourceTitle,
		"_artifact_type": artifact.type || "extraction"
	};
	// Legacy field for backward compat with llm-connect
	if(artifact.type === "extraction") {
		fields["extraction-source"] = sourceTitle;
		fields["extraction-date"] = new Date().toISOString();
	}
	$tw.wiki.addTiddler(new $tw.Tiddler(fields));
}

function createFileArtifact(sourceTitle, artifact, uri) {
	if(!artifact || !artifact.suffix) return;
	var title = sourceTitle + artifact.suffix;
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: title,
		text: "",
		type: artifact.tiddlerType || "application/octet-stream",
		_canonical_uri: uri,
		"_artifact_source": sourceTitle,
		"_artifact_type": artifact.type || "derived"
	}));
}

function createMultiFileArtifacts(sourceTitle, artifact, outputs) {
	if(!artifact || !artifact.prefix) return;
	for(var i = 0; i < outputs.length; i++) {
		var output = outputs[i];
		var title = sourceTitle + artifact.prefix + output.filename;
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: title,
			text: "",
			type: artifact.tiddlerType || "image/png",
			_canonical_uri: output.uri,
			"_artifact_source": sourceTitle,
			"_artifact_type": artifact.type || "derived"
		}));
	}
}

function setFieldOnSource(sourceTitle, fieldName, value) {
	var tiddler = $tw.wiki.getTiddler(sourceTitle);
	if(!tiddler) return;
	var update = {};
	update[fieldName] = value;
	$tw.wiki.addTiddler(new $tw.Tiddler(tiddler, update));
}

// --- LLM step execution ---

function executeLlmStep(step, inputText, sourceTitle, filename, llmOptions, callback, onPause) {
	var opts = llmOptions || {};
	var mode = step.mode || "auto";

	if(mode === "interactive") {
		// Interactive mode — set up chat and pause pipeline
		setupInteractiveChat(step, inputText, sourceTitle, filename);
		if(onPause) onPause();
		return;
	}

	// Auto mode — call orchestrator.runAction() programmatically
	setStatus(sourceTitle, "LLM processing: " + (step.id || "..."));

	var orchestrator, helpers;
	try {
		orchestrator = require("$:/plugins/rimir/llm-connect/orchestrator");
		helpers = require("$:/plugins/rimir/llm-connect/widget-helpers");
	} catch(e) {
		callback(new Error("llm-connect plugin required for LLM pipeline steps"));
		return;
	}

	// Priority: step field > dropzone prop-* > global default
	var provider = resolveConfigRef(step.provider) || opts.provider;
	var model = resolveConfigRef(step.model) || opts.model;
	var systemPrompt = resolveConfigRef(step.systemPrompt) || opts.systemPrompt;
	var config = helpers.resolveProviderConfig(provider, model, systemPrompt);
	var adapter = orchestrator.getAdapter(config.provider);
	var prompt = renderPromptTemplate(step.promptTemplate, {
		text: inputText,
		title: sourceTitle,
		filename: filename || ""
	});

	// Override max-tokens for pipeline LLM steps (default is often too low)
	if(step.maxTokens) {
		config.maxTokens = String(resolveConfigRef(step.maxTokens));
	} else if(!config.maxTokens || parseInt(config.maxTokens) < 8192) {
		config.maxTokens = "8192";
	}

	// Only send prompt (which already contains {{text}}), not contextText too
	orchestrator.runAction({
		prompt: prompt,
		config: config,
		adapter: adapter
	}).then(function(responseText) {
		callback(null, responseText);
	})["catch"](function(err) {
		callback(err);
	});
}

function setupInteractiveChat(step, inputText, sourceTitle, filename) {
	var prompt = renderPromptTemplate(step.promptTemplate, {
		text: inputText,
		title: sourceTitle,
		filename: filename || ""
	});

	var provider = resolveConfigRef(step.provider) || "";
	var model = resolveConfigRef(step.model) || "";

	// Create a chat tiddler with pre-loaded context
	var chatTitle = CHAT_PREFIX + encodeURIComponent(sourceTitle);
	var messages = [
		{role: "user", content: prompt}
	];

	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: chatTitle,
		text: "",
		tags: "$:/tags/rimir/llm-connect/chat",
		"llm-messages": JSON.stringify(messages),
		"llm-provider": provider,
		"llm-model": model,
		"fp-source-title": sourceTitle,
		"fp-step-id": step.id,
		"fp-artifact": JSON.stringify(step.artifact || {})
	}));

	// Signal interactive mode
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: INTERACTIVE_STATE,
		text: chatTitle
	}));
}

/*
Resume pipeline after interactive step completes.
Called from the interactive chat panel's "Use as artifact" button.
*/
exports.resumeInteractive = function(sourceTitle, responseText) {
	// Read pending state
	var pendingTitle = PENDING_PREFIX + encodeURIComponent(sourceTitle);
	var pendingTiddler = $tw.wiki.getTiddler(pendingTitle);
	if(!pendingTiddler) return;

	var pending;
	try {
		pending = JSON.parse(pendingTiddler.fields.text);
	} catch(e) { return; }

	// Create the artifact from the interactive step
	var step = pending.currentStep;
	if(step && step.artifact) {
		createTextArtifact(sourceTitle, step.artifact, responseText);
	}

	// Clean up interactive state
	$tw.wiki.deleteTiddler(INTERACTIVE_STATE);
	$tw.wiki.deleteTiddler(CHAT_PREFIX + encodeURIComponent(sourceTitle));
	$tw.wiki.deleteTiddler(pendingTitle);

	// Resume remaining steps
	var remaining = pending.remainingResults || [];
	var allResults = pending.completedResults || [];
	allResults.push({stepId: step ? step.id : "interactive", text: responseText});

	processResults(sourceTitle, pending.options || {}, remaining, function(results) {
		var combined = allResults.concat(results);
		if(pending.options && pending.options.onComplete) {
			pending.options.onComplete(combined);
		}
	}, function() {}, function() {});
};

function savePendingState(sourceTitle, options, results, currentIndex, completedResults) {
	var pendingTitle = PENDING_PREFIX + encodeURIComponent(sourceTitle);
	var currentStep = results[currentIndex] ? results[currentIndex].step : null;
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: pendingTitle,
		text: JSON.stringify({
			sourceTitle: sourceTitle,
			currentStep: currentStep,
			remainingResults: results.slice(currentIndex + 1),
			completedResults: completedResults,
			options: {
				uri: options.uri,
				pipeline: options.pipeline,
				mimeType: options.mimeType,
				sourceTitle: sourceTitle,
				filename: options.filename
			}
		}),
		type: "application/json"
	}));
}

// --- Utility exports ---

/*
Check if an extracted text cache exists for a title.
Returns the text string or null.
*/
exports.getExtractedText = function(title) {
	var cacheTitle = title + ".extracted";
	var tiddler = $tw.wiki.getTiddler(cacheTitle);
	if(!tiddler) return null;
	return tiddler.fields.text || null;
};

/*
Check if any pipeline can process the given MIME type.
Works browser-side by scanning pipeline tiddlers.
*/
exports.isExtractable = function(mimeType) {
	var TAG = "$:/tags/rimir/file-pipeline/pipeline";
	var titles = $tw.wiki.filterTiddlers("[all[tiddlers+shadows]tag[" + TAG + "]]");
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if(!tiddler) continue;
		try {
			var def = JSON.parse(tiddler.fields.text);
			if(Array.isArray(def.match) && def.match.indexOf(mimeType) !== -1) {
				// Check if pipeline has a text extraction step
				for(var s = 0; s < (def.steps || []).length; s++) {
					if(def.steps[s].captureStdout && def.steps[s].artifact &&
					   def.steps[s].artifact.type === "extraction") {
						return true;
					}
				}
			}
		} catch(e) { /* skip */ }
	}
	return false;
};

// --- Helpers ---

function setStatus(sourceTitle, text) {
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: STATUS_PREFIX + encodeURIComponent(sourceTitle),
		text: text
	}));
}

function resolveConfigRef(value) {
	if(typeof value !== "string") return value;
	var match = value.match(/^\{\{config:(.+)\}\}$/);
	if(!match) return value;
	var tiddler = $tw.wiki.getTiddler(match[1]);
	return (tiddler && tiddler.fields.text || "").trim();
}

function renderPromptTemplate(templateTitle, vars) {
	if(!templateTitle) return vars.text || "";
	var tiddler = $tw.wiki.getTiddler(templateTitle);
	if(!tiddler) return vars.text || "";
	var text = tiddler.fields.text || "";
	return text
		.split("{{text}}").join(vars.text || "")
		.split("{{title}}").join(vars.title || "")
		.split("{{filename}}").join(vars.filename || "");
}
