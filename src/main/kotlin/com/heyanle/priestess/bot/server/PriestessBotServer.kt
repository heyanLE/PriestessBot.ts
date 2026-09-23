package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.config.ServerConfig
import io.ktor.serialization.kotlinx.json.json
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.netty.NettyApplicationEngine
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.path
import io.ktor.server.response.respond
import io.ktor.server.websocket.WebSockets
import kotlinx.serialization.json.Json

/**
 * Ktor 服务包装器，负责按服务端配置创建和关闭 Netty 引擎。
 */
class PriestessBotServer(
    private val config: ServerConfig,
    private val service: DashboardService,
) {
    private var engine: EmbeddedServer<NettyApplicationEngine, NettyApplicationEngine.Configuration>? = null

    fun start(wait: Boolean = false) {
        if (!config.enabled) return
        engine = embeddedServer(Netty, host = config.host, port = config.port) {
            configureDashboardApplication(service, config.corsEnabled, config.apiToken)
        }.start(wait = wait)
    }

    fun stop() {
        engine?.stop(gracePeriodMillis = 1_000, timeoutMillis = 5_000)
        engine = null
    }
}

fun Application.configureDashboardApplication(
    service: DashboardService,
    corsEnabled: Boolean = true,
    apiToken: String = "",
) {
    install(ContentNegotiation) {
        json(
            Json {
                prettyPrint = true
                ignoreUnknownKeys = true
                encodeDefaults = true
            },
        )
    }
    install(WebSockets)
    install(StatusPages) {
        exception<IllegalArgumentException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to cause.message.orEmpty()))
        }
        exception<NoSuchElementException> { call, cause ->
            call.respond(HttpStatusCode.NotFound, mapOf("error" to cause.message.orEmpty()))
        }
        exception<Throwable> { call, cause ->
            call.respond(
                HttpStatusCode.InternalServerError,
                mapOf("error" to (cause.message ?: cause::class.simpleName.orEmpty())),
            )
        }
    }
    if (corsEnabled) {
        install(CORS) {
            anyHost()
            allowHeader(io.ktor.http.HttpHeaders.ContentType)
            allowHeader(io.ktor.http.HttpHeaders.Authorization)
            allowMethod(io.ktor.http.HttpMethod.Get)
            allowMethod(io.ktor.http.HttpMethod.Post)
            allowMethod(io.ktor.http.HttpMethod.Put)
            allowMethod(io.ktor.http.HttpMethod.Delete)
        }
    }
    installDashboardApiTokenAuth(apiToken)
    dashboardRoutes(service)
}

private fun Application.installDashboardApiTokenAuth(apiToken: String) {
    val configuredToken = apiToken.takeIf { it.isNotBlank() } ?: return
    intercept(ApplicationCallPipeline.Plugins) {
        val path = call.request.path()
        if (!path.startsWith("/api/") && !path.startsWith("/ws/")) return@intercept

        val bearer = call.request.headers[io.ktor.http.HttpHeaders.Authorization]
            ?.removePrefix("Bearer ")
            ?.takeIf { it.isNotBlank() }
        val websocketToken = if (path.startsWith("/ws/")) call.request.queryParameters["token"] else null
        val suppliedToken = bearer ?: websocketToken
        if (suppliedToken != configuredToken) {
            call.respond(HttpStatusCode.Unauthorized, mapOf("error" to "Unauthorized"))
            finish()
        }
    }
}
