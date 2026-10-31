package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.annotation.Tool
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Built-in web search tool.
 *
 * Performs internet searches via the SearXNG API (configurable).
 * Returns structured JSON search results.
 */
@Tool(name = "web_search", description = "Search the internet for up-to-date information")
class WebSearchTool(
    private val client: HttpClient = defaultClient(),
) : FunctionTool() {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true; encodeDefaults = true }
    private val searxEndpoints = listOf(
        "https://searx.be/search",
        "https://search.inetol.net/search",
        "https://searx.tiekoetter.com/search",
    )

    override val schema = ToolSchema(
        name = "web_search",
        description = "Search the internet for up-to-date information. Use this when you need current information, facts, or data that may not be in your training data.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef(name = "query", type = "string", description = "The search query string", required = true),
                ParameterDef(name = "limit", type = "integer", description = "Number of results (default: 5, max: 10)", required = false),
                ParameterDef(name = "num_results", type = "integer", description = "Backward-compatible alias for limit.", required = false),
            ),
            required = listOf("query"),
        ),
        riskLevel = ToolRiskLevel.EXTERNAL_READ,
        requiredCapabilities = listOf(ToolCapabilities.NETWORK, ToolCapabilities.PROVIDER_SEARCH),
        defaultEnabled = false,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val query = args["query"] ?: return ToolResult.error("Missing required parameter: query")
        val numResults = args["limit"]?.toIntOrNull()?.coerceIn(1, 10)
            ?: args["num_results"]?.toIntOrNull()?.coerceIn(1, 10)
            ?: 5

        return try {
            val results = searchWeb(query, numResults)
            ToolResult.success(
                json.encodeToString(
                    WebSearchResponse(
                        success = true,
                        data = WebSearchData(
                            web = results.mapIndexed { index, result ->
                                WebSearchItem(
                                    title = result.title,
                                    url = result.url,
                                    description = result.snippet,
                                    position = index + 1,
                                )
                            },
                        ),
                    ),
                ),
            )
        } catch (e: Exception) {
            ToolResult.error("Web search failed: ${e.message}")
        }
    }

    private suspend fun searchWeb(query: String, numResults: Int): List<SearchResult> {
        val searxResults = runCatching { searchSearXNG(query, numResults) }.getOrDefault(emptyList())
        if (searxResults.isNotEmpty()) return searxResults
        return searchBingHtml(query, numResults)
    }

    private suspend fun searchSearXNG(query: String, numResults: Int): List<SearchResult> {
        val encodedQuery = java.net.URLEncoder.encode(query, "UTF-8")
        val failures = mutableListOf<String>()
        for (endpoint in searxEndpoints) {
            val response = client.get("$endpoint?q=$encodedQuery&format=json&categories=general") {
                header(HttpHeaders.UserAgent, DEFAULT_USER_AGENT)
                header(HttpHeaders.Accept, "application/json")
            }
            if (!response.status.isSuccess()) {
                failures += "${endpoint.substringBefore("/search").substringAfter("://")}=${response.status.value}"
                continue
            }
            val body = response.bodyAsText()
            val root = json.parseToJsonElement(body).jsonObject
            val results = root["results"]?.jsonArray.orEmpty().map { element ->
                val obj = element.jsonObject
                SearchResult(
                    title = obj["title"]?.jsonPrimitive?.content ?: "",
                    url = obj["url"]?.jsonPrimitive?.content ?: "",
                    snippet = obj["content"]?.jsonPrimitive?.content ?: obj["snippet"]?.jsonPrimitive?.content ?: "",
                )
            }.filter { it.title.isNotBlank() && it.url.isNotBlank() }
            if (results.isNotEmpty()) {
                return results.take(numResults)
            }
        }
        if (failures.isNotEmpty()) {
            throw IllegalStateException("All SearXNG endpoints failed: ${failures.joinToString(", ")}")
        }
        return emptyList()
    }

    private suspend fun searchBingHtml(query: String, numResults: Int): List<SearchResult> {
        val encodedQuery = java.net.URLEncoder.encode(query, "UTF-8")
        val response = client.get("https://www.bing.com/search?q=$encodedQuery") {
            header(HttpHeaders.UserAgent, DEFAULT_USER_AGENT)
            header(HttpHeaders.Accept, "text/html,application/xhtml+xml")
        }
        if (!response.status.isSuccess()) {
            throw IllegalStateException("Bing search returned HTTP ${response.status.value}")
        }
        val body = response.bodyAsText()
        val blockRegex = Regex("""<li class="b_algo"[\s\S]*?</li>""", RegexOption.IGNORE_CASE)
        val linkRegex = Regex("""<h2><a href="([^"]+)"[^>]*>([\s\S]*?)</a>""", RegexOption.IGNORE_CASE)
        val snippetRegex = Regex("""<p>([\s\S]*?)</p>""", RegexOption.IGNORE_CASE)
        return blockRegex.findAll(body)
            .mapNotNull { block ->
                val link = linkRegex.find(block.value) ?: return@mapNotNull null
                val url = htmlDecode(link.groupValues[1]).trim()
                val title = htmlToText(link.groupValues[2]).trim()
                val snippet = htmlToText(snippetRegex.find(block.value)?.groupValues?.get(1).orEmpty()).trim()
                if (title.isBlank() || url.isBlank()) null else SearchResult(title = title, url = url, snippet = snippet)
            }
            .take(numResults)
            .toList()
    }

    private fun htmlToText(value: String): String {
        return htmlDecode(value.replace(Regex("<[^>]+>"), " "))
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun htmlDecode(value: String): String {
        return value
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&nbsp;", " ")
    }

    private data class SearchResult(val title: String, val url: String, val snippet: String)

    companion object {
        private const val DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"

        private fun defaultClient(): HttpClient {
            return HttpClient(CIO) {
                engine { requestTimeout = 15_000 }
            }
        }
    }
}

@Serializable
data class WebSearchResponse(
    val success: Boolean,
    val data: WebSearchData,
)

@Serializable
data class WebSearchData(
    val web: List<WebSearchItem>,
)

@Serializable
data class WebSearchItem(
    val title: String,
    val url: String,
    val description: String,
    val position: Int,
)
