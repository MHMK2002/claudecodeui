# Voice cleanup benchmark

This directory contains a privacy-safe, dependency-free evaluator for voice cleanup experiments. It does not call an STT or LLM API. It validates local corpus files, reads precomputed transcript variants, and emits aggregate metrics only.

Real recordings and transcripts must be collected with consent and kept under `local-private/`, which is gitignored. Generated reports belong under `results/`, which is also gitignored. The committed `synthetic/` corpus exercises the evaluator without private data, but it is not evidence of real-world quality and is not a substitute for the planned 150+ sample consented corpus.

## Run

Use Node.js 18 or newer:

```sh
node scripts/voice-cleanup-benchmark.mjs \
  --manifest benchmarks/voice-cleanup/local-private/manifest.jsonl \
  --output benchmarks/voice-cleanup/results/report.json
```

Smoke-test the evaluator with the committed synthetic corpus:

```sh
node scripts/voice-cleanup-benchmark.mjs \
  --manifest benchmarks/voice-cleanup/synthetic/manifest.jsonl \
  --output benchmarks/voice-cleanup/results/synthetic-report.json
```

The output path must not already exist. Run `node scripts/voice-cleanup-benchmark.mjs --help` for CLI help. Invalid arguments, malformed JSONL, duplicate identifiers or variants, missing files, and invalid metadata exit nonzero.

## Manifest format

The manifest is JSONL: one JSON object per sample. File references may be absolute or relative to the manifest file, but must be local paths rather than URLs or data URIs.

Each sample supports:

- `id` (required): a unique non-empty string. IDs are used for validation only and are not copied to the report.
- `audio` (optional): local audio file. The evaluator validates that it is a file but does not decode or copy it.
- `raw` (optional): UTF-8 raw STT transcript. When present, it becomes the `raw` variant.
- `reference` (optional): UTF-8 human reference transcript. CER, WER, and normalized edit distance are computed for each available variant only when this field is present.
- `criticalSpans` (optional): local UTF-8 JSON file containing either a string array or `{ "spans": [...] }`. Preservation is exact, case-sensitive, and Unicode NFKC-aware.
- `results` (optional): an array of precomputed cleanup result records.

Each result record supports:

- `variant` and `transcript` (required): one aggregate label from `baseline-stt`, `contextual-stt`, `cleanup-ungated`, or `cleanup-gated`, plus a local UTF-8 transcript file. Arbitrary labels are rejected so private identifiers cannot leak into report keys; `raw` and `reference` are reserved names.
- `latencyMs` (optional): finite non-negative number.
- `fallback` (optional): boolean.
- `costUsd` (optional): finite non-negative number.
- `harmfulEditCount` (optional): non-negative integer supplied by a human annotation pass. The evaluator deliberately does not infer harmful semantic edits.

See `manifest.example.jsonl` for the shape and `synthetic/manifest.jsonl` for a runnable example. A private critical-span file can look like:

```json
{"spans":["useVoiceInput","--force","gpt-4o-mini"]}
```

## Metrics and privacy

Text is normalized with Unicode NFKC, whitespace is collapsed, and then:

- CER is character Levenshtein edits divided by reference character count.
- WER is word-token Levenshtein edits divided by reference word count.
- Normalized edit distance is character edits divided by the longer of candidate and reference.
- Critical-span preservation is the exact preserved-span count divided by annotated spans.
- Latency reports min, mean, p50, p95, and max. Fallback reports count/rate; cost reports total/mean; harmful edits report only human-provided counts.

The report contains aggregate variant statistics and corpus counts only. The CLI never prints or emits transcript text, audio content, critical-span values, local paths, or sample identifiers. Validation messages identify only the manifest line and field that failed.
