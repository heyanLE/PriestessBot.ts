package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.ConfigurationSourceKind
import com.heyanle.priestess.bot.config.model.CredentialReference
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ConfigurationSourcesTest {
    private val json = Json { encodeDefaults = true }

    @Test
    fun `config path precedence is command line environment then default`() {
        val root = Files.createTempDirectory("config-path-selector")
        val selector = ConfigPathSelector(
            environment = { name -> if (name == ConfigPathSelector.CONFIG_PATH_ENV) "environment.json" else null },
            baseDirectory = root,
        )

        val cli = assertNotNull(selector.resolve(listOf("--config", "cli.json")).value)
        assertEquals(root.resolve("cli.json"), cli.path)
        assertEquals(ConfigurationSourceKind.COMMAND_LINE, cli.sourceKind)

        val environment = assertNotNull(selector.resolve().value)
        assertEquals(root.resolve("environment.json"), environment.path)
        assertEquals(ConfigurationSourceKind.ENVIRONMENT, environment.sourceKind)

        val fallback = assertNotNull(
            ConfigPathSelector(environment = { null }, baseDirectory = root).resolve().value,
        )
        assertEquals(root.resolve("config.json"), fallback.path)
        assertEquals(ConfigurationSourceKind.DEFAULT, fallback.sourceKind)
    }

    @Test
    fun `invalid or duplicate command line config arguments are rejected`() {
        val missing = ConfigPathSelector(environment = { null }).resolve(listOf("--config"))
        val duplicate = ConfigPathSelector(environment = { null })
            .resolve(listOf("--config=a.json", "--config=b.json"))

        assertFalse(missing.isSuccess)
        assertFalse(duplicate.isSuccess)
        assertTrue(duplicate.diagnostics.any { it.code == "CONFIG_PATH_ARGUMENT_INVALID" })
    }

    @Test
    fun `global decoder accepts BOM and rejects unknown duplicate and unsupported schema fields`() {
        val decoder = AppConfigDocumentDecoder()
        val valid = json.encodeToString(AppConfigDocument())

        assertTrue(decoder.decode("\uFEFF$valid", "app.json").isSuccess)
        assertTrue(decoder.decode(valid.dropLast(1) + ",\"unknown\":true}", "app.json").diagnostics.any {
            it.code == "CONFIG_JSON_UNKNOWN_FIELD" && it.path == "unknown"
        })
        assertTrue(decoder.decode("{\"schemaVersion\":2,\"schemaVersion\":2}", "app.json").diagnostics.any { it.code == "CONFIG_JSON_INVALID" })
        assertTrue(decoder.decode("{\"schemaVersion\":1}", "app.json").diagnostics.any { it.code == "CONFIG_SCHEMA_VERSION_UNSUPPORTED" })
    }

    @Test
    fun `workspace and MCP decoders reject unknown and duplicate fields`() {
        val decoder = WorkspaceConfigDocumentDecoder()
        val validWorkspace = """
            schemaVersion: 2
            id: default
            name: Default
            primaryAgentId: assistant
            agents:
              - id: assistant
                providerRef: provider-a
                model: model-a
        """.trimIndent()

        assertTrue(decoder.decodeWorkspace(validWorkspace, "config.yaml").isSuccess)
        assertFalse(decoder.decodeWorkspace(validWorkspace + "\nunknown: value", "config.yaml").isSuccess)
        assertFalse(decoder.decodeWorkspace(validWorkspace + "\nid: duplicate", "config.yaml").isSuccess)

        val validMcp = """{"schemaVersion":2,"mcpServers":[]}"""
        assertTrue(decoder.decodeMcpServers(validMcp, "mcpserver.json").isSuccess)
        assertFalse(decoder.decodeMcpServers("""{"schemaVersion":2,"unknown":true}""", "mcpserver.json").isSuccess)
        assertFalse(decoder.decodeMcpServers("""{"schemaVersion":2,"schemaVersion":2,"mcpServers":[]}""", "mcpserver.json").isSuccess)
    }

    @Test
    fun `typed environment overrides reject invalid values and resolve referenced secrets without mutating source`() {
        val document = AppConfigDocument(
            providers = listOf(
                ProviderConnectionDocument(
                    id = "provider-a",
                    type = "openai-compatible",
                    credentialRef = CredentialReference(key = "PROVIDER_A_KEY"),
                ),
            ),
        )
        val before = json.encodeToString(document)
        val values = mapOf(
            "PRIESTESS_SERVER_PORT" to "28080",
            "PRIESTESS_SERVER_ENABLED" to "yes",
            "PRIESTESS_CONFIG_WATCH_INTERVAL_MILLIS" to "100",
            "PROVIDER_A_KEY" to "actual-secret",
        )
        val source = EnvironmentOverrideSource(values::get)

        val overrides = source.read()
        val credential = source.resolveCredential(checkNotNull(document.providers.single().credentialRef), "providers[provider-a].credential")

        assertEquals(28_080, overrides.overrides.serverPort)
        assertEquals(true, overrides.overrides.serverEnabled)
        assertNull(overrides.overrides.reloadIntervalMillis)
        assertTrue(overrides.diagnostics.any { it.code == "CONFIG_ENV_OVERRIDE_INVALID" })
        assertEquals("***", credential.credential.toString())
        assertEquals(before, json.encodeToString(document))
        assertFalse(json.encodeToString(document).contains("actual-secret"))
    }

    @Test
    fun `revisioned store writes atomically detects conflict and backs up valid previous content`() {
        val root = Files.createTempDirectory("revisioned-config-store")
        val path = root.resolve("config.json")
        val store = RevisionedConfigFileStore(
            Clock.fixed(Instant.parse("2026-08-11T00:00:00Z"), ZoneOffset.UTC),
        )

        val first = assertIs<PersistResult.Success>(store.persist(path, "first", expectedRevision = null))
        assertEquals("first", path.readText())

        val conflict = store.persist(path, "stale", expectedRevision = RawConfigRevision("stale"))
        assertIs<PersistResult.Conflict>(conflict)
        assertEquals("first", path.readText())

        val second = assertIs<PersistResult.Success>(store.persist(path, "second", expectedRevision = first.revision))
        assertEquals("second", path.readText())
        assertNotEquals(first.revision, second.revision)
        assertNotNull(second.backupPath)
        assertEquals("first", second.backupPath.readText())
    }

    @Test
    fun `passive file load preserves empty malformed and unknown-field source content`() {
        val root = Files.createTempDirectory("safe-config-source")
        val path = root.resolve("config.json")
        val source = AppConfigFileSource()

        Files.writeString(path, "   \n")
        val empty = source.load(path)
        assertFalse(empty.isSuccess)
        assertEquals("   \n", path.readText())

        Files.writeString(path, "{ malformed")
        val malformed = source.load(path)
        assertFalse(malformed.isSuccess)
        assertEquals("{ malformed", path.readText())

        val unknown = json.encodeToString(AppConfigDocument()).dropLast(1) + ",\"unknown\":true}"
        Files.writeString(path, unknown)
        assertFalse(source.load(path).isSuccess)
        assertEquals(unknown, path.readText())
    }

    @Test
    fun `explicit bootstrap initializes only a missing or blank source`() {
        val root = Files.createTempDirectory("config-bootstrap")
        val missing = root.resolve("missing.json")
        val blank = root.resolve("blank.json")
        val occupied = root.resolve("occupied.json")
        Files.writeString(blank, "  ")
        Files.writeString(occupied, "operator-content")
        val source = AppConfigFileSource()

        assertTrue(source.bootstrap(missing).isSuccess)
        assertTrue(source.bootstrap(blank).isSuccess)
        assertFalse(source.bootstrap(occupied).isSuccess)
        assertEquals("operator-content", occupied.readText())
    }

    @Test
    fun `stable watcher ignores transient truncation and emits only final stable revision`() {
        val root = Files.createTempDirectory("stable-watcher")
        val path = root.resolve("config.json")
        Files.writeString(path, "initial")
        val watcher = StableConfigFileWatcher(path, stabilityWindowMillis = 500)

        Files.writeString(path, "")
        assertNull(watcher.poll(100))
        Files.writeString(path, "final")
        assertNull(watcher.poll(200))
        assertNull(watcher.poll(699))
        val stable = assertNotNull(watcher.poll(700))

        assertEquals(path.toAbsolutePath().normalize(), stable.path)
        assertEquals(RevisionedConfigFileStore().revision(path), stable.revision)
        assertNull(watcher.poll(1_000))
    }
}
