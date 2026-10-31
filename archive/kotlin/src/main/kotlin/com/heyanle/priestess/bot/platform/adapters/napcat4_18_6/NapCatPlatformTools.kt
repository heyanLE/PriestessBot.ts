package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.tool.*
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

object NapCatPlatformTools {
    fun all(): List<FunctionTool> = listOf(
        NapCatMentionUserTool(),
        NapCatReceivedFilesTool(),
        NapCatListGroupFilesTool(),
        NapCatGetGroupFileUrlTool(),
        NapCatSendFileTool(),
        NapCatDeleteGroupFileTool(),
        NapCatCreateGroupFolderTool(),
        NapCatDeleteGroupFolderTool(),
    )
}

private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }

private suspend fun napCatAction(
    context: AgentToolContext,
    groupOnly: Boolean = false,
    block: suspend (NapCatPlatform, MessageSession) -> String,
): ToolResult {
    val platform = context.platform as? NapCatPlatform
        ?: return ToolResult.error("Current Platform is not NapCat", "NAPCAT_CONTEXT_REQUIRED")
    val session = context.session
        ?: return ToolResult.error("Current message session is unavailable", "SESSION_REQUIRED")
    if (groupOnly && session.type != SessionType.GROUP) {
        return ToolResult.error("This NapCat action requires the current group session", "GROUP_SESSION_REQUIRED")
    }
    return try {
        ToolResult.success(block(platform, session))
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        ToolResult.error(e.message ?: "NapCat action failed", "NAPCAT_ACTION_FAILED")
    }
}

class NapCatMentionUserTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "napcat_mention_user",
        description = "Mark a QQ user to mention at the beginning of the final response in the current group. This tool sends no intermediate message.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("user_id", description = "Numeric QQ user id", required = true),
            ),
            required = listOf("user_id"),
        ),
        riskLevel = ToolRiskLevel.SESSION_ACTION,
        requiredCapabilities = listOf(ToolCapabilities.PLATFORM, ToolCapabilities.SESSION),
        auditLog = true,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val userId = args["user_id"]?.takeIf { it.matches(Regex("[0-9]+")) }
            ?.toLongOrNull()?.takeIf { it > 0 }?.toString()
            ?: return ToolResult.error("user_id must be a positive numeric QQ id", "VALIDATION_ERROR")
        if ("text" in args) {
            return ToolResult.error("Mention marks cannot contain text; write the response in the final answer", "VALIDATION_ERROR")
        }
        return napCatAction(context, groupOnly = true) { _, _ ->
            context.responseIntent.mention(userId)
            json.encodeToString(mapOf("status" to "marked", "mentionedUserId" to userId))
        }
    }
}

class NapCatReceivedFilesTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "napcat_received_files",
        description = "List file descriptors attached to the current inbound NapCat message.",
        riskLevel = ToolRiskLevel.SAFE_READ,
        requiredCapabilities = listOf(ToolCapabilities.PLATFORM, ToolCapabilities.SESSION),
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        return napCatAction(context) { _, _ ->
            val files = context.metadata["receivedFiles"]?.let {
                runCatching { json.decodeFromString<List<Map<String, String>>>(it) }.getOrDefault(emptyList())
            }.orEmpty()
            buildJsonObject {
                put("count", files.size)
                putJsonArray("files") {
                    files.forEach { file ->
                        add(buildJsonObject {
                            file.forEach { (key, value) -> put(key, value) }
                        })
                    }
                }
            }.toString()
        }
    }
}

class NapCatListGroupFilesTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "napcat_list_group_files",
        description = "List files and folders in the current QQ group root or a named folder.",
        parameters = ToolParameters(listOf(ParameterDef("folder_id", description = "Optional group folder id"))),
        riskLevel = ToolRiskLevel.EXTERNAL_READ,
        requiredCapabilities = listOf(ToolCapabilities.PLATFORM, ToolCapabilities.SESSION, ToolCapabilities.NETWORK),
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult = napCatAction(context, true) { platform, session ->
        val folder = args["folder_id"]?.takeIf { it.isNotBlank() }
        val action = if (folder == null) "get_group_root_files" else "get_group_files_by_folder"
        val data = platform.callAction(action, buildJsonObject {
            put("group_id", session.id.toLong())
            folder?.let { put("folder_id", it) }
        })
        data.toString()
    }
}

class NapCatGetGroupFileUrlTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "napcat_get_group_file_url",
        description = "Resolve a downloadable URL for a file in the current QQ group.",
        parameters = ToolParameters(
            listOf(
                ParameterDef("file_id", description = "Group file id", required = true),
                ParameterDef("busid", type = "integer", description = "Group file busid", required = true),
            ),
            listOf("file_id", "busid"),
        ),
        riskLevel = ToolRiskLevel.EXTERNAL_READ,
        requiredCapabilities = listOf(ToolCapabilities.PLATFORM, ToolCapabilities.SESSION, ToolCapabilities.NETWORK),
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult = napCatAction(context, true) { platform, session ->
        platform.callAction("get_group_file_url", buildJsonObject {
            put("group_id", session.id.toLong())
            put("file_id", args.getValue("file_id"))
            put("busid", args.getValue("busid").toInt())
        }).toString()
    }
}

class NapCatSendFileTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "napcat_send_file",
        description = "Mark an HTTP(S) file to attach to the final response in the current QQ session. Upload happens only when the final response is sent.",
        parameters = ToolParameters(
            listOf(
                ParameterDef("url", description = "HTTP(S) file URL", required = true),
                ParameterDef("name", description = "File name", required = true),
                ParameterDef("folder_id", description = "Optional current-group folder id"),
            ),
            listOf("url", "name"),
        ),
        riskLevel = ToolRiskLevel.HIGH_RISK,
        requiredCapabilities = listOf(ToolCapabilities.PLATFORM, ToolCapabilities.SESSION, ToolCapabilities.NETWORK),
        defaultEnabled = false,
        auditLog = true,
        requiredPermissionGroup = PermissionGroup.ADMIN,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val url = args["url"]?.takeIf { value -> runCatching { URI(value).let { it.scheme in setOf("http", "https") && !it.host.isNullOrBlank() } }.getOrDefault(false) }
            ?: return ToolResult.error("url must use http or https", "VALIDATION_ERROR")
        val name = args["name"]?.takeIf { it.isNotBlank() }
            ?: return ToolResult.error("name is required", "VALIDATION_ERROR")
        return napCatAction(context) { _, session ->
            val folderId = args["folder_id"]?.takeIf { it.isNotBlank() }
            require(folderId == null || session.type == SessionType.GROUP) { "folder_id requires a group session" }
            context.responseIntent.attach(MessageComponent.File(url, name, folderId = folderId))
            json.encodeToString(mapOf("status" to "marked", "name" to name))
        }
    }
}

class NapCatDeleteGroupFileTool : FunctionTool() {
    override val schema = destructiveSchema(
        "napcat_delete_group_file",
        "Delete a file from the current QQ group.",
        listOf(ParameterDef("file_id", required = true), ParameterDef("busid", type = "integer", required = true)),
    )
    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult = napCatAction(context, true) { platform, session ->
        platform.callAction("delete_group_file", buildJsonObject {
            put("group_id", session.id.toLong()); put("file_id", args.getValue("file_id")); put("busid", args.getValue("busid").toInt())
        }).toString()
    }
}

class NapCatCreateGroupFolderTool : FunctionTool() {
    override val schema = destructiveSchema(
        "napcat_create_group_folder",
        "Create a folder in the current QQ group files.",
        listOf(ParameterDef("folder_name", required = true)),
    )
    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult = napCatAction(context, true) { platform, session ->
        platform.callAction("create_group_file_folder", buildJsonObject {
            put("group_id", session.id.toLong()); put("name", args.getValue("folder_name"))
        }).toString()
    }
}

class NapCatDeleteGroupFolderTool : FunctionTool() {
    override val schema = destructiveSchema(
        "napcat_delete_group_folder",
        "Delete a folder from the current QQ group files.",
        listOf(ParameterDef("folder_id", required = true)),
    )
    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult = napCatAction(context, true) { platform, session ->
        platform.callAction("delete_group_folder", buildJsonObject {
            put("group_id", session.id.toLong()); put("folder_id", args.getValue("folder_id"))
        }).toString()
    }
}

private fun destructiveSchema(name: String, description: String, parameters: List<ParameterDef>) = ToolSchema(
    name = name,
    description = description,
    parameters = ToolParameters(parameters, parameters.filter { it.required }.map { it.name }),
    riskLevel = ToolRiskLevel.HIGH_RISK,
    requiredCapabilities = listOf(ToolCapabilities.PLATFORM, ToolCapabilities.SESSION, ToolCapabilities.NETWORK),
    defaultEnabled = false,
    auditLog = true,
    requiredPermissionGroup = PermissionGroup.ADMIN,
)
