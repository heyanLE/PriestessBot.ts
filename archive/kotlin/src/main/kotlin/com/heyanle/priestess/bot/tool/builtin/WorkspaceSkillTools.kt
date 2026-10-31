package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.resources.AgentSkillCatalog
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.workspace.WorkspaceCase
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.LinkOption
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.NoSuchFileException
import java.nio.file.attribute.BasicFileAttributes
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CancellationException
import org.snakeyaml.engine.v2.api.Load
import org.snakeyaml.engine.v2.api.LoadSettings
import kotlin.io.path.exists

class SkillsListTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "skills_list",
        description = "List skills authorized and mounted for the current Agent.",
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = false,
        auditLog = false,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        if ("agentConfigDirectory" in context.metadata) {
            val skills = context.skillState.authorizedReferences()
                .filter { context.permissionGroup.satisfies(it.requiredPermissionGroup) }
                .map { SkillSummary(it.name, it.description) }
            return ToolResult.success(json.encodeToString(SkillsListResponse(true, skills, skills.size)))
        }
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val skills = workspace.listSkills()
        return ToolResult.success(
            json.encodeToString(
                SkillsListResponse(
                    success = true,
                    skills = skills.map { SkillSummary(it.name, it.description) },
                    count = skills.size,
                ),
            ),
        )
    }
}

class SkillViewTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "skill_view",
        description = "Read an authorized mounted skill or a supporting file inside its own directory.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("name", description = "Skill name to inspect.", required = true),
                ParameterDef("file_path", description = "Optional relative path inside the skill directory."),
            ),
            required = listOf("name"),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = false,
        auditLog = false,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        if ("agentConfigDirectory" in context.metadata) return viewMountedSkill(context, args)
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val name = args["name"]?.trim().orEmpty()
        if (name.isBlank()) return ToolResult.error("name is required", "VALIDATION_ERROR")
        return runCatching {
            val skill = workspace.findSkillByName(name)
                ?: return ToolResult.error("Skill '$name' was not found", "SKILL_NOT_FOUND")
            val target = workspace.resolveSkillPath(name, args["file_path"])
            if (!target.exists()) {
                return ToolResult.error("File '${args["file_path"] ?: "SKILL.md"}' was not found in skill '$name'", "FILE_NOT_FOUND")
            }
            if (Files.isDirectory(target)) {
                return ToolResult.error("'${target.fileName}' is a directory", "IS_DIRECTORY")
            }
            val content = readUtf8(target)
            ToolResult.success(
                json.encodeToString(
                    SkillViewResponse(
                        success = true,
                        name = skill.name,
                        description = skill.description,
                        content = content,
                        filePath = skill.directory.relativize(target).toString(),
                    ),
                ),
            )
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to read skill", "SKILL_VIEW_FAILED")
        }
    }
    private fun viewMountedSkill(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val name = args["name"]?.trim().orEmpty()
        if (name.isEmpty()) return ToolResult.error("name is required", "VALIDATION_ERROR")
        val reference = context.skillState.reference(name)
            ?.takeIf { context.permissionGroup.satisfies(it.requiredPermissionGroup) }
            ?: return ToolResult.error("Skill '$name' is not mounted or authorized for this run", "SKILL_NOT_FOUND")
        return try {
            val requested = args["file_path"]?.takeIf { it.isNotBlank() } ?: "SKILL.md"
            val content = if (requested == "SKILL.md" && reference.inlineMarkdown != null) {
                context.skillState.peek(name)!!.markdown
            } else {
                val document = reference.markdownPath?.let { Path.of(it).toAbsolutePath().normalize() }
                    ?: return ToolResult.error("Skill has no supporting file directory", "FILE_NOT_FOUND")
                val target = AgentSkillToolFiles.resolve(document.parent, requested)
                AgentSkillToolFiles.read(target)
            }
            ToolResult.success(json.encodeToString(SkillViewResponse(true, name, reference.description, requested, content)))
        } catch (e: NoSuchFileException) {
            ToolResult.error("Skill file does not exist", "FILE_NOT_FOUND")
        } catch (e: Exception) {
            ToolResult.error(e.message ?: "Failed to read skill", "SKILL_VIEW_FAILED")
        }
    }

}

class SkillManageTool(
    private val workspaceCaseProvider: (() -> WorkspaceCase)? = null,
) : FunctionTool() {
    override val schema = ToolSchema(
        name = "skill_manage",
        description = "Manage skills in the current Agent configuration or temporary directory. Changes take effect on the next request.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("action", description = "One of create, edit, patch, delete, write_file, remove_file.", required = true),
                ParameterDef("name", description = "Skill name.", required = true),
                ParameterDef("source", description = "Agent skill source; defaults to TEMPORARY. Platform libraries cannot be modified.", enumValues = listOf("CONFIGURATION", "TEMPORARY")),
                ParameterDef("content", description = "Full SKILL.md content for create or edit."),
                ParameterDef("category", description = "Optional category hint. Current workspace runtime keeps a flat skills directory."),
                ParameterDef("file_path", description = "Relative file path inside the skill directory."),
                ParameterDef("file_content", description = "Full file content for write_file."),
                ParameterDef("old_string", description = "Exact text to replace for patch."),
                ParameterDef("new_string", description = "Replacement text for patch."),
                ParameterDef("replace_all", type = "boolean", description = "Replace all matching fragments for patch."),
            ),
            required = listOf("action", "name"),
        ),
        riskLevel = ToolRiskLevel.HIGH_RISK,
        defaultEnabled = false,
        auditLog = true,
        requiredPermissionGroup = PermissionGroup.ADMIN,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        if ("agentConfigDirectory" in context.metadata) return manageAgentSkill(context, args)
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val action = args["action"]?.trim().orEmpty()
        val name = args["name"]?.trim().orEmpty()
        if (action.isBlank() || name.isBlank()) return ToolResult.error("action and name are required", "VALIDATION_ERROR")

        return runCatching {
            val result = when (action) {
                "create" -> createSkill(workspace, name, args["content"], args["category"])
                "edit" -> editSkill(workspace, name, args["content"])
                "patch" -> patchSkill(workspace, name, args["file_path"], args["old_string"], args["new_string"], parseBooleanArg(args["replace_all"]))
                "delete" -> deleteSkill(workspace, name)
                "write_file" -> writeSkillFile(workspace, name, args["file_path"], args["file_content"])
                "remove_file" -> removeSkillFile(workspace, name, args["file_path"])
                else -> return ToolResult.error("Unknown action '$action'", "VALIDATION_ERROR")
            }
            ToolResult.success(json.encodeToString(result.copy(reload = reloadWorkspace(context))))
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Skill management failed", "SKILL_MANAGE_FAILED")
        }
    }

    private fun manageAgentSkill(context: AgentToolContext, args: Map<String, String>): ToolResult {
        if (!context.permissionGroup.satisfies(PermissionGroup.ADMIN)) {
            return ToolResult.error("Skill management requires ADMIN permission", "PERMISSION_DENIED")
        }
        val source = args["source"]?.trim()?.takeIf(String::isNotEmpty) ?: "TEMPORARY"
        val prefix = when (source) {
            "CONFIGURATION" -> "configuration"
            "TEMPORARY" -> "temporary"
            else -> return ToolResult.error("Only CONFIGURATION and TEMPORARY sources are writable", "SKILL_SOURCE_DENIED")
        }
        if (context.metadata["${prefix}SkillEnabled"]?.toBooleanStrictOrNull() != true) {
            return ToolResult.error("The selected Agent skill source is disabled", "SKILL_SOURCE_DISABLED")
        }
        val required = context.metadata["${prefix}SkillPermission"]?.let { value ->
            PermissionGroup.entries.firstOrNull { it.name == value }
        } ?: return ToolResult.error("Skill source permission is unavailable", "PERMISSION_DENIED")
        if (!context.permissionGroup.satisfies(required)) return ToolResult.error("Skill source requires $required", "PERMISSION_DENIED")
        val directoryKey = if (source == "TEMPORARY") "agentTempDirectory" else "agentConfigDirectory"
        val directory = context.metadata[directoryKey]?.takeIf(String::isNotBlank)
            ?: return ToolResult.error("Current Agent skill directory is unavailable", "WORKSPACE_REQUIRED")
        return try {
            val message = AgentSkillToolFiles.manage(Path.of(directory).toAbsolutePath().normalize().resolve("skills"), args)
            ToolResult.success(json.encodeToString(SkillManageResponse(
                success = true,
                message = message,
                warning = "Changes take effect on the next request; this run keeps its pinned skills.",
            )))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            ToolResult.error(e.message ?: "Skill management failed", "SKILL_MANAGE_FAILED")
        }
    }

    private fun createSkill(workspace: WorkspaceToolLocation, name: String, content: String?, category: String?): SkillManageResponse {
        if (content.isNullOrBlank()) throw IllegalArgumentException("content is required for create")
        if (workspace.findSkillByName(name) != null) throw IllegalArgumentException("Skill '$name' already exists")
        val dirName = skillDirectoryName(name)
        val skillDir = workspace.ensureSkillsDir().resolve(dirName)
        Files.createDirectories(skillDir)
        writeUtf8(skillDir.resolve("SKILL.md"), content)
        return SkillManageResponse(
            success = true,
            message = "Created skill '$name'",
            warning = category?.takeIf { it.isNotBlank() }?.let { "category is currently informational only in this workspace runtime" },
        )
    }

    private fun editSkill(workspace: WorkspaceToolLocation, name: String, content: String?): SkillManageResponse {
        if (content.isNullOrBlank()) throw IllegalArgumentException("content is required for edit")
        val target = workspace.resolveSkillPath(name)
        val format = fileFormat(target)
        writeUtf8(target, normalizeContentForWrite(content, format))
        return SkillManageResponse(success = true, message = "Updated SKILL.md for '$name'")
    }

    private fun patchSkill(
        workspace: WorkspaceToolLocation,
        name: String,
        filePath: String?,
        oldString: String?,
        newString: String?,
        replaceAll: Boolean,
    ): SkillManageResponse {
        if (oldString.isNullOrEmpty()) throw IllegalArgumentException("old_string is required for patch")
        if (newString == null) throw IllegalArgumentException("new_string is required for patch")
        val target = workspace.resolveSkillPath(name, filePath)
        if (!target.exists()) throw IllegalArgumentException("Target file '${filePath ?: "SKILL.md"}' was not found")
        val format = fileFormat(target)
        val original = readUtf8(target)
        val occurrences = original.windowed(oldString.length, 1).count { it == oldString }
        if (occurrences == 0) throw IllegalArgumentException("old_string was not found")
        if (!replaceAll && occurrences > 1) throw IllegalArgumentException("old_string matched $occurrences locations; set replace_all=true to patch every match")
        val updated = if (replaceAll) original.replace(oldString, newString) else original.replaceFirst(oldString, newString)
        writeUtf8(target, normalizeContentForWrite(updated.removePrefix("\uFEFF"), format))
        return SkillManageResponse(success = true, message = "Patched ${target.fileName} for '$name'")
    }

    private fun deleteSkill(workspace: WorkspaceToolLocation, name: String): SkillManageResponse {
        val skill = workspace.findSkillByName(name) ?: throw IllegalArgumentException("Skill '$name' was not found")
        deleteRecursively(skill.directory)
        return SkillManageResponse(success = true, message = "Deleted skill '$name'")
    }

    private fun writeSkillFile(workspace: WorkspaceToolLocation, name: String, filePath: String?, fileContent: String?): SkillManageResponse {
        if (filePath.isNullOrBlank()) throw IllegalArgumentException("file_path is required for write_file")
        if (fileContent == null) throw IllegalArgumentException("file_content is required for write_file")
        val skill = workspace.findSkillByName(name) ?: throw IllegalArgumentException("Skill '$name' was not found")
        val target = resolveSkillOwnedPath(skill.directory, filePath)
        val format = fileFormat(target)
        val normalized = if (target.exists()) normalizeContentForWrite(fileContent, format) else fileContent
        writeUtf8(target, normalized)
        return SkillManageResponse(success = true, message = "Wrote '$filePath' for '$name'")
    }

    private fun removeSkillFile(workspace: WorkspaceToolLocation, name: String, filePath: String?): SkillManageResponse {
        if (filePath.isNullOrBlank()) throw IllegalArgumentException("file_path is required for remove_file")
        val skill = workspace.findSkillByName(name) ?: throw IllegalArgumentException("Skill '$name' was not found")
        val target = resolveSkillOwnedPath(skill.directory, filePath)
        if (!target.exists()) throw IllegalArgumentException("File '$filePath' was not found in skill '$name'")
        Files.delete(target)
        return SkillManageResponse(success = true, message = "Removed '$filePath' from '$name'")
    }

    private fun resolveSkillOwnedPath(skillDir: Path, relativePath: String): Path {
        val target = skillDir.resolve(Path.of(relativePath)).normalize()
        if (!target.startsWith(skillDir)) throw IllegalArgumentException("Skill file path escapes skill directory")
        return target
    }

    private fun skillDirectoryName(name: String): String {
        val sanitized = name.trim().replace(Regex("[^a-zA-Z0-9._-]+"), "-").trim('-')
        return sanitized.ifBlank { "skill" }
    }

    private fun reloadWorkspace(context: AgentToolContext): SkillManageReloadResult? {
        val workspaceId = context.metadata["workspaceId"]?.takeIf { it.isNotBlank() } ?: return null
        val provider = workspaceCaseProvider ?: return null
        return runCatching {
            val result = provider().reload(workspaceId)
            SkillManageReloadResult(success = result.success, status = result.status, snapshotVersion = result.snapshotVersion)
        }.getOrNull()
    }
}

@Serializable
data class SkillsListResponse(
    val success: Boolean,
    val skills: List<SkillSummary>,
    val count: Int,
)

@Serializable
data class SkillSummary(
    val name: String,
    val description: String,
)

@Serializable
data class SkillViewResponse(
    val success: Boolean,
    val name: String,
    val description: String,
    val filePath: String,
    val content: String,
)

@Serializable
data class SkillManageResponse(
    val success: Boolean,
    val message: String,
    val warning: String? = null,
    val reload: SkillManageReloadResult? = null,
)

@Serializable
data class SkillManageReloadResult(
    val success: Boolean,
    val status: String,
    val snapshotVersion: Long? = null,
)

/** File operations for one selected, permission-checked Agent-local source only. */
private object AgentSkillToolFiles {
    private const val MAX_BYTES = AgentSkillCatalog.MAX_DOCUMENT_BYTES

    fun resolve(directory: Path, requested: String): Path {
        val relative = Path.of(requested)
        require(!relative.isAbsolute && relative.nameCount > 0 && relative.none { it.toString() in setOf(".", "..") }) {
            "Skill file path must be relative and cannot contain traversal segments"
        }
        val target = directory.resolve(relative).normalize()
        require(target.startsWith(directory) && target != directory) { "Skill file path escapes its directory" }
        checkPath(target, allowMissing = true)
        return target
    }

    fun read(path: Path): String {
        checkPath(path)
        val attrs = Files.readAttributes(path, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
        require(attrs.isRegularFile && attrs.size() <= MAX_BYTES) { "Skill file must be regular and no larger than $MAX_BYTES bytes" }
        val bytes = Files.newByteChannel(path, setOf<java.nio.file.OpenOption>(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)).use { channel ->
            val out = ByteArrayOutputStream()
            val buffer = ByteBuffer.allocate(8192)
            while (true) {
                buffer.clear()
                val count = channel.read(buffer)
                if (count < 0) break
                require(out.size() + count <= MAX_BYTES) { "Skill file exceeds $MAX_BYTES bytes" }
                out.write(buffer.array(), 0, count)
            }
            out.toByteArray()
        }
        checkPath(path)
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    }

    fun manage(root: Path, args: Map<String, String>): String {
        val name = args["name"]?.trim().orEmpty()
        require(name.matches(Regex("[\\p{L}\\p{N}][\\p{L}\\p{N}._-]{0,127}"))) { "A safe skill name is required" }
        val action = args["action"]?.trim().orEmpty()
        require(action in setOf("create", "edit", "patch", "delete", "write_file", "remove_file")) { "Unknown skill action '$action'" }
        checkPath(root, allowMissing = true)
        val existing = find(root, name)
        if (action == "create") {
            require(existing == null) { "Skill '$name' already exists in this source" }
            val content = args["content"]?.takeIf(String::isNotBlank) ?: error("content is required for create")
            require(declaredName(content, name) == name) { "Frontmatter name must match skill name" }
            val directory = resolve(root, name)
            require(!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) { "Skill directory already exists" }
            write(directory.resolve("SKILL.md"), content)
            return "Created skill '$name'"
        }
        val directory = existing ?: error("Skill '$name' does not exist in the selected Agent source")
        when (action) {
            "delete" -> {
                val paths = Files.walk(directory).use { it.sorted(Comparator.reverseOrder()).toList() }
                paths.forEach { checkPath(it) }
                paths.forEach { Files.delete(it) }
            }
            "edit" -> {
                val content = args["content"]?.takeIf(String::isNotBlank) ?: error("content is required for edit")
                require(declaredName(content, name) == name) { "Frontmatter name must match skill name" }
                val target = directory.resolve("SKILL.md")
                write(target, preserveFormat(target, content))
            }
            "write_file" -> {
                val requested = args["file_path"]?.takeIf(String::isNotBlank) ?: error("file_path is required")
                val content = args["file_content"] ?: error("file_content is required")
                val target = resolve(directory, requested)
                if (target.fileName.toString() == "SKILL.md" && target.parent == directory) {
                    require(declaredName(content, name) == name) { "Frontmatter name must match skill name" }
                }
                write(target, preserveFormat(target, content))
            }
            "remove_file" -> {
                val requested = args["file_path"]?.takeIf(String::isNotBlank) ?: error("file_path is required")
                val target = resolve(directory, requested)
                require(Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) { "Target must be an existing regular file" }
                Files.delete(target)
            }
            "patch" -> {
                val target = resolve(directory, args["file_path"]?.takeIf(String::isNotBlank) ?: "SKILL.md")
                val original = read(target)
                val old = args["old_string"]?.takeIf(String::isNotEmpty) ?: error("old_string is required")
                val replacement = args["new_string"] ?: error("new_string is required")
                var count = 0
                var cursor = 0
                while (true) {
                    val found = original.indexOf(old, cursor)
                    if (found < 0) break
                    count++
                    cursor = found + old.length
                }
                require(count > 0) { "old_string was not found" }
                val all = parseBooleanArg(args["replace_all"])
                require(all || count == 1) { "old_string matched $count locations; set replace_all=true" }
                val content = if (all) original.replace(old, replacement) else original.replaceFirst(old, replacement)
                if (target.fileName.toString() == "SKILL.md" && target.parent == directory) {
                    require(declaredName(content, name) == name) { "Frontmatter name must match skill name" }
                }
                write(target, content)
            }
        }
        return "Completed $action for skill '$name'"
    }

    private fun find(root: Path, name: String): Path? {
        if (!Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return null
        checkPath(root)
        return Files.list(root).use { paths -> paths.sorted().toList() }.firstOrNull { directory ->
            if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) return@firstOrNull false
            checkPath(directory)
            if (directory.fileName.toString() == name) return@firstOrNull true
            val document = directory.resolve("SKILL.md")
            runCatching { declaredName(read(document), directory.fileName.toString()) == name }.getOrDefault(false)
        }
    }

    private fun declaredName(markdown: String, fallback: String): String {
        val lines = markdown.removePrefix("\uFEFF").lines()
        if (lines.firstOrNull()?.trim() != "---") return fallback
        val last = lines.drop(1).indexOfFirst { it.trim() == "---" }
        require(last >= 0) { "SKILL.md frontmatter is not closed" }
        val values = Load(LoadSettings.builder().setAllowDuplicateKeys(false).build())
            .loadFromString(lines.subList(1, last + 1).joinToString("\n"))
        require(values == null || values is Map<*, *>) { "SKILL.md frontmatter must be an object" }
        return ((values as? Map<*, *>)?.get("name") as? String)?.trim()?.takeIf(String::isNotBlank) ?: fallback
    }

    private fun preserveFormat(path: Path, content: String): String {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return content
        val previous = read(path)
        return normalizeContentForWrite(content.removePrefix("\uFEFF"), FileFormat(previous.startsWith("\uFEFF"), if ("\r\n" in previous) "\r\n" else "\n"))
    }

    private fun write(path: Path, content: String) {
        val bytes = content.toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_BYTES) { "Skill file exceeds $MAX_BYTES bytes" }
        checkPath(path, allowMissing = true)
        Files.createDirectories(path.parent)
        checkPath(path, allowMissing = true)
        val temporary = Files.createTempFile(path.parent, ".skill-", ".tmp")
        try {
            Files.newByteChannel(temporary, setOf<java.nio.file.OpenOption>(StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)).use { channel ->
                val buffer = ByteBuffer.wrap(bytes)
                while (buffer.hasRemaining()) channel.write(buffer)
            }
            checkPath(path, allowMissing = true)
            Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            runCatching { checkPath(temporary, allowMissing = true); Files.deleteIfExists(temporary) }
        }
    }

    private fun checkPath(path: Path, allowMissing: Boolean = false) {
        val absolute = path.toAbsolutePath().normalize()
        var current = absolute.root
        for (part in absolute) {
            current = current.resolve(part)
            val attrs = try { Files.readAttributes(current, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS) }
                catch (e: NoSuchFileException) { if (allowMissing) return else throw e }
            require(!attrs.isSymbolicLink && (current == absolute || attrs.isDirectory)) { "Skill paths cannot traverse symbolic links or non-directories" }
        }
    }
}
