package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.resources.*
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import kotlinx.coroutines.CancellationException
import java.nio.file.AccessDeniedException
import java.nio.file.FileSystemException
import java.nio.file.NoSuchFileException

/** Mount under the authenticated /api route. All paths are resolved by the catalog. */
fun Route.agentSkillRoutes(catalog: AgentSkillCatalog) {
    get("/agents/{id}/skills") {
        call.skillResponse { catalog.listAgent(call.requiredParameter("id")) }
    }
    get("/agents/{id}/skills/document") {
        call.skillResponse {
            catalog.readAgent(
                call.requiredParameter("id"),
                SkillResourceSource.valueOf(call.requiredQuery("source")),
                call.requiredQuery("name"),
                call.request.queryParameters["libraryId"]?.takeIf(String::isNotBlank),
            )
        }
    }
    put("/agents/{id}/skills") {
        call.skillResponse { catalog.writeAgent(call.requiredParameter("id"), call.receive<AgentSkillWriteRequest>()) }
    }
    get("/skill-libraries/{id}/skills") {
        call.skillResponse { catalog.listLibrary(call.requiredParameter("id")) }
    }
    get("/skill-libraries/{id}/skills/document") {
        call.skillResponse { catalog.readLibrary(call.requiredParameter("id"), call.requiredQuery("name")) }
    }
    put("/skill-libraries/{id}/skills") {
        call.skillResponse { catalog.writeLibrary(call.requiredParameter("id"), call.receive<LibrarySkillWriteRequest>()) }
    }
}

private fun ApplicationCall.requiredParameter(name: String): String =
    requireNotNull(parameters[name]) { "Missing parameter '$name'" }

private fun ApplicationCall.requiredQuery(name: String): String =
    requireNotNull(request.queryParameters[name]) { "Missing query parameter '$name'" }

private suspend inline fun <reified T : Any> ApplicationCall.skillResponse(block: () -> T) {
    try {
        respond(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: NoSuchElementException) {
        respond(HttpStatusCode.NotFound, mapOf("error" to e.message.orEmpty()))
    } catch (e: NoSuchFileException) {
        respond(HttpStatusCode.NotFound, mapOf("error" to "Skill document does not exist"))
    } catch (e: AccessDeniedException) {
        respond(HttpStatusCode.Forbidden, mapOf("error" to "Skill directory access is denied"))
    } catch (e: FileSystemException) {
        respond(HttpStatusCode.BadRequest, mapOf("error" to "Skill path must contain only regular directories and files"))
    } catch (e: IllegalArgumentException) {
        respond(HttpStatusCode.BadRequest, mapOf("error" to e.message.orEmpty()))
    }
}
