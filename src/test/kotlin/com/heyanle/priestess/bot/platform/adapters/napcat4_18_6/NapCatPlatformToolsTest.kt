package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.tool.*
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.*
import io.ktor.http.content.TextContent
import io.ktor.serialization.kotlinx.json.json
import kotlin.test.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

class NapCatPlatformToolsTest {
    @Test
    fun `group file reads allow ordinary operator while writes require senior operator`() = runBlocking {
        val readTools = listOf(
            NapCatReceivedFilesTool(),
            NapCatListGroupFilesTool(),
            NapCatGetGroupFileUrlTool(),
        )
        val writeTools = listOf(
            NapCatSendFileTool(),
            NapCatDeleteGroupFileTool(),
            NapCatCreateGroupFolderTool(),
            NapCatDeleteGroupFolderTool(),
        )

        assertTrue(readTools.all { it.schema.requiredPermissionGroup == PermissionGroup.OPERATOR })
        assertTrue(writeTools.all { it.schema.requiredPermissionGroup == PermissionGroup.ADMIN })

        val capture = Capture()
        val toolContext = context(platform(capture), permission = PermissionGroup.OPERATOR)
        val controller = ToolController().apply { (readTools + writeTools).forEach(::register) }
        val executor = ToolExecutor(controller)
        val readResults = listOf(
            executor.execute(toolContext, "napcat_received_files", "{}"),
            executor.execute(toolContext, "napcat_list_group_files", "{}"),
            executor.execute(toolContext, "napcat_get_group_file_url", """{"file_id":"file-1","busid":7}"""),
        )
        val callsAfterReads = capture.calls
        val writeResults = listOf(
            executor.execute(toolContext, "napcat_send_file", """{"url":"https://files.example/a.zip","name":"a.zip"}"""),
            executor.execute(toolContext, "napcat_delete_group_file", """{"file_id":"file-1","busid":7}"""),
            executor.execute(toolContext, "napcat_create_group_folder", """{"folder_name":"reports"}"""),
            executor.execute(toolContext, "napcat_delete_group_folder", """{"folder_id":"folder-1"}"""),
        )

        assertTrue(readResults.all { it.success })
        assertEquals(2, callsAfterReads)
        assertTrue(writeResults.all { !it.success && it.errorCode == "PERMISSION_DENIED" })
        assertEquals(callsAfterReads, capture.calls)
    }

    @Test
    fun `mention tools only mark final response without sending intermediate messages`() = runBlocking {
        val capture = Capture()
        val ctx = context(platform(capture))
        val tool = NapCatMentionUserTool()
        repeat(2) { assertTrue(tool.execute(ctx, mapOf("user_id" to "00123")).success) }
        assertEquals(listOf("123"), ctx.responseIntent.snapshot().mentions)
        assertEquals(0, capture.calls)
        assertEquals(listOf("user_id"), tool.schema.parameters.properties.map { it.name })
        assertFalse(NapCatPlatformTools.all().any { it.schema.name == "napcat_reply_message" })
        for (invalid in listOf("", "0", "-12", "all", "１２３", "123[CQ:at,qq=all]", "999999999999999999999")) {
            assertFalse(tool.execute(ctx, mapOf("user_id" to invalid)).success, invalid)
        }
        assertFalse(tool.execute(ctx, mapOf("user_id" to "124", "text" to "intermediate reply")).success)
        assertEquals(listOf("123"), ctx.responseIntent.snapshot().mentions)
        assertEquals(0, capture.calls)
    }

    @Test
    fun `file tool only marks attachment with destination folder`() = runBlocking {
        val capture = Capture()
        val ctx = context(platform(capture))
        val result = NapCatSendFileTool().execute(ctx, mapOf(
            "url" to "https://files.example/a.zip", "name" to "a.zip", "folder_id" to "folder-1",
        ))
        assertTrue(result.success, result.error)
        assertEquals(listOf(MessageComponent.File("https://files.example/a.zip", "a.zip", "folder-1")), ctx.responseIntent.snapshot().attachments)
        assertEquals(0, capture.calls)
    }

    @Test
    fun `final message uses authenticated native segments and literal text cannot inject CQ`() = runBlocking {
        val capture = Capture()
        val platform = platform(capture)
        val result = platform.sendMessage(context(platform).session!!, MessageChain(listOf(
            MessageComponent.Reply("9988"),
            MessageComponent.At("123"),
            MessageComponent.Text(" "),
            MessageComponent.Text("hello **world** [CQ:at,qq=all]"),
            MessageComponent.Image("base64://aGVsbG8="),
        )))
        assertEquals("123", result)
        assertEquals("/send_group_msg", capture.path)
        assertEquals("Bearer secret", capture.authorization)
        val body = Json.parseToJsonElement(capture.body).jsonObject
        assertEquals(654321, body.getValue("group_id").jsonPrimitive.int)
        val segments = body.getValue("message").jsonArray
        assertEquals(listOf("reply", "at", "text", "text", "image"), segments.map { it.jsonObject.getValue("type").jsonPrimitive.content })
        assertEquals("9988", segments[0].jsonObject.getValue("data").jsonObject.getValue("id").jsonPrimitive.content)
        assertEquals("hello world [CQ:at,qq=all]", segments[3].jsonObject.getValue("data").jsonObject.getValue("text").jsonPrimitive.content)
        assertEquals("base64://aGVsbG8=", segments[4].jsonObject.getValue("data").jsonObject.getValue("file").jsonPrimitive.content)
    }

    @Test
    fun `final file upload uses current group folder and private target`() = runBlocking {
        val capture = Capture()
        val platform = platform(capture)
        platform.sendMessage(context(platform).session!!, MessageChain(listOf(
            MessageComponent.Reply("9988"),
            MessageComponent.File("https://files.example/a.zip", "a.zip", "folder-1"),
        )))
        assertEquals(1, capture.calls)
        assertEquals("/upload_group_file", capture.path)
        var body = Json.parseToJsonElement(capture.body).jsonObject
        assertEquals("folder-1", body.getValue("folder").jsonPrimitive.content)
        assertEquals(654321, body.getValue("group_id").jsonPrimitive.int)
        platform.sendMessage(context(platform, SessionType.PRIVATE).session!!, MessageChain(listOf(
            MessageComponent.File("https://files.example/b.zip", "b.zip"),
        )))
        assertEquals("/upload_private_file", capture.path)
        body = Json.parseToJsonElement(capture.body).jsonObject
        assertEquals(123456, body.getValue("user_id").jsonPrimitive.int)
        assertFalse("folder" in body)
    }

    @Test
    fun `group tools reject private context before API call`() = runBlocking {
        val capture = Capture()
        val result = NapCatMentionUserTool().execute(context(platform(capture), SessionType.PRIVATE), mapOf("user_id" to "123"))

        assertFalse(result.success)
        assertEquals("GROUP_SESSION_REQUIRED", result.errorCode)
        assertEquals(0, capture.calls)
    }

    @Test
    fun `NapCat tools reject incompatible platform context`() = runBlocking {
        val result = NapCatReceivedFilesTool().execute(
            AgentToolContext(
                session = MessageSession("654321", SessionType.GROUP, "telegram"),
                permissionGroup = PermissionGroup.SUPER_ADMIN,
            ),
            emptyMap(),
        )

        assertFalse(result.success)
        assertEquals("NAPCAT_CONTEXT_REQUIRED", result.errorCode)
    }

    @Test
    fun `received files are returned from current tool metadata`() = runBlocking {
        val files = Json.encodeToString(listOf(mapOf("name" to "report.pdf", "url" to "https://files.example/report.pdf")))
        val result = NapCatReceivedFilesTool().execute(
            context(platform(Capture()), SessionType.GROUP, mapOf("receivedFiles" to files)),
            emptyMap(),
        )

        assertTrue(result.success)
        assertTrue(result.output.contains("report.pdf"))
        assertTrue(result.output.contains("https://files.example/report.pdf"))
    }

    @Test
    fun `list and destructive actions target only current group`() = runBlocking {
        val capture = Capture()
        val platform = platform(capture)
        val list = NapCatListGroupFilesTool().execute(context(platform), emptyMap())
        assertTrue(list.success)
        assertEquals("/get_group_root_files", capture.path)

        val delete = NapCatDeleteGroupFileTool().execute(context(platform), mapOf("file_id" to "file-1", "busid" to "7"))
        assertTrue(delete.success)
        assertEquals("/delete_group_file", capture.path)
        assertEquals(654321, Json.parseToJsonElement(capture.body).jsonObject.getValue("group_id").jsonPrimitive.int)
        assertFalse(NapCatDeleteGroupFileTool().schema.defaultEnabled)
        assertEquals(PermissionGroup.ADMIN, NapCatDeleteGroupFileTool().schema.requiredPermissionGroup)
        assertEquals(ToolRiskLevel.HIGH_RISK, NapCatDeleteGroupFileTool().schema.riskLevel)

        val createFolder = NapCatCreateGroupFolderTool().execute(context(platform), mapOf("folder_name" to "reports"))
        assertTrue(createFolder.success)
        val createBody = Json.parseToJsonElement(capture.body).jsonObject
        assertEquals("reports", createBody.getValue("name").jsonPrimitive.content)
        assertFalse("folder_name" in createBody)
    }

    @Test
    fun `file upload rejects non http URL and operator permission`() = runBlocking {
        val capture = Capture()
        val tool = NapCatSendFileTool()
        val invalid = tool.execute(context(platform(capture)), mapOf("url" to "file:///etc/passwd", "name" to "bad"))
        assertFalse(invalid.success)
        assertEquals(0, capture.calls)

        val registry = ToolController().apply { register(tool) }
        val denied = ToolExecutor(registry).execute(
            context(platform(capture), permission = PermissionGroup.OPERATOR),
            tool.schema.name,
            """{"url":"https://files.example/a.zip","name":"a.zip"}""",
        )
        assertFalse(denied.success)
        assertEquals("PERMISSION_DENIED", denied.errorCode)
        assertEquals(0, capture.calls)
    }

    @Test
    fun `tool cancellation propagates without producing a success or error reply`() = runBlocking {
        val client = HttpClient(MockEngine { throw kotlinx.coroutines.CancellationException("cancelled") }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        val platform = NapCatPlatform(httpClient = client)
        assertFailsWith<kotlinx.coroutines.CancellationException> {
            NapCatListGroupFilesTool().execute(context(platform), emptyMap())
        }
        platform.terminate()
    }

    @Test
    fun `escaped formatting is converted only once in final text`() = runBlocking {
        val capture = Capture()
        val platform = platform(capture)
        platform.sendMessage(context(platform).session!!, MessageChain.text("\\*literal\\*"))
        val segments = Json.parseToJsonElement(capture.body).jsonObject.getValue("message").jsonArray
        assertEquals("*literal*", segments.single().jsonObject.getValue("data").jsonObject.getValue("text").jsonPrimitive.content)
    }

    @Test
    fun `OneBot failure becomes structured tool error`() = runBlocking {
        val capture = Capture(response = """{"status":"failed","retcode":100,"message":"denied","data":null}""")
        val result = NapCatListGroupFilesTool().execute(context(platform(capture)), emptyMap())
        assertFalse(result.success)
        assertEquals("NAPCAT_ACTION_FAILED", result.errorCode)
        assertTrue(result.error.contains("retcode=100"))
    }

    @Test
    fun `HTTP failure becomes structured tool error`() = runBlocking {
        val client = HttpClient(MockEngine { respondError(HttpStatusCode.BadGateway) }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        val platform = NapCatPlatform(NapCatConfig(host = "napcat", port = 3000, token = "secret"), client)

        val result = NapCatListGroupFilesTool().execute(context(platform), emptyMap())

        assertFalse(result.success)
        assertEquals("NAPCAT_ACTION_FAILED", result.errorCode)
        assertTrue(result.error.contains("HTTP 502"))
    }

    private fun context(
        platform: NapCatPlatform,
        type: SessionType = SessionType.GROUP,
        metadata: Map<String, String> = emptyMap(),
        permission: PermissionGroup = PermissionGroup.SUPER_ADMIN,
    ) = AgentToolContext(
        platform = platform,
        session = MessageSession(if (type == SessionType.GROUP) "654321" else "123456", type, platform.metadata.name, metadata),
        metadata = metadata,
        permissionGroup = permission,
    )

    private fun platform(capture: Capture): NapCatPlatform {
        val client = HttpClient(MockEngine { request ->
            capture.calls++
            capture.path = request.url.encodedPath
            capture.authorization = request.headers[HttpHeaders.Authorization]
            capture.body = (request.body as TextContent).text
            respond(capture.response, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } }
        return NapCatPlatform(NapCatConfig(host = "napcat", port = 3000, token = "secret"), client)
    }

    private data class Capture(
        var response: String = """{"status":"ok","retcode":0,"data":{"message_id":123,"files":[],"folders":[]}}""",
        var calls: Int = 0,
        var path: String = "",
        var authorization: String? = null,
        var body: String = "",
    )
}
