package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isDirectory

class ReadFileTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "read_file",
        description = "Read a UTF-8 text file from the current workspace with line-based pagination.",
        guidance = "Use this instead of a shell command to inspect text files. Read a range before editing a " +
            "file you have not seen, and read again after a write when the next change depends on the result.",
        parallelSafe = true,
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("path", description = "Workspace-relative file path.", required = true),
                ParameterDef("offset", type = "integer", description = "1-based first line to include, default 1."),
                ParameterDef("limit", type = "integer", description = "Maximum lines to return, default 200."),
            ),
            required = listOf("path"),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = false,
        auditLog = false,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val path = args["path"]?.trim().orEmpty()
        if (path.isBlank()) return ToolResult.error("path is required", "VALIDATION_ERROR")

        return runCatching {
            val target = workspace.resolvePath(path)
            if (!Files.exists(target)) {
                return ToolResult.error("File '$path' was not found", "FILE_NOT_FOUND")
            }
            if (target.isDirectory()) {
                return ToolResult.error("'$path' is a directory", "IS_DIRECTORY")
            }
            val lines = readTextLines(target)
            val offset = args["offset"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1
            val limit = args["limit"]?.toIntOrNull()?.coerceIn(1, 2_000) ?: 200
            val startIndex = (offset - 1).coerceAtMost(lines.size)
            val slice = lines.drop(startIndex).take(limit)
            ToolResult.success(
                json.encodeToString(
                    ReadFileResponse(
                        path = workspace.rootDir.relativize(target).toString(),
                        content = slice.joinToString("\n"),
                        totalLines = lines.size,
                        offset = offset,
                        returnedLines = slice.size,
                        truncated = startIndex + slice.size < lines.size,
                    ),
                ),
            )
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to read file", "READ_FAILED")
        }
    }
}

class WriteFileTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "write_file",
        description = "Write a UTF-8 text file inside the current workspace.",
        guidance = "This replaces the whole file. Prefer 'patch' for a small change to an existing file, and read " +
            "the file first when you are not certain of its current contents.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("path", description = "Workspace-relative file path.", required = true),
                ParameterDef("content", description = "Full file contents to write.", required = true),
            ),
            required = listOf("path", "content"),
        ),
        riskLevel = ToolRiskLevel.HIGH_RISK,
        defaultEnabled = false,
        auditLog = true,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val path = args["path"]?.trim().orEmpty()
        if (path.isBlank()) return ToolResult.error("path is required", "VALIDATION_ERROR")
        val content = args["content"] ?: return ToolResult.error("content is required", "VALIDATION_ERROR")

        return runCatching {
            val target = workspace.resolvePath(path)
            val existed = Files.exists(target)
            val format = fileFormat(target)
            val normalizedContent = if (existed) normalizeContentForWrite(content, format) else content
            writeUtf8(target, normalizedContent)
            ToolResult.success(
                json.encodeToString(
                    WriteFileResponse(
                        path = workspace.rootDir.relativize(target).toString(),
                        bytesWritten = normalizedContent.toByteArray().size,
                        replacedExisting = existed,
                    ),
                ),
            )
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to write file", "WRITE_FAILED")
        }
    }
}

class PatchFileTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "patch",
        description = "Patch a workspace text file by replacing an exact text fragment.",
        guidance = "The fragment must match the file exactly, so read the region first. Prefer this over 'write_file' " +
            "for a targeted change. If a match fails, re-read the file rather than retrying the same fragment.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("mode", description = "Patch mode. Only 'replace' is supported currently."),
                ParameterDef("path", description = "Workspace-relative file path.", required = true),
                ParameterDef("old_string", description = "Exact text to replace.", required = true),
                ParameterDef("new_string", description = "Replacement text. Use empty string to delete.", required = true),
                ParameterDef("replace_all", type = "boolean", description = "Replace all matches instead of requiring exactly one match."),
            ),
            required = listOf("path", "old_string", "new_string"),
        ),
        riskLevel = ToolRiskLevel.HIGH_RISK,
        defaultEnabled = false,
        auditLog = true,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val mode = args["mode"]?.trim().orEmpty().ifBlank { "replace" }
        if (mode != "replace") return ToolResult.error("patch mode '$mode' is not supported yet; use mode='replace'", "UNSUPPORTED_MODE")
        val path = args["path"]?.trim().orEmpty()
        val oldString = args["old_string"] ?: return ToolResult.error("old_string is required", "VALIDATION_ERROR")
        val newString = args["new_string"] ?: return ToolResult.error("new_string is required", "VALIDATION_ERROR")
        if (path.isBlank()) return ToolResult.error("path is required", "VALIDATION_ERROR")
        if (oldString.isEmpty()) return ToolResult.error("old_string must not be empty", "VALIDATION_ERROR")

        return runCatching {
            val target = workspace.resolvePath(path)
            if (!Files.exists(target)) {
                return ToolResult.error("File '$path' was not found", "FILE_NOT_FOUND")
            }
            if (target.isDirectory()) {
                return ToolResult.error("'$path' is a directory", "IS_DIRECTORY")
            }
            if (isLikelyBinary(target)) {
                return ToolResult.error("Binary files are not supported by patch", "BINARY_FILE")
            }
            val original = readUtf8(target)
            val format = fileFormat(target)
            val occurrences = original.windowed(oldString.length, 1).count { it == oldString }
            if (occurrences == 0) {
                return ToolResult.error("old_string was not found in '$path'", "PATCH_NOT_FOUND")
            }
            val replaceAll = parseBooleanArg(args["replace_all"])
            if (!replaceAll && occurrences > 1) {
                return ToolResult.error("old_string matched $occurrences locations; set replace_all=true to replace every match", "PATCH_AMBIGUOUS")
            }
            val updated = if (replaceAll) original.replace(oldString, newString) else original.replaceFirst(oldString, newString)
            writeUtf8(target, normalizeContentForWrite(updated.removePrefix("\uFEFF"), format))
            ToolResult.success(
                json.encodeToString(
                    PatchFileResponse(
                        path = workspace.rootDir.relativize(target).toString(),
                        replacements = if (replaceAll) occurrences else 1,
                    ),
                ),
            )
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to patch file", "PATCH_FAILED")
        }
    }
}

class SearchFilesTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "search_files",
        description = "Search text files in the current workspace for matching content.",
        guidance = "Use this to locate something before reading it. It returns matching lines, not whole files, so " +
            "follow up with 'read_file' once you know the path.",
        parallelSafe = true,
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("pattern", description = "Substring or regular expression to search for.", required = true),
                ParameterDef("target", description = "Search target: 'content' or 'files'. Defaults to 'content'."),
                ParameterDef("path", description = "Workspace-relative file or directory path to search. Defaults to workspace root."),
                ParameterDef("file_glob", description = "Optional glob filter such as '*.kt'."),
                ParameterDef("limit", type = "integer", description = "Maximum number of matches to return, default 50."),
                ParameterDef("regex", type = "boolean", description = "Treat pattern as a regular expression."),
            ),
            required = listOf("pattern"),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = false,
        auditLog = false,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val pattern = args["pattern"]?.trim().orEmpty()
        if (pattern.isBlank()) return ToolResult.error("pattern is required", "VALIDATION_ERROR")
        val base = runCatching { workspace.resolvePath(args["path"]) }.getOrElse {
            return ToolResult.error(it.message ?: "Invalid search path", "VALIDATION_ERROR")
        }
        val limit = args["limit"]?.toIntOrNull()?.coerceIn(1, 500) ?: 50
        val regexMode = parseBooleanArg(args["regex"])
        val target = args["target"]?.trim()?.lowercase().orEmpty().ifBlank { "content" }
        if (target != "content" && target != "files") {
            return ToolResult.error("target must be either 'content' or 'files'", "VALIDATION_ERROR")
        }
        val matcher = if (regexMode) Regex(pattern) else null
        val glob = args["file_glob"]?.trim()?.takeIf { it.isNotBlank() }
        val pathMatcher = glob?.let { FileSystems.getDefault().getPathMatcher("glob:$it") }
        val matches = mutableListOf<SearchFilesMatch>()
        val files = mutableListOf<String>()
        var total = 0

        return runCatching {
            val targets = if (Files.isRegularFile(base)) listOf(base) else Files.walk(base).use { stream ->
                stream.filter { Files.isRegularFile(it) }.toList()
            }
            for (targetFile in targets) {
                if (pathMatcher != null && !pathMatcher.matches(targetFile.fileName)) continue
                val relative = workspace.rootDir.relativize(targetFile).toString()
                if (target == "files") {
                    val matched = if (matcher != null) matcher.containsMatchIn(relative) else relative.contains(pattern)
                    if (matched) {
                        total += 1
                        if (files.size < limit) {
                            files += relative
                        }
                    }
                    continue
                }
                if (isLikelyBinary(targetFile)) continue
                val lines = runCatching { readTextLines(targetFile) }.getOrElse { continue }
                for ((index, line) in lines.withIndex()) {
                    val matched = if (matcher != null) matcher.containsMatchIn(line) else line.contains(pattern)
                    if (!matched) continue
                    total += 1
                    if (matches.size < limit) {
                        matches += SearchFilesMatch(relative, index + 1, line)
                    }
                }
            }
            ToolResult.success(
                json.encodeToString(
                    SearchFilesResponse(
                        matches = matches.takeIf { target == "content" },
                        files = files.takeIf { target == "files" },
                        totalCount = total,
                        truncated = total > if (target == "files") files.size else matches.size,
                    ),
                ),
            )
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to search files", "SEARCH_FAILED")
        }
    }
}

@Serializable
data class ReadFileResponse(
    val path: String,
    val content: String,
    val totalLines: Int,
    val offset: Int,
    val returnedLines: Int,
    val truncated: Boolean,
)

@Serializable
data class WriteFileResponse(
    val path: String,
    val bytesWritten: Int,
    val replacedExisting: Boolean,
)

@Serializable
data class PatchFileResponse(
    val path: String,
    val replacements: Int,
)

@Serializable
data class SearchFilesMatch(
    val path: String,
    val lineNumber: Int,
    val content: String,
)

@Serializable
data class SearchFilesResponse(
    val matches: List<SearchFilesMatch>? = null,
    val files: List<String>? = null,
    val totalCount: Int,
    val truncated: Boolean,
)
