/*\
title: $:/plugins/rimir/file-pipeline/handlers-startup
type: application/javascript
module-type: startup

Registers widget message handlers for pipeline interactive flows:
- tm-fp-use-artifact: completes interactive LLM step (wires up resumeInteractive)
- tm-fp-confirm-select: completes frame/image selection step
- tm-fp-cancel-select: cancels selection without creating artifacts

\*/
"use strict";

exports.name = "file-pipeline-handlers";
exports.platforms = ["browser"];
exports.after = ["startup"];

exports.startup = function() {
	var pipelineClient = require("$:/plugins/rimir/file-pipeline/pipeline-client");

	// --- Interactive LLM step: "Use as Artifact" button ---
	$tw.rootWidget.addEventListener("tm-fp-use-artifact", function(event) {
		var params = event.paramObject || {};
		var sourceTitle = params.sourceTitle;
		var messages = params.messages;
		if(!sourceTitle) return;
		// Extract the last assistant message as the response text
		var responseText = "";
		if(messages) {
			try {
				var parsed = JSON.parse(messages);
				for(var i = parsed.length - 1; i >= 0; i--) {
					if(parsed[i].role === "assistant") {
						responseText = parsed[i].content || "";
						break;
					}
				}
			} catch(e) {
				responseText = messages;
			}
		}
		pipelineClient.resumeInteractive(sourceTitle, responseText);
	});

	// --- Select step: "Confirm" button ---
	$tw.rootWidget.addEventListener("tm-fp-confirm-select", function(event) {
		var params = event.paramObject || {};
		var sourceTitle = params.sourceTitle;
		if(!sourceTitle) return;
		// Read single selected URI from the choice tiddler
		var choiceTiddler = $tw.wiki.getTiddler("$:/temp/rimir/file-pipeline/select-choice");
		var selectedUri = choiceTiddler ? (choiceTiddler.fields.text || "").trim() : "";
		pipelineClient.resumeSelect(sourceTitle, selectedUri);
	});

	// --- Select step: "Cancel" button ---
	$tw.rootWidget.addEventListener("tm-fp-cancel-select", function(event) {
		var params = event.paramObject || {};
		var sourceTitle = params.sourceTitle;
		if(sourceTitle) {
			pipelineClient.cancelSelect(sourceTitle);
		} else {
			// Stale state — just clean up state tiddlers
			$tw.wiki.deleteTiddler("$:/state/rimir/file-pipeline/select");
			$tw.wiki.deleteTiddler("$:/temp/rimir/file-pipeline/select-choice");
		}
	});
};
