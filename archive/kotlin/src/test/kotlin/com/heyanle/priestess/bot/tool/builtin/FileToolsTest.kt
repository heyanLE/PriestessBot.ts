package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FileToolsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `read file paginates and patch updates content`() = runBlocking {
        val root = Files.createTempDirectory("file-tools")
        val file = root.resolve("notes.txt")
        file.writeText("one\ntwo\nthree\n")
        val context = AgentToolContext(metadata = mapOf("workspaceRootDir" to root.toString()))

        val read = ReadFileTool().execute(context, mapOf("path" to "notes.txt", "offset" to "2", "limit" to "2"))
        val readResponse = json.decodeFromString<ReadFileResponse>(read.output)
        assertTrue(read.success)
        assertEquals("two\nthree", readResponse.content)
        assertTrue(readResponse.truncated.not())

        val patched = PatchFileTool().execute(
            context,
            mapOf("path" to "notes.txt", "old_string" to "two", "new_string" to "TWO"),
        )
        assertTrue(patched.success)
        assertEquals("one\nTWO\nthree\n", Files.readString(file))
    }

    @Test
    fun `search files supports content and filename targets`() = runBlocking {
        val root = Files.createTempDirectory("search-files")
        root.resolve("alpha.kt").writeText("println(\"needle\")\n")
        root.resolve("beta.txt").writeText("plain text\n")
        val context = AgentToolContext(metadata = mapOf("workspaceRootDir" to root.toString()))

        val content = SearchFilesTool().execute(context, mapOf("pattern" to "needle"))
        val contentResponse = json.decodeFromString<SearchFilesResponse>(content.output)
        assertTrue(content.success)
        assertEquals(1, contentResponse.totalCount)
        assertEquals("alpha.kt", contentResponse.matches!!.single().path)

        val files = SearchFilesTool().execute(context, mapOf("pattern" to "beta", "target" to "files"))
        val filesResponse = json.decodeFromString<SearchFilesResponse>(files.output)
        assertTrue(files.success)
        assertEquals(listOf("beta.txt"), filesResponse.files)
    }

    @Test
    fun `write file blocks path escape outside workspace`() = runBlocking {
        val root = Files.createTempDirectory("write-file-guard")
        val context = AgentToolContext(metadata = mapOf("workspaceRootDir" to root.toString()))

        val result = WriteFileTool().execute(
            context,
            mapOf("path" to "../outside.txt", "content" to "bad"),
        )

        assertFalse(result.success)
        assertEquals("WRITE_FAILED", result.errorCode)
    }
}
