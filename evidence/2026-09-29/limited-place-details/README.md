# Limited place-details recognition — September 29, 2026

## Problem

The September29 automatic UAT run queried `see joy`. Google opened **She-Joy's Sweet Treats**, a different business, in a limited place-details view with a heading, Save/Send to phone/Share controls and website/phone, but no Directions or address action. The old detector required one of those latter actions and returned `partial / unsupported_layout`.

This is an observed query-to-place resolution, not proof that all brand queries open details or that the returned business is the enrolled merchant. The original keyword must remain unchanged. A detail page has no ranked list and cannot imply rank1.

## Intended behavior

Recognize the witnessed limited details layout using positive, visible controls associated with the named details pane. Continue requiring loaded content; URL/heading alone or scattered toolbar text is insufficient. CAPTCHA/consent and visible results retain precedence. Preserve the known standard detail path.

Save optional structured `quality.placeDetails` evidence with the actual name, Maps URL, recognition method and observed signals. Keep the original `keyword`, zero ranked listings and a header-only CSV for a detail-only response. Persist diagnostic screenshot, JSON, CSV and observations evidence using existing non-ranking execution rules. Missing evidence still prevents complete execution. No brand heuristic, keyword/location rewrite or own-store identity match is introduced.

This release is scoped to detail detection and evidence. The separately observed `float` priced/no-Directions housing variant remains unresolved in the September29 run. Historical evidence and its original exit2 are unchanged.

## Validation status

Implementation and acceptance are in progress. Local regression, independent review, fresh UAT capture, independent Azure readback and deployment results will be recorded before completion. `dom-source-provenance.json` binds the captured direct-URL DOM/PNG that reproduces this layout; that direct navigation is not a new keyword-search result.
