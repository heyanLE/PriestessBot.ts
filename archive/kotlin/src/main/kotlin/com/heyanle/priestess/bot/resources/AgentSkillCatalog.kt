package com.heyanle.priestess.bot.resources

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.skill.SkillPromptReference
import kotlinx.serialization.Serializable
import org.snakeyaml.engine.v2.api.Load
import org.snakeyaml.engine.v2.api.LoadSettings
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.*
import java.nio.file.attribute.BasicFileAttributeView
import java.nio.file.attribute.BasicFileAttributes
import java.nio.channels.SeekableByteChannel
import java.util.UUID

@Serializable
enum class SkillResourceSource { PLATFORM, CONFIGURATION, TEMPORARY }

@Serializable
data class SkillCatalogItem(
    val name: String,
    val description: String,
    val source: SkillResourceSource,
    val libraryId: String? = null,
    val path: String,
    val permissionGroup: PermissionGroup,
    val enabled: Boolean,
)

@Serializable
data class SkillCatalogResult(val items: List<SkillCatalogItem>, val diagnostics: List<String> = emptyList())

@Serializable
data class SkillDocument(val name: String, val content: String, val path: String)

@Serializable
data class AgentSkillWriteRequest(val source: SkillResourceSource, val name: String, val content: String, val libraryId: String? = null)

@Serializable
data class LibrarySkillWriteRequest(val name: String, val content: String)

/** Resolves configured skill mounts. Markdown metadata never grants permissions. */
class AgentSkillCatalog(private val runtime: RuntimeConfigurationCase, sourcePath: Path) {
    private val base = sourcePath.toAbsolutePath().normalize().parent.toRealPath()

    fun stateForAgent(agentId: String, permission: PermissionGroup): PipelineSkillState =
        stateForAgent(runtime.current(), agentId, permission)

    fun stateForAgent(snapshot: EffectiveRuntimeSnapshot, agentId: String, permission: PermissionGroup): PipelineSkillState {
        val scan = scanAgent(application(snapshot), agentId)
        val references = scan.candidates.filter { it.item.enabled && permission.satisfies(it.item.permissionGroup) }.map {
            SkillPromptReference(
                name = it.item.name,
                description = it.item.description,
                markdownPath = it.item.path,
                // Keep the validated file contents pinned for this run. A later symlink replacement
                // or edit cannot change the document after permission and source selection.
                inlineMarkdown = it.markdown,
                requiredPermissionGroup = it.item.permissionGroup,
            )
        }
        return PipelineSkillState(references, permission)
    }

    fun listAgent(agentId: String): SkillCatalogResult = scanAgent(application(), agentId).result()

    fun listLibrary(libraryId: String): SkillCatalogResult {
        val app = application()
        val diagnostics = mutableListOf<String>()
        val candidates = scanMount(libraryMount(app, libraryId), diagnostics)
        return select(candidates, diagnostics).result()
    }

    fun readAgent(agentId: String, source: SkillResourceSource, name: String, libraryId: String? = null): SkillDocument =
        read(agentMount(application(), agentId, source, libraryId), name)

    fun readLibrary(libraryId: String, name: String): SkillDocument = read(libraryMount(application(), libraryId), name)

    @Synchronized
    fun writeAgent(agentId: String, request: AgentSkillWriteRequest): SkillDocument =
        write(agentMount(application(), agentId, request.source, request.libraryId), request.name, request.content)

    @Synchronized
    fun writeLibrary(libraryId: String, request: LibrarySkillWriteRequest): SkillDocument =
        write(libraryMount(application(), libraryId), request.name, request.content)

    private fun application(snapshot: EffectiveRuntimeSnapshot = runtime.current()): ApplicationConfigurationDocument =
        checkNotNull(snapshot.application) { "Application configuration is unavailable" }

    private fun scanAgent(app: ApplicationConfigurationDocument, agentId: String): Scan {
        val agent = agent(app, agentId)
        val diagnostics = mutableListOf<String>()
        val mounts = mutableListOf(
            localMount(agent, SkillResourceSource.TEMPORARY),
            localMount(agent, SkillResourceSource.CONFIGURATION),
        )
        agent.skills.platformLibraries.forEach { binding ->
            if (app.skillLibraries.none { it.id == binding.libraryId }) {
                diagnostics += "Mounted skill library '${binding.libraryId}' does not exist."
            } else {
                mounts += libraryMount(app, binding.libraryId).let {
                    it.copy(permission = binding.permissionGroup, enabled = agent.enabled && binding.enabled && it.enabled)
                }
            }
        }
        return select(mounts.flatMap { scanMount(it, diagnostics) }, diagnostics)
    }

    private fun select(candidates: List<Candidate>, diagnostics: MutableList<String>): Scan {
        val selected = linkedMapOf<String, Candidate>()
        val resolved = candidates.map { candidate ->
            if (!candidate.item.enabled) return@map candidate
            val previous = selected.putIfAbsent(candidate.item.name, candidate)
            if (previous == null) candidate else {
                diagnostics += "Skill '${candidate.item.name}' at ${candidate.item.path} is shadowed by ${previous.item.path}; " +
                    "priority is TEMPORARY > CONFIGURATION > PLATFORM, then platform library mount order and directory name."
                candidate.copy(item = candidate.item.copy(enabled = false))
            }
        }
        return Scan(resolved, diagnostics.toList())
    }

    private fun scanMount(mount: Mount, diagnostics: MutableList<String>): List<Candidate> {
        return try {
            if (!Files.exists(mount.root, LinkOption.NOFOLLOW_LINKS)) return emptyList()
            val directories = withDirectory(mount.root) { stream -> stream.names().sorted() }
            directories.mapNotNull { directory ->
                val documentPath = mount.root.resolve(directory).resolve("SKILL.md")
                try {
                    if (!Files.isDirectory(mount.root.resolve(directory), LinkOption.NOFOLLOW_LINKS)) {
                        if (Files.isSymbolicLink(mount.root.resolve(directory))) diagnostics += "Ignored symbolic link: ${mount.root.resolve(directory)}"
                        return@mapNotNull null
                    }
                    val markdown = readBytes(mount.root.resolve(directory))
                    val header = header(markdown, directory)
                    Candidate(
                        SkillCatalogItem(header.first, header.second, mount.source, mount.libraryId, documentPath.toString(), mount.permission, mount.enabled),
                        directory,
                        markdown,
                    )
                } catch (_: NoSuchFileException) {
                    null // A directory without SKILL.md is not a skill.
                } catch (e: Exception) {
                    diagnostics += "Cannot load skill at $documentPath: ${e.message}"
                    null
                }
            }
        } catch (e: Exception) {
            diagnostics += "Cannot read ${mount.source} skill directory ${mount.root}: ${e.message}"
            emptyList()
        }
    }

    private fun agent(app: ApplicationConfigurationDocument, id: String): AgentProfileDocument =
        app.agents.firstOrNull { it.id == id } ?: throw NoSuchElementException("Agent '$id' does not exist")

    private fun localMount(agent: AgentProfileDocument, source: SkillResourceSource): Mount {
        val local = if (source == SkillResourceSource.TEMPORARY) agent.skills.temporary else agent.skills.configuration
        val directory = if (source == SkillResourceSource.TEMPORARY) agent.tempDirectory else agent.configDirectory
        return Mount(resolve(base, directory).resolve("skills"), source, null, local.permissionGroup, agent.enabled && local.enabled)
    }

    private fun libraryMount(app: ApplicationConfigurationDocument, libraryId: String): Mount {
        val library = app.skillLibraries.firstOrNull { it.id == libraryId }
            ?: throw NoSuchElementException("Skill library '$libraryId' does not exist")
        return Mount(resolve(resolve(base, app.platformDirectory), library.directory), SkillResourceSource.PLATFORM, library.id, PermissionGroup.OPERATOR, library.enabled)
    }

    private fun agentMount(app: ApplicationConfigurationDocument, agentId: String, source: SkillResourceSource, libraryId: String?): Mount {
        val agent = agent(app, agentId)
        if (source != SkillResourceSource.PLATFORM) {
            require(libraryId == null) { "libraryId is only valid for PLATFORM skills" }
            return localMount(agent, source)
        }
        val binding = agent.skills.platformLibraries.firstOrNull { it.libraryId == libraryId }
            ?: throw NoSuchElementException("Skill library is not mounted by Agent '$agentId'")
        return libraryMount(app, binding.libraryId).let {
            it.copy(permission = binding.permissionGroup, enabled = agent.enabled && binding.enabled && it.enabled)
        }
    }

    private fun resolve(parent: Path, directory: String): Path {
        require(directory.isNotBlank()) { "Skill directory must not be empty" }
        return parent.resolve(directory).toAbsolutePath().normalize()
    }

    private fun read(mount: Mount, name: String): SkillDocument {
        validateName(name)
        val candidate = scanMount(mount, mutableListOf()).firstOrNull { it.item.name == name }
        val directory = candidate?.directory ?: name
        val content = readBytes(mount.root.resolve(directory))
        return SkillDocument(name, content, mount.root.resolve(directory).resolve("SKILL.md").toString())
    }

    private fun write(mount: Mount, name: String, content: String): SkillDocument {
        validateName(name)
        val bytes = content.toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_DOCUMENT_BYTES) { "SKILL.md exceeds $MAX_DOCUMENT_BYTES bytes" }
        require(header(content, name).first == name) { "Frontmatter name must match the requested skill name" }
        val candidate = scanMount(mount, mutableListOf()).firstOrNull { it.item.name == name }
        val directory = mount.root.resolve(candidate?.directory ?: name)
        withDirectory(directory, create = true) { stream ->
            val target = Path.of("SKILL.md")
            val attrs = runCatching { stream.attributes(target) }
                .getOrElse { if (it is NoSuchFileException) null else throw it }
            require(attrs == null || attrs.isRegularFile) { "SKILL.md must be a regular file, not a symbolic link" }
            val temporary = Path.of(".skill-${UUID.randomUUID()}.tmp")
            try {
                stream.channel(temporary, setOf<OpenOption>(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)).use { channel ->
                    val buffer = ByteBuffer.wrap(bytes)
                    while (buffer.hasRemaining()) channel.write(buffer)
                }
                stream.move(temporary, target)
            } finally {
                runCatching { stream.delete(temporary) }
            }
        }
        return SkillDocument(name, content, directory.resolve("SKILL.md").toString())
    }

    private fun readBytes(directory: Path): String = withDirectory(directory) { stream ->
        val file = Path.of("SKILL.md")
        val attrs = stream.attributes(file)
        require(attrs.isRegularFile) { "SKILL.md must be a regular file, not a symbolic link" }
        require(attrs.size() <= MAX_DOCUMENT_BYTES) { "SKILL.md exceeds $MAX_DOCUMENT_BYTES bytes" }
        stream.channel(file, setOf<OpenOption>(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)).use { channel ->
            val out = ByteArrayOutputStream()
            val buffer = ByteBuffer.allocate(8192)
            while (true) {
                buffer.clear()
                val count = channel.read(buffer)
                if (count < 0) break
                require(out.size() + count <= MAX_DOCUMENT_BYTES) { "SKILL.md exceeds $MAX_DOCUMENT_BYTES bytes" }
                out.write(buffer.array(), 0, count)
            }
            stream.verify()
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(out.toByteArray())).toString()
        }
    }

    /** Reject symbolic links at every component. Linux additionally anchors operations to open directory handles. */
    private fun <T> withDirectory(path: Path, create: Boolean = false, block: (DirectoryAccess) -> T): T {
        val absolute = path.toAbsolutePath().normalize()
        val identities = mutableListOf<Pair<Path, Any?>>()
        var traversed = absolute.root
        for (part in absolute) {
            traversed = traversed.resolve(part)
            val attrs = try {
                Files.readAttributes(traversed, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            } catch (e: NoSuchFileException) {
                if (!create) throw e
                try { Files.createDirectory(traversed) } catch (_: FileAlreadyExistsException) { /* Validate the winner below. */ }
                Files.readAttributes(traversed, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            }
            require(attrs.isDirectory && !attrs.isSymbolicLink) { "Skill path contains a symbolic link or non-directory: $traversed" }
            identities += traversed to attrs.fileKey()
        }
        val opened = mutableListOf<DirectoryStream<Path>>()
        try {
            val rootStream = Files.newDirectoryStream(absolute.root).also(opened::add)
            var secure = rootStream as? SecureDirectoryStream<Path>
            if (secure != null) {
                for (part in absolute) secure = secure!!.newDirectoryStream(part, LinkOption.NOFOLLOW_LINKS).also(opened::add)
            }
            val access = DirectoryAccess(absolute, secure, identities)
            access.verify()
            return block(access)
        } finally {
            opened.asReversed().forEach { it.close() }
        }
    }

    /** macOS does not expose SecureDirectoryStream; recheck all directory identities around portable operations. */
    private class DirectoryAccess(
        private val path: Path,
        private val secure: SecureDirectoryStream<Path>?,
        private val identities: List<Pair<Path, Any?>>,
    ) {
        fun verify() {
            identities.forEach { (directory, expectedKey) ->
                val attrs = Files.readAttributes(directory, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
                require(attrs.isDirectory && !attrs.isSymbolicLink && (expectedKey == null || expectedKey == attrs.fileKey())) {
                    "Skill directory changed during access: $directory"
                }
            }
        }
        fun names(): List<String> {
            verify()
            val names = if (secure != null) secure.map { it.fileName.toString() }
                else Files.list(path).use { paths -> paths.map { it.fileName.toString() }.toList() }
            verify()
            return names
        }
        fun attributes(name: Path): BasicFileAttributes {
            verify()
            val attrs = secure?.getFileAttributeView(name, BasicFileAttributeView::class.java, LinkOption.NOFOLLOW_LINKS)?.readAttributes()
                ?: Files.readAttributes(path.resolve(name), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            verify()
            return attrs
        }
        fun channel(name: Path, options: Set<OpenOption>): SeekableByteChannel {
            verify()
            val channel = secure?.newByteChannel(name, options) ?: Files.newByteChannel(path.resolve(name), options)
            try { verify() } catch (e: Exception) { channel.close(); throw e }
            return channel
        }
        fun move(from: Path, to: Path) {
            verify()
            if (secure != null) secure.move(from, secure, to)
            else Files.move(path.resolve(from), path.resolve(to), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            verify()
        }
        fun delete(name: Path) {
            verify()
            if (secure != null) secure.deleteFile(name) else Files.delete(path.resolve(name))
        }
    }

    private fun header(content: String, defaultName: String): Pair<String, String> {
        val lines = content.removePrefix("\uFEFF").lineSequence().toList()
        if (lines.firstOrNull()?.trim() != "---") {
            validateName(defaultName)
            return defaultName to ""
        }
        val end = lines.drop(1).indexOfFirst { it.trim() == "---" }
        require(end >= 0) { "SKILL.md frontmatter is not closed" }
        val yaml = lines.subList(1, end + 1).joinToString("\n")
        val values = try {
            Load(LoadSettings.builder().setAllowDuplicateKeys(false).build()).loadFromString(yaml)
        } catch (e: org.snakeyaml.engine.v2.exceptions.YamlEngineException) {
            throw IllegalArgumentException("Invalid SKILL.md frontmatter: ${e.message}", e)
        }
        require(values == null || values is Map<*, *>) { "SKILL.md frontmatter must be an object" }
        val name = ((values as? Map<*, *>)?.get("name") as? String)?.trim()?.takeIf(String::isNotBlank) ?: defaultName
        validateName(name)
        return name to (((values as? Map<*, *>)?.get("description") as? String)?.trim().orEmpty())
    }

    private fun validateName(name: String) {
        require(name.matches(Regex("[\\p{L}\\p{N}][\\p{L}\\p{N}._-]{0,127}"))) { "Skill name must be one safe directory name of at most 128 characters" }
    }

    private data class Mount(val root: Path, val source: SkillResourceSource, val libraryId: String?, val permission: PermissionGroup, val enabled: Boolean)
    private data class Candidate(val item: SkillCatalogItem, val directory: String, val markdown: String)
    private data class Scan(val candidates: List<Candidate>, val diagnostics: List<String>) {
        fun result() = SkillCatalogResult(candidates.map { it.item }, diagnostics)
    }

    companion object { const val MAX_DOCUMENT_BYTES = 256 * 1024 }
}
