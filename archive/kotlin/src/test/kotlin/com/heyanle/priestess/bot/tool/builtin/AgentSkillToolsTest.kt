package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.skill.SkillPromptReference
import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import java.util.Comparator
import kotlin.test.*

class AgentSkillToolsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `list and view only expose authorized mounted skills and keep pinned documents unloaded`() = runBlocking {
        Fixture().use { f ->
            val mounted = f.skill(f.platform, "mounted", "old disk content")
            f.skill(f.config, "unmounted", "must not be exposed")
            f.skill(f.legacy, "legacy-leak", "must not be exposed")
            val state = PipelineSkillState(listOf(
                SkillPromptReference("mounted", "Authorized platform skill", mounted.toString(), "pinned content"),
                SkillPromptReference("admin-only", inlineMarkdown = "secret", requiredPermissionGroup = PermissionGroup.ADMIN),
            ), PermissionGroup.OPERATOR)
            val context = f.context(PermissionGroup.OPERATOR, state)
            val listed = SkillsListTool().execute(context, emptyMap())
            assertEquals(listOf("mounted"), json.decodeFromString<SkillsListResponse>(listed.output).skills.map { it.name })
            val viewed = SkillViewTool().execute(context, mapOf("name" to "mounted"))
            assertTrue(viewed.success, viewed.error)
            assertEquals("pinned content", json.decodeFromString<SkillViewResponse>(viewed.output).content)
            assertTrue(state.loadedNames.isEmpty())
            assertNull(state.reference("admin-only"))
            assertNull(state.peek("admin-only"))
            for (name in listOf("unmounted", "legacy-leak", "admin-only")) {
                val denied = SkillViewTool().execute(context, mapOf("name" to name))
                assertFalse(denied.success, name)
                assertEquals("SKILL_NOT_FOUND", denied.errorCode)
            }
            val guide = mounted.parent.resolve("docs/guide.md")
            Files.createDirectories(guide.parent)
            Files.writeString(guide, "authorized supporting document")
            val supporting = SkillViewTool().execute(context, mapOf("name" to "mounted", "file_path" to "docs/guide.md"))
            assertTrue(supporting.success, supporting.error)
            assertEquals("authorized supporting document", json.decodeFromString<SkillViewResponse>(supporting.output).content)
            val outside = f.root.resolve("outside.md")
            Files.writeString(outside, "outside")
            Files.createSymbolicLink(mounted.parent.resolve("leak.md"), outside)
            for (path in listOf("../outside.md", "leak.md", outside.toString(), "./SKILL.md")) {
                assertFalse(SkillViewTool().execute(context, mapOf("name" to "mounted", "file_path" to path)).success, path)
            }
        }
    }

    @Test
    fun `skill management defaults to temporary source and enforces tool and mount permissions without reload`() = runBlocking {
        Fixture().use { f ->
            var reloadCalls = 0
            val manage = SkillManageTool { reloadCalls++; error("v3 must not reload a workspace") }
            val context = f.context(PermissionGroup.ADMIN)
            val create = mapOf("action" to "create", "name" to "created", "content" to "new temporary skill")
            assertEquals(PermissionGroup.ADMIN, manage.schema.requiredPermissionGroup)
            val created = manage.execute(context, create)
            assertTrue(created.success, created.error)
            assertTrue(Files.exists(f.temp.resolve("skills/created/SKILL.md")))
            assertFalse(Files.exists(f.config.resolve("skills/created/SKILL.md")))
            assertContains(json.decodeFromString<SkillManageResponse>(created.output).warning.orEmpty(), "next request")
            assertTrue(context.skillState.availableNames.isEmpty())
            assertEquals(0, reloadCalls)
            val configDenied = manage.execute(context, create + ("source" to "CONFIGURATION"))
            assertEquals("PERMISSION_DENIED", configDenied.errorCode)
            assertFalse(Files.exists(f.config.resolve("skills/created")))
            assertEquals("SKILL_SOURCE_DENIED", manage.execute(f.context(PermissionGroup.SUPER_ADMIN), create + ("source" to "PLATFORM")).errorCode)
            val disabled = f.context(PermissionGroup.SUPER_ADMIN).let { it.copy(metadata = it.metadata + ("temporarySkillEnabled" to "false")) }
            assertEquals("SKILL_SOURCE_DISABLED", manage.execute(disabled, create).errorCode)
            val unknownPermission = context.copy(metadata = context.metadata - "temporarySkillPermission")
            assertEquals("PERMISSION_DENIED", manage.execute(unknownPermission, create).errorCode)
            val ordinary = f.context(PermissionGroup.OPERATOR).let { it.copy(metadata = it.metadata + ("temporarySkillPermission" to "OPERATOR")) }
            assertEquals("PERMISSION_DENIED", manage.execute(ordinary, create).errorCode)
            assertEquals(0, reloadCalls)
        }
    }

    @Test
    fun `local mutations cannot reach platform libraries another source or symbolic links`() = runBlocking {
        Fixture().use { f ->
            val platformFile = f.skill(f.platform, "platform-only", "platform original")
            val state = PipelineSkillState(listOf(SkillPromptReference("platform-only", markdownPath = platformFile.toString(), inlineMarkdown = "platform original")), PermissionGroup.SUPER_ADMIN)
            val context = f.context(PermissionGroup.SUPER_ADMIN, state)
            val manage = SkillManageTool()
            for (action in listOf("edit", "delete")) {
                assertFalse(manage.execute(context, mapOf("source" to "CONFIGURATION", "action" to action, "name" to "platform-only", "content" to "replacement")).success)
            }
            assertEquals("platform original", Files.readString(platformFile))
            for (source in listOf("CONFIGURATION", "TEMPORARY")) {
                assertTrue(manage.execute(context, mapOf("source" to source, "action" to "create", "name" to "local", "content" to "$source body")).success)
            }
            assertTrue(manage.execute(context, mapOf("action" to "patch", "name" to "local", "old_string" to "TEMPORARY", "new_string" to "patched")).success)
            assertEquals("patched body", Files.readString(f.temp.resolve("skills/local/SKILL.md")))
            assertEquals("CONFIGURATION body", Files.readString(f.config.resolve("skills/local/SKILL.md")))
            assertTrue(manage.execute(context, mapOf("action" to "write_file", "name" to "local", "file_path" to "docs/reference.md", "file_content" to "reference")).success)
            val outside = f.root.resolve("outside.md")
            Files.writeString(outside, "outside original")
            Files.createSymbolicLink(f.temp.resolve("skills/local/leak.md"), outside)
            for (path in listOf("../../../outside.md", "leak.md", outside.toString())) {
                assertFalse(manage.execute(context, mapOf("action" to "write_file", "name" to "local", "file_path" to path, "file_content" to "overwrite")).success, path)
            }
            assertEquals("outside original", Files.readString(outside))
            assertEquals(listOf("platform-only"), state.availableNames)
            assertEquals("platform original", state.peek("platform-only")?.markdown)
        }
    }

    private class Fixture : AutoCloseable {
        val root = Files.createTempDirectory("agent-skill-tools").toRealPath()
        val config = Files.createDirectory(root.resolve("config"))
        val temp = Files.createDirectory(root.resolve("temp"))
        val platform = Files.createDirectory(root.resolve("platform"))
        val legacy = Files.createDirectory(root.resolve("legacy"))
        fun context(permission: PermissionGroup, state: PipelineSkillState = PipelineSkillState()) = AgentToolContext(
            metadata = mapOf(
                "agentConfigDirectory" to config.toString(), "agentTempDirectory" to temp.toString(),
                "configurationSkillEnabled" to "true", "configurationSkillPermission" to "SUPER_ADMIN",
                "temporarySkillEnabled" to "true", "temporarySkillPermission" to "ADMIN",
                "workspaceRootDir" to legacy.toString(), "workspaceId" to "legacy-workspace",
            ),
            permissionGroup = permission,
            skillState = state,
        )
        fun skill(directory: Path, name: String, content: String): Path {
            val file = directory.resolve("skills/$name/SKILL.md")
            Files.createDirectories(file.parent)
            Files.writeString(file, content)
            return file
        }
        override fun close() {
            Files.walk(root).use { it.sorted(Comparator.reverseOrder()).forEach(Files::deleteIfExists) }
        }
    }
}
