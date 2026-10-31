package com.heyanle.priestess.bot.resources

import com.heyanle.priestess.bot.server.agentSkillRoutes
import io.ktor.client.request.*
import io.ktor.client.statement.bodyAsText
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import java.nio.file.Files
import kotlin.test.*

class AgentSkillRoutesTest {
    @Test
    fun `agent and library endpoints round-trip documents and expose selected source metadata`() = testApplication {
        val fixture = AgentSkillFixture()
        application {
            install(ContentNegotiation) { json(Json { encodeDefaults = true }) }
            routing { route("/api") { agentSkillRoutes(fixture.catalog) } }
        }
        try {
            val content = fixture.markdown("demo", "Agent configuration skill")
            val saved = client.put("/api/agents/agent/skills") {
                contentType(ContentType.Application.Json)
                setBody(Json.encodeToString(AgentSkillWriteRequest(SkillResourceSource.CONFIGURATION, "demo", content)))
            }
            assertEquals(HttpStatusCode.OK, saved.status)
            val preview = client.get("/api/agents/agent/skills/document?source=CONFIGURATION&name=demo")
            assertEquals(HttpStatusCode.OK, preview.status)
            assertEquals(content, Json.parseToJsonElement(preview.bodyAsText()).jsonObject["content"]?.jsonPrimitive?.content)

            val libraryContent = fixture.markdown("shared", "Shared library skill")
            val librarySaved = client.put("/api/skill-libraries/lib/skills") {
                contentType(ContentType.Application.Json)
                setBody(Json.encodeToString(LibrarySkillWriteRequest("shared", libraryContent)))
            }
            assertEquals(HttpStatusCode.OK, librarySaved.status)
            assertEquals(HttpStatusCode.OK, client.get("/api/skill-libraries/lib/skills/document?name=shared").status)
            val listing = Json.parseToJsonElement(client.get("/api/agents/agent/skills").bodyAsText()).jsonObject
            val items = listing.getValue("items").jsonArray.map { it.jsonObject }
            assertEquals(setOf("CONFIGURATION", "PLATFORM"), items.map { it.getValue("source").jsonPrimitive.content }.toSet())
            assertEquals("ADMIN", items.single { it["name"]?.jsonPrimitive?.content == "demo" }.getValue("permissionGroup").jsonPrimitive.content)
            assertEquals("lib", items.single { it["name"]?.jsonPrimitive?.content == "shared" }.getValue("libraryId").jsonPrimitive.content)
            val libraryListing = Json.parseToJsonElement(client.get("/api/skill-libraries/lib/skills").bodyAsText()).jsonObject
            assertEquals(1, libraryListing.getValue("items").jsonArray.size)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun `skill endpoints reject traversal invalid frontmatter excessive size and symlink escape`() = testApplication {
        val fixture = AgentSkillFixture()
        application {
            install(ContentNegotiation) { json() }
            routing { route("/api") { agentSkillRoutes(fixture.catalog) } }
        }
        try {
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/skill-libraries/lib/skills/document?name=..%2Fescape").status)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/agents/agent/skills/document?name=demo").status)
            assertEquals(HttpStatusCode.NotFound, client.get("/api/agents/missing/skills").status)
            assertEquals(HttpStatusCode.NotFound, client.get("/api/agents/agent/skills/document?source=PLATFORM&libraryId=unmounted&name=demo").status)
            for (request in listOf(
                LibrarySkillWriteRequest("../escape", "outside"),
                LibrarySkillWriteRequest("demo", "---\nname: demo\nnever closed"),
                LibrarySkillWriteRequest("demo", "x".repeat(AgentSkillCatalog.MAX_DOCUMENT_BYTES + 1)),
            )) {
                assertEquals(HttpStatusCode.BadRequest, client.put("/api/skill-libraries/lib/skills") {
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(request))
                }.status)
            }
            val outside = Files.createDirectories(fixture.root.resolve("outside"))
            Files.writeString(outside.resolve("SKILL.md"), "do not overwrite")
            val library = Files.createDirectories(fixture.root.resolve("data/platform/skills/lib"))
            Files.createSymbolicLink(library.resolve("escape"), outside)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/skill-libraries/lib/skills/document?name=escape").status)
            assertEquals(HttpStatusCode.BadRequest, client.put("/api/skill-libraries/lib/skills") {
                contentType(ContentType.Application.Json)
                setBody(Json.encodeToString(LibrarySkillWriteRequest("escape", "overwrite")))
            }.status)
            assertEquals("do not overwrite", Files.readString(outside.resolve("SKILL.md")))
        } finally {
            fixture.close()
        }
    }
}
