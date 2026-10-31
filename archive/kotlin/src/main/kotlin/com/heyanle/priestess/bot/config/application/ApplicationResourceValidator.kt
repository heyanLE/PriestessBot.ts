package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager

/** Validate selected persistent resources on every publication path, including startup and watch. */
object ApplicationResourceValidator {
    fun validate(document: ApplicationConfigurationDocument, source: String): List<ConfigurationDiagnostic> {
        val selected = document.agents.filter { it.enabled && it.personaId != null }
        if (selected.isEmpty()) return emptyList()
        val database = ApplicationConfigurationSource().resolveDirectory(Path.of(source), document.platformDirectory).resolve("resources.sqlite")
        val available = if (!Files.isRegularFile(database)) emptySet() else runCatching {
            DriverManager.getConnection("jdbc:sqlite:$database").use { connection ->
                connection.prepareStatement("SELECT id FROM personas WHERE workspace_id='platform' AND enabled=1 AND deleted_at IS NULL").use { statement ->
                    statement.executeQuery().use { rows -> buildSet { while (rows.next()) add(rows.getString(1)) } }
                }
            }
        }.getOrElse { return listOf(ConfigurationDiagnostic("PERSONA_STORE_UNAVAILABLE", DiagnosticSeverity.ERROR, "Cannot inspect the platform persona store", source, "platformDirectory")) }
        return selected.filter { it.personaId !in available }.map {
            ConfigurationDiagnostic("AGENT_PERSONA_UNAVAILABLE", DiagnosticSeverity.ERROR, "Agent '${it.id}' selects a missing or disabled persona '${it.personaId}'", source, "agents.${it.id}.personaId")
        }
    }
}
