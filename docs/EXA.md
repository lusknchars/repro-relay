# Exa research in Relay

Configure **Settings → Connections → Exa** with an API key from [your Exa dashboard](https://dashboard.exa.ai/api-keys). Plow remains first and selected by default. Keys are stored only in the installation's `.data/exa/connection.json`, with Unix directory/file permissions 0700/0600. Saving a key does not contact Exa or claim authenticated access; the first explicit search checks access. Disconnect deletes the key and retains research history. This version supports the trusted local installation, managed by its administrator.

Open **Architecture → Search architectures & tools with Exa**. Write a query or use the architecture/tool presets. Search sends that query alone to Exa, retrieves up to five results with at most 1,500 characters of extracted text per page, and records the results in PostgreSQL. No repository files, names or manifests are automatically added to the query. Review the query before sending it.

Results retain source URLs, capture time, publication metadata when available and Exa's estimated request cost. Missing cost remains unknown. This estimate is separate from Hermes/model usage and is not an authoritative invoice or a spending ceiling. The latest ten searches are available in the panel, including failed or uncertain requests. Provider requests are not automatically retried. A stored request ID prevents a repeated request from issuing another paid call; a fresh Search click starts a new request and may be charged again. A lost response or interrupted process can leave a pending/unknown record.

Select up to two sources, then click **Research improvements**. Relay includes their links and 300-character excerpts in the existing source-bound Hermes assessment. Selection is explicit and clears on navigation/reload; saved results remain available to select again. The report marks page text as untrusted reference data and asks Hermes to evaluate fit and cite sources. The existing repository snapshot, saved team workflow, model access and run limits still apply. Oversized assessment context is rejected before creating work.

This is search with content extraction, not a general site crawler, package installer or new autonomous Hermes tool grant. It does not change a workflow, install a discovered tool, claim measured improvement, or publish memory. Review the assessment before deciding what to apply.

## Validation

Local HTTP and PostgreSQL fixtures cover key storage, bounded result projection, invalid credentials, source-link validation, request identity, cost provenance, retained history and guest restrictions. Browser fixtures cover key entry, explicit search, saved source selection, the architecture assessment handoff and narrow layouts. These checks make no live Exa or model requests.

## Provider contract

[Exa Search API](https://exa.ai/docs/reference/search) documents `POST /search`, `x-api-key`, `numResults`, nested `contents.text.maxCharacters` and `costDollars`. Exa describes `costDollars` as an estimate, with billing computed from usage counters.
