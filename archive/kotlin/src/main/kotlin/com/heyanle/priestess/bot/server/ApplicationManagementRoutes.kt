package com.heyanle.priestess.bot.server

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.*

fun Route.applicationManagementRoutes(service: ApplicationManagementService) {
    get("/agent-types") { call.respond(service.agentTypes()) }
    get("/provider-protocols") { call.respond(service.providerProtocols()) }
    get("/agent-presets") { call.respond(service.agentPresets()) }
    get("/compression-strategies") { call.respond(service.compressionStrategies()) }
    get("/config/v3") { call.respond(service.raw()) }
    post("/config/v3/preview") { call.respond(service.preview(call.receive<ConfigurationContentRequest>().content)) }
    put("/config/v3") {
        val request = call.receive<ConfigurationApplyRequest>()
        val result = service.apply(request.content, request.expectedRevision)
        call.respond(if (result.success) HttpStatusCode.OK else HttpStatusCode.Conflict, result)
    }
    post("/config/v3/reload") { call.respond(service.reload()) }
    post("/ims/{id}/route-test") {
        call.respond(service.testRoute(requireNotNull(call.parameters["id"]), call.receive()))
    }
    get("/memory-libraries/{id}/memories") {
        call.respond(service.listMemories(requireNotNull(call.parameters["id"]), call.request.queryParameters["query"].orEmpty(),
            call.request.queryParameters["limit"]?.toIntOrNull() ?: 100, call.request.queryParameters["offset"]?.toLongOrNull() ?: 0))
    }
    post("/memory-libraries/{id}/memories") {
        call.respond(HttpStatusCode.Created, service.saveMemory(requireNotNull(call.parameters["id"]), call.receive()))
    }
    delete("/memory-libraries/{id}/memories/{recordId}") {
        call.respond(service.deleteMemory(requireNotNull(call.parameters["id"]), requireNotNull(call.parameters["recordId"])))
    }
}
