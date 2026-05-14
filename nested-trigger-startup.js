/*\
title: $:/plugins/rimir/file-pipeline/nested-trigger-startup
type: application/javascript
module-type: startup

Hooks into the artifact-created event so that any pipeline-produced artifact
whose MIME matches a registered pipeline gets its own pipeline run. This is
how email attachments become first-class: dropping a `.msg` with a PDF
attachment leaves you with the parent `.msg`, the `.email` tiddler, AND a
properly-thumbnailed PDF artifact (its own pipeline triggers automatically).

Cycle protection: every recursive trigger carries a `seen` map of URIs that
have already been processed in this top-level chain. We skip if the artifact's
URI is already in the map — stops `.msg`-contains-itself loops and identical-
attachment churn within the same recursion.

\*/
"use strict";

exports.name = "rimir-file-pipeline-nested-trigger";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

exports.startup = function() {
	if(!$tw.hooks || typeof $tw.hooks.addHook !== "function") return;

	var pipelineClient;
	try {
		pipelineClient = require("$:/plugins/rimir/file-pipeline/pipeline-client");
	} catch(e) {
		return;
	}

	$tw.hooks.addHook("rimir-file-pipeline-artifact-created", function(data) {
		if(!data || !data.title || !data.uri || !data.type) return data;

		var seen = data.seen || {};
		if(seen[data.uri]) {
			// Cycle: this exact file has already been pipelined in the current
			// recursion. Skip without complaint.
			return data;
		}

		// Only recurse if a pipeline actually matches this MIME — avoids needless
		// HTTP round-trips for inert artifacts (e.g. plain text snippets).
		if(typeof pipelineClient.matchesAnyPipeline === "function" &&
			!pipelineClient.matchesAnyPipeline(data.type)) {
			return data;
		}

		var extendedSeen = {};
		for(var k in seen) extendedSeen[k] = seen[k];
		extendedSeen[data.uri] = true;

		pipelineClient.runPipeline({
			sourceTitle: data.title,
			uri: data.uri,
			pipeline: "auto",
			mimeType: data.type,
			filename: extractFilename(data.uri),
			seen: extendedSeen,
			onError: function(err) {
				console.warn("nested file-pipeline failed for " + data.title + ": " + (err && err.message));
			}
		});

		return data;
	});
};

function extractFilename(uri) {
	if(!uri) return "";
	var decoded;
	try { decoded = decodeURIComponent(uri); } catch(e) { decoded = uri; }
	var slash = decoded.lastIndexOf("/");
	return slash >= 0 ? decoded.substring(slash + 1) : decoded;
}
