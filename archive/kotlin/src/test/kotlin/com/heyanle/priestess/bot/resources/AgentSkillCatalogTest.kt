package com.heyanle.priestess.bot.resources

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.testkit.testRuntimeConfiguration
import java.nio.file.Files
import java.nio.file.Path
import java.util.Comparator
import kotlin.test.*

class AgentSkillCatalogTest {
    @Test
    fun `three sources have deterministic precedence and mount permissions cannot be lowered by frontmatter`() {
        AgentSkillFixture().use { f ->
            f.catalog.writeLibrary("lib", LibrarySkillWriteRequest("shared", f.markdown("shared", "platform")))
            f.catalog.writeLibrary("lib", LibrarySkillWriteRequest("platform-only", f.markdown("platform-only", "public")))
            f.catalog.writeAgent("agent", AgentSkillWriteRequest(SkillResourceSource.CONFIGURATION, "shared", f.markdown("shared", "configuration")))
            f.catalog.writeAgent("agent", AgentSkillWriteRequest(SkillResourceSource.TEMPORARY, "shared", "---\nname: shared\ndescription: Temporary copy\npermissionGroup: OPERATOR\n---\ntemporary"))
            val listing = f.catalog.listAgent("agent")
            assertEquals(4, listing.items.size)
            assertEquals(SkillResourceSource.TEMPORARY, listing.items.single { it.name == "shared" && it.enabled }.source)
            assertEquals(2, listing.diagnostics.count { it.contains("shadowed") })
            assertEquals(listOf("platform-only"), f.catalog.stateForAgent("agent", PermissionGroup.OPERATOR).availableNames)
            assertNull(f.catalog.stateForAgent("agent", PermissionGroup.ADMIN).load("shared"))
            assertContains(f.catalog.stateForAgent("agent", PermissionGroup.SUPER_ADMIN).load("shared")!!.markdown, "temporary")
            assertEquals(PermissionGroup.SUPER_ADMIN, listing.items.first { it.name == "shared" }.permissionGroup)
            assertTrue(listing.items.all { Path.of(it.path).isAbsolute })
        }
    }

    @Test
    fun `disabled source and agent remain editable while pinned snapshots keep their own selection`() {
        AgentSkillFixture().use { f ->
            f.catalog.writeAgent("agent", AgentSkillWriteRequest(SkillResourceSource.TEMPORARY, "demo", f.markdown("demo", "temp")))
            val pinned = f.runtime.case.current()
            f.publish(f.app.copy(agents = f.app.agents.map { it.copy(enabled = false) }))
            assertTrue(f.catalog.stateForAgent("agent", PermissionGroup.SUPER_ADMIN).availableNames.isEmpty())
            assertTrue(f.catalog.listAgent("agent").items.none { it.enabled })
            assertContains(f.catalog.readAgent("agent", SkillResourceSource.TEMPORARY, "demo").content, "temp")
            assertEquals(listOf("demo"), f.catalog.stateForAgent(pinned, "agent", PermissionGroup.SUPER_ADMIN).availableNames)
            f.catalog.writeAgent("agent", AgentSkillWriteRequest(SkillResourceSource.TEMPORARY, "demo", f.markdown("demo", "edited while disabled")))
            f.publish(f.app.copy(agents = f.app.agents.map { it.copy(skills = it.skills.copy(temporary = it.skills.temporary.copy(enabled = false))) }))
            assertTrue(f.catalog.stateForAgent("agent", PermissionGroup.SUPER_ADMIN).availableNames.isEmpty())
        }
    }

    @Test
    fun `platform library mount order breaks equal-priority ties with a diagnostic`() {
        AgentSkillFixture().use { f ->
            f.publish(f.app.copy(
                skillLibraries = f.app.skillLibraries + SkillLibraryDocument("second"),
                agents = f.app.agents.map { it.copy(skills = it.skills.copy(platformLibraries = it.skills.platformLibraries + AgentSkillLibraryBinding("second"))) },
            ))
            f.catalog.writeLibrary("lib", LibrarySkillWriteRequest("same", f.markdown("same", "first library")))
            f.catalog.writeLibrary("second", LibrarySkillWriteRequest("same", f.markdown("same", "second library")))
            val state = f.catalog.stateForAgent("agent", PermissionGroup.OPERATOR)
            val document = state.load("same")!!
            assertContains(document.markdown, "first library")
            assertContains(state.renderLoadedSkillBlock(), "Skill directory: ${Path.of(document.sourcePath!!).parent}")
            assertEquals(1, f.catalog.listAgent("agent").diagnostics.size)
        }
    }

    @Test
    fun `frontmatter name can differ from directory and CRUD preserves actual path with atomic replacement`() {
        AgentSkillFixture().use { f ->
            val directory = f.root.resolve("agents/agent/config/skills/original-folder")
            Files.createDirectories(directory)
            Files.writeString(directory.resolve("SKILL.md"), f.markdown("friendly", "before"))
            val item = f.catalog.listAgent("agent").items.single()
            assertEquals("friendly", item.name)
            assertEquals("Description for friendly", item.description)
            assertEquals(directory.resolve("SKILL.md").toString(), item.path)
            f.catalog.writeAgent("agent", AgentSkillWriteRequest(SkillResourceSource.CONFIGURATION, "friendly", f.markdown("friendly", "after")))
            assertContains(f.catalog.readAgent("agent", SkillResourceSource.CONFIGURATION, "friendly").content, "after")
            assertEquals(listOf("SKILL.md"), Files.list(directory).use { it.map { path -> path.fileName.toString() }.toList() })
            assertFalse(Files.exists(directory.parent.resolve("friendly")))
            assertFailsWith<IllegalArgumentException> {
                f.catalog.writeAgent("agent", AgentSkillWriteRequest(SkillResourceSource.CONFIGURATION, "friendly", f.markdown("renamed", "bad")))
            }
            assertContains(Files.readString(directory.resolve("SKILL.md")), "after")
        }
    }

    @Test
    fun `unsafe names symlinked directories and symlinked documents cannot escape the mount`() {
        AgentSkillFixture().use { f ->
            for (name in listOf("..", "../escape", "a/b", "a\\b", "/absolute", "nul\u0000name")) {
                assertFailsWith<IllegalArgumentException>(name) { f.catalog.readLibrary("lib", name) }
                assertFailsWith<IllegalArgumentException>(name) { f.catalog.writeLibrary("lib", LibrarySkillWriteRequest(name, "body")) }
            }
            val outside = Files.createDirectories(f.root.resolve("outside"))
            Files.writeString(outside.resolve("SKILL.md"), "sensitive outside document")
            val skillRoot = Files.createDirectories(f.root.resolve("data/platform/skills/lib"))
            Files.createSymbolicLink(skillRoot.resolve("linked-directory"), outside)
            val linkedFile = Files.createDirectory(skillRoot.resolve("linked-file"))
            Files.createSymbolicLink(linkedFile.resolve("SKILL.md"), outside.resolve("SKILL.md"))
            assertTrue(f.catalog.listLibrary("lib").items.isEmpty())
            assertEquals(2, f.catalog.listLibrary("lib").diagnostics.size)
            assertFails { f.catalog.readLibrary("lib", "linked-directory") }
            assertFails { f.catalog.readLibrary("lib", "linked-file") }
            assertFails { f.catalog.writeLibrary("lib", LibrarySkillWriteRequest("linked-directory", "overwrite")) }
            assertFails { f.catalog.writeLibrary("lib", LibrarySkillWriteRequest("linked-file", "overwrite")) }
            assertEquals("sensitive outside document", Files.readString(outside.resolve("SKILL.md")))
        }
    }

    @Test
    fun `bounded reads reject oversized documents and loaded state does not follow a replaced symlink`() {
        AgentSkillFixture().use { f ->
            val saved = f.catalog.writeLibrary("lib", LibrarySkillWriteRequest("stable", f.markdown("stable", "verified content")))
            val state = f.catalog.stateForAgent("agent", PermissionGroup.OPERATOR)
            val outside = f.root.resolve("outside.md")
            Files.writeString(outside, "untrusted replacement")
            Files.delete(Path.of(saved.path))
            Files.createSymbolicLink(Path.of(saved.path), outside)
            assertContains(state.load("stable")!!.markdown, "verified content")
            assertTrue(f.catalog.stateForAgent("agent", PermissionGroup.SUPER_ADMIN).availableNames.isEmpty())
            val huge = "x".repeat(AgentSkillCatalog.MAX_DOCUMENT_BYTES + 1)
            assertFailsWith<IllegalArgumentException> { f.catalog.writeLibrary("lib", LibrarySkillWriteRequest("huge", huge)) }
            val hugeDir = Files.createDirectories(f.root.resolve("data/platform/skills/lib/huge"))
            Files.writeString(hugeDir.resolve("SKILL.md"), huge)
            assertFailsWith<IllegalArgumentException> { f.catalog.readLibrary("lib", "huge") }
            assertFalse(f.catalog.listLibrary("lib").items.any { it.name == "huge" })
        }
    }
}

internal class AgentSkillFixture : AutoCloseable {
    val root: Path = Files.createTempDirectory("agent-skill-catalog").toRealPath()
    val runtime = testRuntimeConfiguration()
    val app = ApplicationConfigurationDocument(
        skillLibraries = listOf(SkillLibraryDocument("lib")),
        agents = listOf(AgentProfileDocument(
            id = "agent", llm = AgentLlmDocument("provider", "model"),
            skills = AgentSkillsDocument(
                platformLibraries = listOf(AgentSkillLibraryBinding("lib")),
                configuration = AgentLocalSkillDocument(permissionGroup = PermissionGroup.ADMIN),
                temporary = AgentLocalSkillDocument(permissionGroup = PermissionGroup.SUPER_ADMIN),
            ),
        )),
    )
    val catalog: AgentSkillCatalog
    init {
        publish(app)
        catalog = AgentSkillCatalog(runtime.case, root.resolve("config.json"))
    }
    fun publish(application: ApplicationConfigurationDocument) {
        runtime.store.publish(DesiredConfig(
            document = AppConfigDocument(), rawRevision = RawConfigRevision("skill-test-${System.nanoTime()}"),
            sourceFingerprint = SourceFingerprint("skill-test"), runtime = runtime.case.current().runtime,
            platforms = emptyMap(), providers = emptyMap(), workspaces = emptyMap(), provenance = emptyMap(), application = application,
        ))
    }
    fun markdown(name: String, body: String) = "---\nname: $name\ndescription: Description for $name\n---\n$body"
    override fun close() {
        runtime.store.close()
        Files.walk(root).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach(Files::deleteIfExists) }
    }
}
