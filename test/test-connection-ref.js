/*\
title: $:/plugins/rimir/file-pipeline/test/test-connection-ref.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the LLM connection reference resolution order in pipeline-client.

\*/
"use strict";

describe("file-pipeline: pickConnectionRef", function() {

	var pick = require("$:/plugins/rimir/file-pipeline/pipeline-client")._test.pickConnectionRef;

	it("step.connection wins over everything", function() {
		expect(pick({connection: "A", provider: "claude"}, {connection: "B", provider: "openai"})).toBe("A");
	});

	it("step.connection wins over dropzone provider", function() {
		expect(pick({connection: "A"}, {provider: "openai"})).toBe("A");
	});

	it("step.provider wins over dropzone connection", function() {
		expect(pick({provider: "claude"}, {connection: "B", provider: "openai"})).toBe("claude");
	});

	it("dropzone connection wins over dropzone provider", function() {
		expect(pick({}, {connection: "B", provider: "openai"})).toBe("B");
	});

	it("dropzone provider is used when nothing else is set", function() {
		expect(pick({}, {provider: "openai"})).toBe("openai");
	});

	it("falls back to empty string (default connection)", function() {
		expect(pick({}, {})).toBe("");
		expect(pick({})).toBe("");
	});
});
