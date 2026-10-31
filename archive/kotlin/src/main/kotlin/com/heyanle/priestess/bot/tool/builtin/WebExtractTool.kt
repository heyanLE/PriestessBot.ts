package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class WebExtractTool(
    private val fetcher: SafeUrlFetcher = SafeUrlFetcher(),
) : FunctionTool() {
    override val schema = ToolSchema(
        name = "web_extract",
        description = "Extract simplified content from one or more public HTTP(S) pages.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("url", description = "Single URL to extract."),
                ParameterDef("urls", type = "array", items = "string", description = "Optional list of URLs to extract."),
                ParameterDef("timeout_ms", type = "integer", description = "Per-request timeout in milliseconds, default 10000."),
                ParameterDef("max_chars", type = "integer", description = "Maximum characters per page, default 12000."),
            ),
        ),
        riskLevel = ToolRiskLevel.EXTERNAL_READ,
        requiredCapabilities = listOf(ToolCapabilities.NETWORK),
        defaultEnabled = false,
        auditLog = false,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val urls = buildList {
            args["url"]?.trim()?.takeIf { it.isNotBlank() }?.let(::add)
            addAll(parseStringListArg(args["urls"]))
        }.distinct()
        if (urls.isEmpty()) {
            return ToolResult.error("Either url or urls is required", "VALIDATION_ERROR")
        }
        val requestTemplate = FetchUrlRequest(
            url = "",
            timeoutMillis = args["timeout_ms"]?.toIntOrNull()?.coerceIn(100, 30_000) ?: 10_000,
            maxBytes = 524_288,
            maxChars = args["max_chars"]?.toIntOrNull()?.coerceIn(1, 50_000) ?: 12_000,
            maxRedirects = 3,
        )
        val results = urls.map { url ->
            when (val result = fetcher.fetch(requestTemplate.copy(url = url))) {
                is FetchUrlResult.Success -> WebExtractItem(
                    url = result.response.finalUrl,
                    title = result.response.title,
                    content = result.response.text,
                    statusCode = result.response.statusCode,
                    contentType = result.response.contentType,
                    truncated = result.response.truncated,
                )
                is FetchUrlResult.Failure -> WebExtractItem(
                    url = url,
                    error = result.message,
                )
            }
        }
        return ToolResult.success(
            json.encodeToString(
                WebExtractResponse(
                    success = results.any { it.error == null },
                    results = results,
                ),
            ),
        )
    }
}

@Serializable
data class WebExtractResponse(
    val success: Boolean,
    val results: List<WebExtractItem>,
)

@Serializable
data class WebExtractItem(
    val url: String,
    val title: String? = null,
    val content: String? = null,
    val statusCode: Int? = null,
    val contentType: String? = null,
    val truncated: Boolean = false,
    val error: String? = null,
)
