# ccpc2019xiamen

## Status

skipped-source-format

## Source

- acmss entry: `acmss/ccpc/2019/xiamen/2019xiamen.pdf`
- menu text: 2019-10-22 厦门（厦门理工）
- source href: `pdf_support_plugins/web/viewer.html?file=../../ccpc/2019/xiamen/2019xiamen.pdf`
- copied raw path: `convert/ccpc2019xiamen/ccpc2019xiamen/`
- source format: `pdf`

## Scope Decision

This entry is retained as raw evidence but skipped for SRK conversion because the menu target is a PDF file. No structured HTML/XLS/JSON/JS ranklist source was identified in the menu entry path during inventory.

## Existing SRK Comparison

Existing SRK: `official/ccpc/ccpc2019/ccpc2019xiamen.srk.json`.

The acmss source is not used to overwrite or supplement the existing SRK at this stage because it is not a structured conversion source.

## Conversion Plan

No converter is planned for this entry unless a trustworthy structured source is found later in the same raw directory or from an accepted external source.

## Reproduction

```bash
node scripts/create-skipped-source-reports.js
```

## Validation

- Raw source directory copied from `acmss/ccpc/2019/xiamen` to `convert/ccpc2019xiamen/ccpc2019xiamen/`.
- `node scripts/audit-convert.js` requires this report and copied raw directory for the terminal skip status.

Retained files:

- `convert/ccpc2019xiamen/ccpc2019xiamen/2019xiamen.pdf`

## Review

Independent source-vs-SRK review is not required for `skipped-source-format` entries because no SRK is generated.

## Merge Targets

- collectionTarget: `official/ccpc/ccpc2019/ccpc2019xiamen.srk.json`
- rawTarget: `files/ccpc2019xiamen/`
- assetsPrefix: `ccpc2019xiamen/assets/`
- official/config.yaml: no update proposed by this skipped entry.

## Open Questions

- None for the skip decision. Revisit only if a structured source becomes available.
