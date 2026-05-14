/*\
title: $:/plugins/rimir/file-pipeline/test/test-mime-inference.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for inferMimeFromFilename in pipeline-client.

\*/
"use strict";

describe("file-pipeline: inferMimeFromFilename", function() {

	var client = require("$:/plugins/rimir/file-pipeline/pipeline-client");
	var infer = client.inferMimeFromFilename;

	it("returns application/pdf for .pdf", function() {
		expect(infer("invoice.pdf")).toBe("application/pdf");
	});

	it("returns application/vnd.ms-outlook for .msg", function() {
		expect(infer("forwarded.msg")).toBe("application/vnd.ms-outlook");
	});

	it("returns message/rfc822 for .eml", function() {
		expect(infer("legacy.eml")).toBe("message/rfc822");
	});

	it("returns image/png for .png", function() {
		expect(infer("thumb.png")).toBe("image/png");
	});

	it("returns image/jpeg for both .jpg and .jpeg", function() {
		expect(infer("photo.jpg")).toBe("image/jpeg");
		expect(infer("photo.jpeg")).toBe("image/jpeg");
	});

	it("returns the docx office MIME for .docx", function() {
		expect(infer("report.docx")).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		);
	});

	it("is case-insensitive on the extension", function() {
		expect(infer("REPORT.PDF")).toBe("application/pdf");
		expect(infer("Photo.JPG")).toBe("image/jpeg");
	});

	it("takes the last segment when a name has multiple dots", function() {
		expect(infer("archive.tar.gz")).toBe("application/gzip");
		expect(infer("backup.2026.05.14.zip")).toBe("application/zip");
	});

	it("returns application/octet-stream when the extension is unknown", function() {
		expect(infer("data.xyz")).toBe("application/octet-stream");
	});

	it("returns application/octet-stream when there is no extension", function() {
		expect(infer("Makefile")).toBe("application/octet-stream");
	});

	it("returns application/octet-stream for empty / non-string input", function() {
		expect(infer("")).toBe("application/octet-stream");
		expect(infer(null)).toBe("application/octet-stream");
		expect(infer(undefined)).toBe("application/octet-stream");
		expect(infer(42)).toBe("application/octet-stream");
	});

	it("covers archive formats", function() {
		expect(infer("a.zip")).toBe("application/zip");
		expect(infer("a.7z")).toBe("application/x-7z-compressed");
		expect(infer("a.tar")).toBe("application/x-tar");
	});

	it("covers calendar / vcard", function() {
		expect(infer("event.ics")).toBe("text/calendar");
		expect(infer("contact.vcf")).toBe("text/vcard");
	});
});

describe("file-pipeline: matchesAnyPipeline", function() {

	var client = require("$:/plugins/rimir/file-pipeline/pipeline-client");

	beforeEach(function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/test/fp/pipeline/x",
			tags: "$:/tags/rimir/file-pipeline/pipeline",
			type: "application/json",
			text: JSON.stringify({
				name: "x-test",
				match: ["application/x-test"],
				steps: [{id: "noop", action: "echo"}]
			})
		}));
	});

	afterEach(function() {
		$tw.wiki.deleteTiddler("$:/test/fp/pipeline/x");
	});

	it("returns true when a registered pipeline matches the MIME", function() {
		expect(client.matchesAnyPipeline("application/x-test")).toBe(true);
	});

	it("returns false for an unmatched MIME", function() {
		expect(client.matchesAnyPipeline("application/x-nope-" + Date.now())).toBe(false);
	});

	it("returns false for empty MIME", function() {
		expect(client.matchesAnyPipeline("")).toBe(false);
		expect(client.matchesAnyPipeline(null)).toBe(false);
		expect(client.matchesAnyPipeline(undefined)).toBe(false);
	});

	it("ignores pipeline tiddlers with malformed JSON", function() {
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/test/fp/pipeline/bad",
			tags: "$:/tags/rimir/file-pipeline/pipeline",
			type: "application/json",
			text: "{not valid"
		}));
		try {
			expect(client.matchesAnyPipeline("application/x-test")).toBe(true);
		} finally {
			$tw.wiki.deleteTiddler("$:/test/fp/pipeline/bad");
		}
	});
});
