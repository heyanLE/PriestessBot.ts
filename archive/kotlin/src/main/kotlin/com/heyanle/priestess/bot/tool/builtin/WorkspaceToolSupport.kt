package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.nio.charset.MalformedInputException
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import kotlin.io.path.exists
import kotlin.io.path.extension
import kotlin.io.path.isDirectory
import kotlin.io.path.name

internal data class WorkspaceToolLocation(
    val rootDir: Path,
) {
    val skillsDir: Path = rootDir.resolve("skills")
}

internal data class WorkspaceSkillFile(
    val name: String,
    val description: String,
    val directory: Path,
    val skillMarkdown: Path,
)

internal data class FileFormat(
    val hasBom: Boolean,
    val lineEnding: String?,
)

internal fun AgentToolContext.workspaceLocationOrNull(): WorkspaceToolLocation? {
    val root = metadata["workspaceRootDir"]
        ?: metadata["workspace_root_dir"]
        ?: return null
    val rootPath = runCatching { Path.of(root).toAbsolutePath().normalize() }.getOrNull() ?: return null
    return WorkspaceToolLocation(rootPath)
}

internal fun WorkspaceToolLocation.resolvePath(requestedPath: String?): Path {
    val normalized = requestedPath?.trim().orEmpty()
    val resolved = if (normalized.isBlank()) {
        rootDir
    } else {
        val candidate = runCatching { Path.of(normalized) }.getOrElse {
            throw IllegalArgumentException("Invalid path '$normalized'")
        }
        if (candidate.isAbsolute) candidate.normalize() else rootDir.resolve(candidate).normalize()
    }
    if (!resolved.startsWith(rootDir)) {
        throw IllegalArgumentException("Path escapes the current workspace root")
    }
    return resolved
}

internal fun WorkspaceToolLocation.resolveSkillPath(skillName: String, relativePath: String? = null): Path {
    val skill = findSkillByName(skillName)
        ?: throw IllegalArgumentException("Skill '$skillName' was not found in the current workspace")
    val base = if (relativePath.isNullOrBlank()) {
        skill.skillMarkdown
    } else {
        val requested = Path.of(relativePath.trim())
        if (requested.isAbsolute) {
            throw IllegalArgumentException("Skill file paths must be relative")
        }
        skill.directory.resolve(requested).normalize()
    }
    if (!base.startsWith(skill.directory)) {
        throw IllegalArgumentException("Skill file path escapes skill directory")
    }
    return base
}

internal fun WorkspaceToolLocation.listSkills(): List<WorkspaceSkillFile> {
    if (!skillsDir.exists() || !skillsDir.isDirectory()) return emptyList()
    val directories = Files.list(skillsDir).use { stream -> stream.toList() }
        .filter { Files.isDirectory(it) }
    return directories
        .mapNotNull { skillDir: Path ->
            val skillMd = skillDir.resolve("SKILL.md")
            if (!skillMd.exists()) return@mapNotNull null
            val frontMatter = parseFrontMatter(readUtf8(skillMd))
            WorkspaceSkillFile(
                name = frontMatter["name"]?.takeIf { it.isNotBlank() } ?: skillDir.name,
                description = frontMatter["description"].orEmpty(),
                directory = skillDir.toAbsolutePath().normalize(),
                skillMarkdown = skillMd.toAbsolutePath().normalize(),
            )
        }
        .sortedBy { it.name.lowercase() }
}

internal fun WorkspaceToolLocation.findSkillByName(name: String): WorkspaceSkillFile? {
    val normalized = name.trim()
    return listSkills().firstOrNull { skill ->
        skill.name == normalized || skill.directory.name == normalized
    }
}

internal fun WorkspaceToolLocation.ensureSkillsDir(): Path {
    Files.createDirectories(skillsDir)
    return skillsDir
}

internal fun parseFrontMatter(markdown: String): Map<String, String> {
    if (!markdown.startsWith("---")) return emptyMap()
    val end = markdown.indexOf("\n---", startIndex = 3)
    if (end <= 0) return emptyMap()
    return markdown
        .substring(3, end)
        .lineSequence()
        .mapNotNull { line ->
            val parts = line.split(":", limit = 2)
            if (parts.size != 2) return@mapNotNull null
            val key = parts[0].trim()
            val value = parts[1].trim().trim('"')
            key.takeIf { it.isNotBlank() }?.let { it to value }
        }
        .toMap()
}

internal fun readUtf8(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

internal fun fileFormat(path: Path): FileFormat {
    if (!path.exists()) return FileFormat(hasBom = false, lineEnding = null)
    val text = readUtf8(path)
    val hasBom = text.startsWith("\uFEFF")
    val body = if (hasBom) text.removePrefix("\uFEFF") else text
    val lineEnding = when {
        "\r\n" in body -> "\r\n"
        "\n" in body -> "\n"
        else -> null
    }
    return FileFormat(hasBom = hasBom, lineEnding = lineEnding)
}

internal fun normalizeContentForWrite(content: String, format: FileFormat): String {
    val normalizedLines = content.replace("\r\n", "\n").replace("\r", "\n")
    val withLineEnding = when (format.lineEnding) {
        "\r\n" -> normalizedLines.replace("\n", "\r\n")
        else -> normalizedLines
    }
    return if (format.hasBom) "\uFEFF$withLineEnding" else withLineEnding
}

internal fun writeUtf8(path: Path, content: String) {
    Files.createDirectories(path.parent ?: path.toAbsolutePath().parent)
    Files.writeString(
        path,
        content,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE,
    )
}

internal fun isLikelyBinary(path: Path): Boolean {
    val extension = path.extension.lowercase()
    if (extension in setOf("png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf", "jar", "zip", "gz", "7z", "class", "so", "dll", "dylib")) {
        return true
    }
    return try {
        Files.newInputStream(path).use { stream ->
            val sample = ByteArray(1024)
            val read = stream.read(sample)
            if (read <= 0) return false
            sample.take(read).any { it == 0.toByte() }
        }
    } catch (_: Exception) {
        false
    }
}

internal fun readTextLines(path: Path): List<String> {
    if (isLikelyBinary(path)) {
        throw IllegalArgumentException("File '${path.fileName}' appears to be binary and cannot be read as text")
    }
    return try {
        Files.newBufferedReader(path, StandardCharsets.UTF_8).use { reader -> reader.readLines() }
    } catch (error: MalformedInputException) {
        throw IllegalArgumentException("File '${path.fileName}' is not valid UTF-8 text")
    }
}

internal fun parseBooleanArg(raw: String?, defaultValue: Boolean = false): Boolean {
    return when (raw?.trim()?.lowercase()) {
        null, "" -> defaultValue
        "1", "true", "yes", "on" -> true
        "0", "false", "no", "off" -> false
        else -> defaultValue
    }
}

internal fun parseStringListArg(raw: String?): List<String> {
    val value = raw?.trim().orEmpty()
    if (value.isBlank()) return emptyList()
    if (value.startsWith("[")) {
        return runCatching {
            Json.decodeFromString<List<String>>(value)
        }.getOrElse {
            value.removePrefix("[").removeSuffix("]")
                .split(",")
                .map { item -> item.trim().trim('"') }
                .filter { it.isNotBlank() }
        }
    }
    return value.split(",")
        .map { it.trim() }
        .filter { it.isNotBlank() }
}

internal fun deleteRecursively(path: Path) {
    if (!path.exists()) return
    Files.walk(path).use { stream ->
        stream.sorted(Comparator.reverseOrder()).forEach(Files::deleteIfExists)
    }
}
