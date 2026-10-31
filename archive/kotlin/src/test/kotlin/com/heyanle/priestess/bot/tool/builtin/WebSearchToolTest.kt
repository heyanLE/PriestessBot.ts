package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class WebSearchToolTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `web search falls back to bing html when searx endpoints fail`() = runBlocking {
        val client = HttpClient(
            MockEngine { request ->
                when (request.url.host) {
                    "searx.be", "search.inetol.net", "searx.tiekoetter.com" -> respond(
                        content = "forbidden",
                        status = HttpStatusCode.Forbidden,
                        headers = headersOf(HttpHeaders.ContentType, "text/plain"),
                    )

                    "www.bing.com" -> respond(
                        content = """
                            <html><body>
                              <li class="b_algo">
                                <h2><a href="https://kotlinlang.org/docs/coroutines-overview.html">Coroutines overview</a></h2>
                                <div><p>Asynchronous programming with coroutines in Kotlin.</p></div>
                              </li>
                              <li class="b_algo">
                                <h2><a href="https://developer.android.com/kotlin/coroutines">Use Kotlin coroutines on Android</a></h2>
                                <div><p>Guidance for structured concurrency on Android.</p></div>
                              </li>
                            </body></html>
                        """.trimIndent(),
                        headers = headersOf(HttpHeaders.ContentType, "text/html"),
                    )

                    else -> error("Unexpected host: ${request.url.host}")
                }
            },
        ) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val tool = WebSearchTool(client = client)
        val result = tool.execute(AgentToolContext(), mapOf("query" to "kotlin coroutines", "limit" to "2"))
        val response = json.decodeFromString<WebSearchResponse>(result.output)

        assertTrue(result.success)
        assertEquals(2, response.data.web.size)
        assertEquals("Coroutines overview", response.data.web[0].title)
        assertEquals("https://kotlinlang.org/docs/coroutines-overview.html", response.data.web[0].url)
        assertTrue(response.data.web[0].description.contains("Kotlin"))
    }
}
