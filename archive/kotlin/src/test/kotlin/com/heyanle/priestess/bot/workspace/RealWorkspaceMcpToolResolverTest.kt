package com.heyanle.priestess.bot.workspace

import com.heyanle.priestess.bot.tool.mcp.McpToolDef
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RealWorkspaceMcpToolResolverTest {
    @Test
    fun `connects session and exposes real mcp tools`() = runBlocking {
        val session = FakeWorkspaceMcpClientSession(
            tools = listOf(
                buildJsonObject {
                    put("name", "search")
                    put("description", "Search the workspace")
                    put(
                        "inputSchema",
                        buildJsonObject {
                            put("type", "object")
                        },
                    )
                },
            ),
        )
        val resolver = RealWorkspaceMcpToolResolver(factory = WorkspaceMcpClientFactory { session })

        val resolution = resolver.resolve(
            workspaceId = "default",
            servers = listOf(WorkspaceMcpServerConfig(id = "local", command = "mcp-server")),
        )

        assertTrue(session.connected)
        assertEquals(1, session.connectCalls)
        assertEquals(1, resolution.resources.size)
        assertEquals("local.search", resolution.resources.single().tool.schema.name)
        assertEquals("local.search", resolution.toolNames.single())
        assertEquals(1, resolution.handles.size)
        resolution.handles.single().close()
        assertTrue(!session.connected)
    }

    @Test
    fun `returns handles for cleanup when tool listing fails`() {
        val handle = RecordingHandle()
        val session = FakeWorkspaceMcpClientSession(
            connectFailure = null,
            listToolsFailure = IllegalStateException("tools unavailable"),
            handle = handle,
        )
        val resolver = RealWorkspaceMcpToolResolver(factory = WorkspaceMcpClientFactory { session })

        val error = assertFailsWith<WorkspaceMcpResolutionException> {
            resolver.resolve(
                workspaceId = "default",
                servers = listOf(WorkspaceMcpServerConfig(id = "local", command = "mcp-server")),
            )
        }

        assertTrue(error.message.orEmpty().contains("tools unavailable"))
        assertEquals(1, error.handles.size)
        error.handles.single().close()
        assertEquals(1, handle.closeCalls)
        assertEquals(1, session.connectCalls)
    }

    private class FakeWorkspaceMcpClientSession(
        private val tools: List<JsonObject> = emptyList(),
        private val connectFailure: Throwable? = null,
        private val listToolsFailure: Throwable? = null,
        private val handle: WorkspaceMcpClientHandle? = null,
    ) : WorkspaceMcpClientSession {
        var connected = false
            private set
        var connectCalls = 0
            private set

        override val isConnected: Boolean
            get() = connected

        override suspend fun connect() {
            connectCalls += 1
            connectFailure?.let { throw it }
            connected = true
        }

        override suspend fun disconnect() {
            connected = false
            handle?.close()
        }

        override suspend fun listTools(): List<JsonObject> {
            listToolsFailure?.let { throw it }
            return tools
        }

        override fun parseToolDefinition(mcpToolDef: JsonObject): McpToolDef {
            return McpToolDef(
                name = mcpToolDef["name"]?.toString()?.trim('"') ?: "unknown",
                description = mcpToolDef["description"]?.toString()?.trim('"') ?: "",
                inputSchema = mcpToolDef["inputSchema"]?.jsonObject,
            )
        }

        override suspend fun callTool(name: String, arguments: JsonObject): String {
            return "called:$name"
        }
    }

    private class RecordingHandle : WorkspaceMcpClientHandle {
        var closeCalls = 0
            private set

        override fun close() {
            closeCalls += 1
        }
    }
}
