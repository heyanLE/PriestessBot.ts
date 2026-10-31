## MODIFIED Requirements

### Requirement: Knowledge base persistence
The system SHALL persist knowledge libraries, source documents, versions, chunks, extraction provenance and ingestion status. Text, Markdown and PDF SHALL be initial supported imports.

#### Scenario: Create and list knowledge bases
- **WHEN** an authorized operator creates a library
- **THEN** it SHALL be returned with stable identity and metadata

#### Scenario: Add text document
- **WHEN** a valid text document is imported
- **THEN** versioned chunks and source references SHALL be stored with observable indexing status

### Requirement: Keyword retrieval
The system SHALL preserve deterministic sparse/keyword retrieval over only the libraries and documents allowed by the selected Agent and effective run authorization.

#### Scenario: Query matches relevant chunk
- **WHEN** a query matches terms in an authorized chunk
- **THEN** it SHALL be eligible for a positive sparse score

#### Scenario: Limit search results
- **WHEN** a search requests a bounded result limit
- **THEN** no more than the limit SHALL be returned

#### Scenario: Scope filters retrieval
- **WHEN** another library contains a highly matching but unauthorized chunk
- **THEN** that chunk SHALL be excluded before results are exposed

#### Scenario: Authorization changes
- **WHEN** access is revoked before retrieval
- **THEN** the request SHALL not read the revoked library even if an earlier configuration snapshot selected it

## ADDED Requirements

### Requirement: Hybrid retrieval and index lifecycle
Retrieval SHALL combine sparse and vector results with fusion and optional reranking. Indexes SHALL record embedding model/version/dimensions and support rebuild, failed-job retry and document deletion consistency.

#### Scenario: Embedding changes
- **WHEN** an embedding model or vector dimension changes
- **THEN** incompatible indexes SHALL be rebuilt or rejected rather than queried as compatible

#### Scenario: Document deletion
- **WHEN** an authorized document deletion completes
- **THEN** its chunks SHALL be removed from subsequent sparse/vector/reranked results and caches

### Requirement: Source-rich retrieval results
Knowledge results SHALL include library/document identity, version and available page/section references; extracted document content SHALL remain untrusted context.

#### Scenario: PDF reference
- **WHEN** a result comes from a parsed PDF page
- **THEN** the result SHALL preserve the page and source document reference
