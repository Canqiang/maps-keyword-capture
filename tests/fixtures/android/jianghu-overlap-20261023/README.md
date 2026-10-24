# Jianghu frame23/24 regression provenance

The four source artifacts were independently downloaded using Azure CLI identity and checked against the original writer receipts in `provenance.json`. Original PNGs are retained in the private container and durable evidence archive described in `evidence/2026-10-23/android-ocr-concurrency/README.md`.

Git normalizes XML CRLF to LF. The receipt hashes describe the immutable original bytes, while the checked-in XML differs only in newline encoding. `fixture-source-audit.json` in the 2026-10-24 evidence directory records both original and Git-blob hashes. The OCR JSON bytes are unchanged. Parsing the fixture is a regression replay, not fresh native capture or visual proof.
