/*\
title: $:/plugins/rimir/file-pipeline/test/test-connection-ref.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the LLM connection reference resolution order in pipeline-client, and for
connection errors in LLM steps.

\*/
"use strict";

describe("file-pipeline: pickConnectionRef", function() {

	var pick = require("$:/plugins/rimir/file-pipeline/pipeline-client")._test.pickConnectionRef;

	it("step.connection wins over everything", function() {
		expect(pick({connection: "A", provider: "claude"}, {connection: "B", provider: "openai"})).toEqual({connection: "A"});
	});

	it("step.connection wins over dropzone provider", function() {
		expect(pick({connection: "A"}, {provider: "openai"})).toEqual({connection: "A"});
	});

	it("step.provider wins over dropzone connection, and stays a type ref", function() {
		expect(pick({provider: "claude"}, {connection: "B", provider: "openai"})).toEqual({type: "claude"});
	});

	it("dropzone connection wins over dropzone provider", function() {
		expect(pick({}, {connection: "B", provider: "openai"})).toEqual({connection: "B"});
	});

	it("dropzone provider is used when nothing else is set, as a type ref", function() {
		expect(pick({}, {provider: "openai"})).toEqual({type: "openai"});
	});

	it("falls back to empty string (default connection)", function() {
		expect(pick({}, {})).toBe("");
		expect(pick({})).toBe("");
	});
});

describe("file-pipeline: LLM step connection errors", function() {

	var client = require("$:/plugins/rimir/file-pipeline/pipeline-client");
	var ORCH = "$:/plugins/rimir/llm-connect/orchestrator";
	var HELPERS = "$:/plugins/rimir/llm-connect/widget-helpers";
	var defined;

	// Use the real llm-connect modules when loaded, else minimal stand-ins
	function ensureModule(title, exportsObj) {
		if(!$tw.modules.titles[title]) {
			$tw.modules.define(title, "library", function(module, exports) { $tw.utils.extend(exports, exportsObj); });
			defined.push(title);
		}
		return require(title);
	}

	beforeEach(function() {
		defined = [];
		ensureModule(ORCH, {getAdapter: function() {}, runAction: function() {}});
		ensureModule(HELPERS, {resolveProviderConfig: function() {}});
	});
	afterEach(function() {
		defined.forEach(function(t) { delete $tw.modules.titles[t]; });
	});

	function run(step) {
		var result = {};
		expect(function() {
			client._test.executeLlmStep(step, "input", "$:/test/fp-source", "f.txt", {}, function(err, text) {
				result.err = err;
				result.text = text;
			});
		}).not.toThrow();
		return result;
	}

	it("an unresolvable connection reaches the callback instead of throwing", function() {
		spyOn(require(HELPERS), "resolveProviderConfig").and.throwError('Unknown connection "nope"');
		var result = run({id: "s1", connection: "nope"});
		expect(result.err && result.err.message).toBe('Unknown connection "nope"');
	});

	it("zero connections reach the callback instead of throwing", function() {
		spyOn(require(HELPERS), "resolveProviderConfig").and.returnValue({provider: ""});
		spyOn(require(ORCH), "getAdapter").and.throwError("No connection configured");
		var result = run({id: "s1"});
		expect(result.err && result.err.message).toBe("No connection configured");
	});
});
