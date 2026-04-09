# File Pipeline

Configurable binary data processing pipelines for TiddlyWiki. Define multi-step workflows that transform uploaded files into thumbnails, extracted text, format conversions, and LLM-generated analysis — all linked to the source file with automatic lifecycle management.

## Features

- **Configurable pipelines** — define processing steps per file type as tiddlers (no restart needed)
- **Command steps** — run shell commands (ImageMagick, pdftotext, pandoc, LibreOffice, custom scripts)
- **LLM steps** — send extracted text to an LLM for summarization, annotation, or analysis (auto or interactive mode)
- **Step chaining** — output of one step feeds into the next (e.g., DOC → DOCX → PDF → thumbnail)
- **Artifact lifecycle** — all generated tiddlers linked via `_artifact_source` for automatic cascade delete/rename
- **Auto-matching** — pipelines auto-select based on MIME type, or can be explicitly chosen
- **Auto-detection** — when installed alongside file-upload, all dropzones automatically use pipelines

## Default Pipelines

| Pipeline | File Types | Steps |
|----------|-----------|-------|
| pdf | PDF | Thumbnail + text extraction + image extraction |
| docx | DOCX | Convert to PDF + thumbnail + text extraction |
| image | JPEG, PNG, GIF, WebP | Thumbnail |
| xlsx | XLSX | Text extraction |

## Prerequisites

- **runner** plugin — provides `runner-actions.json` command execution
- **file-upload** plugin — provides URI resolution and artifact cascade
- **llm-connect** plugin — required only for LLM pipeline steps (optional)

External tools (as needed by your pipelines):
- `magick` / `magick.exe` — ImageMagick for thumbnails
- `pdftotext` — poppler-utils for PDF text extraction
- `pdfimages` — poppler-utils for PDF image extraction
- `pandoc` — for DOCX/markdown conversion
- `libreoffice` — for DOC → DOCX and DOCX → PDF conversion

## Installation

Install via the plugin library or copy the plugin folder to your wiki's `plugins/` directory. Add `"rimir/file-pipeline"` to your `tiddlywiki.info` plugins list.

When file-pipeline is installed alongside file-upload, all `<$file-dropzone>` widgets automatically trigger pipelines. Thumbnail and extraction settings in file-upload are replaced by file-pipeline's settings.

## Custom Pipelines

Create a tiddler tagged `$:/tags/rimir/file-pipeline/pipeline` with `type: application/json`:

```json
{
  "name": "my-pipeline",
  "match": ["application/pdf"],
  "steps": [
    {
      "id": "text",
      "action": "extract-pdf-text",
      "input": "source",
      "captureStdout": true,
      "artifact": {"type": "extraction", "suffix": ".extracted", "tiddlerType": "text/x-markdown"}
    },
    {
      "id": "summary",
      "type": "llm",
      "input": "step:text",
      "mode": "auto",
      "promptTemplate": "$:/my/prompt/template",
      "artifact": {"type": "summary", "suffix": ".summary", "tiddlerType": "text/x-markdown"}
    }
  ]
}
```

## LLM Step Configuration

LLM steps can be configured at three levels (highest priority first):

1. **Step level** — `systemPrompt`, `provider`, `model` fields in step JSON (supports `{{config:...}}` indirection)
2. **Dropzone level** — `prop-system-prompt`, `prop-provider`, `prop-model` attributes on `<$file-dropzone>`
3. **Global default** — llm-connect's provider/model/system-prompt settings

```html
<$file-dropzone pipeline="docx-llm"
  prop-system-prompt="$:/my/custom-system-prompt"
  prop-model="gpt-4o">
  Drop files here
</$file-dropzone>
```

## License

MIT