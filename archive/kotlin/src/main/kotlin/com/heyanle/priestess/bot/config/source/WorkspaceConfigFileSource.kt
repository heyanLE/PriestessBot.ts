package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.RawWorkspaceConfigState
import com.heyanle.priestess.bot.config.model.SourceFingerprint
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.resolve.ConfigurationProvenanceBuilder
import java.nio.file.Files
import java.nio.file.Path

class WorkspaceConfigFileSource(
    private val decoder: WorkspaceConfigDocumentDecoder = WorkspaceConfigDocumentDecoder(),
    private val provenance: ConfigurationProvenanceBuilder = ConfigurationProvenanceBuilder(),
    private val fileStore: RevisionedConfigFileStore = RevisionedConfigFileStore(),
) {
    fun load(entry: WorkspaceCatalogEntryDocument, globalDirectory: Path): ConfigurationSourceResult<RawWorkspaceConfigState> {
        val rootCandidate = Path.of(entry.directory)
        val root = (if (rootCandidate.isAbsolute) rootCandidate else globalDirectory.resolve(rootCandidate))
            .toAbsolutePath()
            .normalize()
        val configPath = root.resolve("config.yaml")
        if (!Files.isRegularFile(configPath)) return failure("WORKSPACE_CONFIG_FILE_MISSING", "Workspace config.yaml does not exist", configPath)
        val yaml = runCatching { Files.readString(configPath) }.getOrElse { cause ->
            return failure("WORKSPACE_CONFIG_READ_FAILED", cause.message ?: "Failed to read Workspace config.yaml", configPath)
        }
        val decoded = decoder.decodeWorkspace(yaml, configPath.toString())
        var document = decoded.value ?: return ConfigurationSourceResult(diagnostics = decoded.diagnostics)
        val diagnostics = decoded.diagnostics.toMutableList()
        val mcpPath = root.resolve("mcpserver.json")
        val mcpText = if (Files.isRegularFile(mcpPath)) Files.readString(mcpPath) else ""
        if (mcpText.isNotBlank()) {
            val mcp = decoder.decodeMcpServers(mcpText, mcpPath.toString())
            diagnostics += mcp.diagnostics
            val mcpDocument = mcp.value ?: return ConfigurationSourceResult(diagnostics = diagnostics)
            if (document.mcpServers.isNotEmpty() && mcpDocument.mcpServers.isNotEmpty()) {
                diagnostics += ConfigurationDiagnostic(
                    "WORKSPACE_MCP_MULTIPLE_AUTHORITIES",
                    DiagnosticSeverity.ERROR,
                    "Declare MCP servers in mcpserver.json or config.yaml, not both",
                    configPath.toString(),
                    "mcpServers",
                )
                return ConfigurationSourceResult(diagnostics = diagnostics)
            }
            if (mcpDocument.mcpServers.isNotEmpty()) document = document.copy(mcpServers = mcpDocument.mcpServers)
        }
        val fingerprint = provenance.fingerprint(yaml, mcpText)
        return ConfigurationSourceResult(
            value = RawWorkspaceConfigState(
                document = document,
                sourcePath = configPath.toString(),
                revision = fileStore.revisionOf(yaml),
                fingerprint = SourceFingerprint(fingerprint.value),
            ),
            diagnostics = diagnostics,
        )
    }

    private fun failure(code: String, message: String, path: Path) = ConfigurationSourceResult<RawWorkspaceConfigState>(
        diagnostics = listOf(ConfigurationDiagnostic(code, DiagnosticSeverity.ERROR, message, path.toString())),
    )
}
