/*\
title: $:/plugins/rimir/file-pipeline/test/test-artifact-hook.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for createMultiFileArtifacts: per-output MIME inference + the
rimir-file-pipeline-artifact-created hook payload (used for nested-pipeline
recursion + cycle protection).

\*/
"use strict";

describe("file-pipeline: createMultiFileArtifacts", function() {

	var client = require("$:/plugins/rimir/file-pipeline/pipeline-client");

	// TW 5.3.x has no removeHook, so we register once and gate via a flag.
	var captured = [];
	var active = false;
	var hookInstalled = false;

	beforeAll(function() {
		if(!hookInstalled) {
			$tw.hooks.addHook("rimir-file-pipeline-artifact-created", function(data) {
				if(active) captured.push(data);
				return data;
			});
			hookInstalled = true;
		}
	});

	beforeEach(function() {
		captured.length = 0;
		active = true;
	});

	afterEach(function() {
		active = false;
	});

	it("creates one tiddler per output with MIME inferred from each filename", function() {
		var src = "$:/test/fp/parent-" + Date.now() + ".msg";
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: src,
			type: "application/vnd.ms-outlook",
			_canonical_uri: "/files/email/parent.msg"
		}));
		try {
			client._test.createMultiFileArtifacts(
				src,
				{prefix: ".attachments/", type: "attachment"},
				[
					{filename: "att_invoice.pdf", uri: "/files/email/_derived/parent.msg/att_invoice.pdf"},
					{filename: "att_logo.png", uri: "/files/email/_derived/parent.msg/att_logo.png"},
					{filename: "att_forwarded.msg", uri: "/files/email/_derived/parent.msg/att_forwarded.msg"}
				],
				{}
			);

			var pdfTitle = src + ".attachments/att_invoice.pdf";
			var pngTitle = src + ".attachments/att_logo.png";
			var msgTitle = src + ".attachments/att_forwarded.msg";

			expect($tw.wiki.tiddlerExists(pdfTitle)).toBe(true);
			expect($tw.wiki.getTiddler(pdfTitle).fields.type).toBe("application/pdf");
			expect($tw.wiki.getTiddler(pdfTitle).fields._canonical_uri).toBe(
				"/files/email/_derived/parent.msg/att_invoice.pdf"
			);
			expect($tw.wiki.getTiddler(pdfTitle).fields._artifact_source).toBe(src);
			expect($tw.wiki.getTiddler(pdfTitle).fields._artifact_type).toBe("attachment");

			expect($tw.wiki.getTiddler(pngTitle).fields.type).toBe("image/png");
			expect($tw.wiki.getTiddler(msgTitle).fields.type).toBe("application/vnd.ms-outlook");
		} finally {
			$tw.wiki.deleteTiddler(src);
			$tw.wiki.deleteTiddler(src + ".attachments/att_invoice.pdf");
			$tw.wiki.deleteTiddler(src + ".attachments/att_logo.png");
			$tw.wiki.deleteTiddler(src + ".attachments/att_forwarded.msg");
		}
	});

	it("honors explicit artifact.tiddlerType over inferred type", function() {
		var src = "$:/test/fp/explicit-type-" + Date.now();
		try {
			client._test.createMultiFileArtifacts(
				src,
				{prefix: ".x/", tiddlerType: "application/x-custom"},
				[{filename: "a.pdf", uri: "/x/a.pdf"}, {filename: "b.png", uri: "/x/b.png"}],
				{}
			);
			expect($tw.wiki.getTiddler(src + ".x/a.pdf").fields.type).toBe("application/x-custom");
			expect($tw.wiki.getTiddler(src + ".x/b.png").fields.type).toBe("application/x-custom");
		} finally {
			$tw.wiki.deleteTiddler(src + ".x/a.pdf");
			$tw.wiki.deleteTiddler(src + ".x/b.png");
		}
	});

	it("fires rimir-file-pipeline-artifact-created with the seen-set on each output", function() {
var src = "$:/test/fp/hook-" + Date.now();
		var seenIn = {"/already/in/seen": true};
		try {
			client._test.createMultiFileArtifacts(
				src,
				{prefix: ".attachments/"},
				[
					{filename: "a.pdf", uri: "/u/a.pdf"},
					{filename: "b.png", uri: "/u/b.png"}
				],
				seenIn
			);

			expect(captured.length).toBe(2);
			expect(captured[0].title).toBe(src + ".attachments/a.pdf");
			expect(captured[0].uri).toBe("/u/a.pdf");
			expect(captured[0].type).toBe("application/pdf");
			expect(captured[0].sourceTitle).toBe(src);
			// seen is passed by reference; check the prior URI survives.
			expect(captured[0].seen["/already/in/seen"]).toBe(true);

			expect(captured[1].title).toBe(src + ".attachments/b.png");
			expect(captured[1].type).toBe("image/png");
		} finally {
			$tw.wiki.deleteTiddler(src + ".attachments/a.pdf");
			$tw.wiki.deleteTiddler(src + ".attachments/b.png");
		}
	});

	it("defaults seen to {} when caller omits it", function() {
var src = "$:/test/fp/no-seen-" + Date.now();
		try {
			client._test.createMultiFileArtifacts(
				src,
				{prefix: ".x/"},
				[{filename: "c.pdf", uri: "/u/c.pdf"}]
				// no seen arg
			);
			expect(captured.length).toBe(1);
			expect(typeof captured[0].seen).toBe("object");
		} finally {
			$tw.wiki.deleteTiddler(src + ".x/c.pdf");
		}
	});

	it("inherits pa.parent from the source tiddler onto each artifact", function() {
		// Artifacts produced from a parent that's anchored to an orga-apps note
		// (via pa.parent) must share the same anchor so the note's attachment
		// grid surfaces them — without this, PDF attachments of a .msg dropped
		// on a note were tracked correctly via _artifact_source but never
		// rendered because the grid filters by pa.parent.
		var src = "$:/test/fp/inherit-context-" + Date.now();
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: src,
			type: "application/vnd.ms-outlook",
			"pa.parent": "work/some-note"
		}));
		try {
			client._test.createMultiFileArtifacts(
				src,
				{prefix: ".attachments/", type: "attachment"},
				[{filename: "att_x.pdf", uri: "/u/att_x.pdf"}],
				{}
			);
			var artTiddler = $tw.wiki.getTiddler(src + ".attachments/att_x.pdf");
			expect(artTiddler).toBeTruthy();
			expect(artTiddler.fields["pa.parent"]).toBe("work/some-note");
		} finally {
			$tw.wiki.deleteTiddler(src);
			$tw.wiki.deleteTiddler(src + ".attachments/att_x.pdf");
		}
	});

	it("does NOT add pa.parent when the source has none", function() {
		var src = "$:/test/fp/no-context-" + Date.now();
		$tw.wiki.addTiddler(new $tw.Tiddler({title: src, type: "application/vnd.ms-outlook"}));
		try {
			client._test.createMultiFileArtifacts(
				src,
				{prefix: ".attachments/"},
				[{filename: "att_y.pdf", uri: "/u/att_y.pdf"}],
				{}
			);
			var artTiddler = $tw.wiki.getTiddler(src + ".attachments/att_y.pdf");
			expect(artTiddler.fields["pa.parent"]).toBeUndefined();
		} finally {
			$tw.wiki.deleteTiddler(src);
			$tw.wiki.deleteTiddler(src + ".attachments/att_y.pdf");
		}
	});

	it("does nothing when artifact has no prefix", function() {
client._test.createMultiFileArtifacts(
			"$:/test/fp/no-prefix",
			{},  // no prefix
			[{filename: "a.pdf", uri: "/x/a.pdf"}],
			{}
		);
		expect(captured.length).toBe(0);
	});
});
