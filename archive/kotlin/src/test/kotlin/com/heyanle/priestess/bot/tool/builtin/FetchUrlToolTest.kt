package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import java.net.InetAddress
import java.net.URI
import java.net.UnknownHostException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FetchUrlToolTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `fetches public html and returns simplified response`() = runBlocking {
        val tool = tool(
            responses = mapOf(
                "https://example.com/page" to UrlTransportResult.Response(
                    statusCode = 200,
                    contentType = "text/html; charset=utf-8",
                    bytes = "<html><head><title>Hello</title><script>bad()</script></head><body><h1>Hello</h1><p>World &amp; friends</p></body></html>".toByteArray(),
                ),
            ),
        )

        val result = tool.execute(AgentToolContext(), mapOf("url" to "https://example.com/page"))

        assertTrue(result.success)
        val response = json.decodeFromString<FetchUrlResponse>(result.output)
        assertEquals(200, response.statusCode)
        assertEquals("https://example.com/page", response.finalUrl)
        assertEquals("Hello", response.title)
        assertTrue(response.text.contains("Hello World & friends"))
        assertFalse(response.text.contains("bad()"))
    }

    @Test
    fun `truncates output by character limit`() = runBlocking {
        val tool = tool(
            responses = mapOf(
                "https://example.com/long" to UrlTransportResult.Response(
                    statusCode = 200,
                    contentType = "text/plain",
                    bytes = "abcdefghijklmnopqrstuvwxyz".toByteArray(),
                ),
            ),
        )

        val result = tool.execute(
            AgentToolContext(),
            mapOf("url" to "https://example.com/long", "max_chars" to "10"),
        )

        val response = json.decodeFromString<FetchUrlResponse>(result.output)
        assertEquals("abcdefghij", response.text)
        assertTrue(response.truncated)
    }

    @Test
    fun `follows public redirects and reports final url`() = runBlocking {
        val tool = tool(
            responses = mapOf(
                "https://example.com/start" to UrlTransportResult.Redirect("/final"),
                "https://example.com/final" to UrlTransportResult.Response(
                    statusCode = 200,
                    contentType = "text/plain",
                    bytes = "done".toByteArray(),
                ),
            ),
        )

        val result = tool.execute(AgentToolContext(), mapOf("url" to "https://example.com/start"))

        val response = json.decodeFromString<FetchUrlResponse>(result.output)
        assertEquals("https://example.com/final", response.finalUrl)
        assertEquals("done", response.text)
    }

    @Test
    fun `blocks localhost private and non http targets before transport`() = runBlocking {
        val transport = FakeTransport(emptyMap())
        val fetcher = SafeUrlFetcher(resolver = resolver(), transport = transport)
        val tool = FetchUrlTool(fetcher)

        val localhost = tool.execute(AgentToolContext(), mapOf("url" to "http://localhost:8080"))
        val privateIp = tool.execute(AgentToolContext(), mapOf("url" to "http://private.example"))
        val file = tool.execute(AgentToolContext(), mapOf("url" to "file:///etc/passwd"))

        assertEquals("BLOCKED_TARGET", localhost.errorCode)
        assertEquals("BLOCKED_TARGET", privateIp.errorCode)
        assertEquals("BLOCKED_TARGET", file.errorCode)
        assertEquals(emptyList(), transport.requests)
    }

    @Test
    fun `returns structured dns tls timeout content http and redirect errors`() = runBlocking {
        val unsupported = tool(
            responses = mapOf(
                "https://example.com/image" to UrlTransportResult.Response(
                    statusCode = 200,
                    contentType = "image/png",
                    bytes = byteArrayOf(1, 2, 3),
                ),
            ),
        ).execute(AgentToolContext(), mapOf("url" to "https://example.com/image"))
        val httpFailure = tool(
            responses = mapOf(
                "https://example.com/missing" to UrlTransportResult.Response(
                    statusCode = 404,
                    contentType = "text/plain",
                    bytes = "missing".toByteArray(),
                ),
            ),
        ).execute(AgentToolContext(), mapOf("url" to "https://example.com/missing"))
        val redirectLimit = tool(
            responses = mapOf(
                "https://example.com/a" to UrlTransportResult.Redirect("/b"),
                "https://example.com/b" to UrlTransportResult.Redirect("/c"),
            ),
        ).execute(AgentToolContext(), mapOf("url" to "https://example.com/a", "max_redirects" to "1"))
        val dns = FetchUrlTool(
            SafeUrlFetcher(
                resolver = HostResolver { throw UnknownHostException("nope") },
                transport = FakeTransport(emptyMap()),
            ),
        ).execute(AgentToolContext(), mapOf("url" to "https://unknown.example"))

        assertEquals("UNSUPPORTED_CONTENT", unsupported.errorCode)
        assertEquals("HTTP_FAILURE", httpFailure.errorCode)
        assertEquals("REDIRECT_LIMIT", redirectLimit.errorCode)
        assertEquals("DNS_FAILURE", dns.errorCode)
    }

    private fun tool(responses: Map<String, UrlTransportResult>): FetchUrlTool {
        return FetchUrlTool(SafeUrlFetcher(resolver = resolver(), transport = FakeTransport(responses)))
    }

    private fun resolver(): HostResolver = HostResolver { host ->
        when (host) {
            "example.com" -> listOf(InetAddress.getByName("93.184.216.34"))
            "private.example" -> listOf(InetAddress.getByName("192.168.1.10"))
            else -> throw UnknownHostException(host)
        }
    }

    private class FakeTransport(
        private val responses: Map<String, UrlTransportResult>,
    ) : UrlTransport {
        val requests = mutableListOf<URI>()

        override suspend fun get(uri: URI, request: FetchUrlRequest): UrlTransportResult {
            requests += uri
            return responses[uri.toString()] ?: error("No fake response for $uri")
        }
    }
}
