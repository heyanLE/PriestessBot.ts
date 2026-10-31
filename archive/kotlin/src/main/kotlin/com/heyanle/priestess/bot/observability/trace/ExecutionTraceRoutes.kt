package com.heyanle.priestess.bot.observability.trace

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing

/** Uses the application's existing authenticated /api boundary. */
fun Application.traceRoutes(controller: ExecutionTraceController) {
    routing {
        get("/api/executions") {
            val query = call.request.queryParameters
            val rawStatus = query["status"]?.takeIf { it.isNotBlank() }
            val status = rawStatus?.let { runCatching { ExecutionStatus.valueOf(it.uppercase()) }.getOrNull() }
            if (rawStatus != null && status == null) {
                return@get call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Invalid execution status"))
            }
            call.respond(controller.list(ExecutionTraceFilter(
                platform = query["platform"], provider = query["provider"], agent = query["agent"],
                status = status, sessionId = query["sessionId"],
                limit = query["limit"]?.toIntOrNull() ?: 50, offset = query["offset"]?.toIntOrNull() ?: 0,
            )))
        }
        get("/api/executions/{id}") {
            val id = call.parameters["id"] ?: return@get call.respond(HttpStatusCode.BadRequest)
            val detail = controller.detail(id, call.request.queryParameters["afterSeq"]?.toIntOrNull() ?: 0,
                call.request.queryParameters["limit"]?.toIntOrNull() ?: 100)
                ?: return@get call.respond(HttpStatusCode.NotFound, mapOf("error" to "Execution not found"))
            call.respond(detail)
        }
    }
}
