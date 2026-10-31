package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.config.runtime.serverConfig
import com.heyanle.priestess.bot.platform.PlatformCase
import io.github.oshai.kotlinlogging.KotlinLogging
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

enum class WeixinQrLoginStatus {
    WAITING,
    SCANNED,
    CONFIRMED,
    EXPIRED,
    FAILED,
    CANCELLED,
}

data class WeixinQrLoginView(
    val sessionId: String,
    val platformId: String,
    val status: WeixinQrLoginStatus,
    val qrImageDataUrl: String? = null,
    val qrRevision: Int = 1,
    val expiresAtEpochMillis: Long,
    val pollAfterMillis: Long = 1_000,
    val message: String = "",
    val accountId: String? = null,
    val platformRunning: Boolean = false,
)

class WeixinQrLoginService internal constructor(
    private val runtimeConfig: RuntimeConfigurationCase,
    private val platformCase: PlatformCase,
    private val apiFactory: () -> WeixinQrApi = { KtorWeixinQrApi() },
    private val renderer: (String) -> String = WeixinQrRenderer::pngDataUrl,
    private val monotonicMillis: () -> Long = { System.nanoTime() / 1_000_000 },
    private val wallClockMillis: () -> Long = System::currentTimeMillis,
    private val pollDelayMillis: Long = 1_000,
    private val sessionTimeoutMillis: Long = 8 * 60_000,
    private val maximumRefreshes: Int = 3,
) {
    private val logger = KotlinLogging.logger {}
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sessions = ConcurrentHashMap<String, Session>()
    private val startLock = Any()

    suspend fun start(platformId: String): WeixinQrLoginView {
        requireDashboardAuthentication()
        val target = resolveTarget(platformId)
        val api = apiFactory()
        val initialCode = try {
            api.requestQrCode()
        } catch (error: Exception) {
            api.close()
            throw error
        }
        val nowMonotonic = monotonicMillis()
        val session = Session(
            id = UUID.randomUUID().toString(),
            target = target,
            api = api,
            code = initialCode,
            currentBaseUrl = WeixinConfig.DEFAULT_BASE_URL,
            deadlineMonotonicMillis = nowMonotonic + sessionTimeoutMillis,
            expiresAtEpochMillis = wallClockMillis() + sessionTimeoutMillis,
            createdMonotonicMillis = nowMonotonic,
            view = WeixinQrLoginView(
                sessionId = "",
                platformId = target.platformId,
                status = WeixinQrLoginStatus.WAITING,
                qrImageDataUrl = renderer(initialCode.scanContent),
                expiresAtEpochMillis = wallClockMillis() + sessionTimeoutMillis,
                message = "请使用微信扫描二维码，并在手机上确认登录",
            ),
        )
        session.view = session.view.copy(sessionId = session.id, expiresAtEpochMillis = session.expiresAtEpochMillis)

        synchronized(startLock) {
            cleanupSessionsLocked(nowMonotonic)
            check(sessions.size < MAX_SESSIONS) { "Too many Weixin QR login sessions are retained" }
            sessions.values
                .filter { it.target.platformId == target.platformId && it.view.status.isActive }
                .forEach { existing ->
                    existing.view = existing.view.copy(
                        status = WeixinQrLoginStatus.CANCELLED,
                        qrImageDataUrl = null,
                        message = "已被新的扫码会话替代",
                    )
                    existing.job?.cancel()
                }
            sessions[session.id] = session
            session.job = scope.launch { runSession(session) }
        }
        return session.view
    }

    fun status(platformId: String, sessionId: String): WeixinQrLoginView {
        requireDashboardAuthentication()
        val session = sessions[sessionId]
            ?: throw NoSuchElementException("Weixin QR login session not found")
        require(session.target.platformId == platformId) { "Weixin QR login session does not belong to platform '$platformId'" }
        return session.view
    }

    suspend fun cancel(platformId: String, sessionId: String): WeixinQrLoginView {
        requireDashboardAuthentication()
        val session = sessions[sessionId]
            ?: throw NoSuchElementException("Weixin QR login session not found")
        require(session.target.platformId == platformId) { "Weixin QR login session does not belong to platform '$platformId'" }
        if (session.view.status.isActive) {
            session.view = session.view.copy(
                status = WeixinQrLoginStatus.CANCELLED,
                qrImageDataUrl = null,
                message = "扫码登录已取消",
            )
            session.job?.cancelAndJoin()
        }
        return session.view
    }

    suspend fun stop() {
        sessions.values.forEach { it.job?.cancelAndJoin() }
        scope.cancel()
        sessions.clear()
    }

    private suspend fun runSession(session: Session) {
        try {
            while (kotlin.coroutines.coroutineContext.isActive) {
                if (monotonicMillis() >= session.deadlineMonotonicMillis) {
                    session.view = session.view.copy(
                        status = WeixinQrLoginStatus.EXPIRED,
                        qrImageDataUrl = null,
                        message = "扫码登录已超时，请重新生成二维码",
                    )
                    return
                }
                delay(pollDelayMillis)
                val response = try {
                    session.api.queryStatus(session.currentBaseUrl, session.code.token)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    logger.warn { "Weixin QR status request failed for platform '${session.target.platformId}': ${error.message}" }
                    session.view = session.view.copy(message = "暂时无法查询扫码状态，正在重试")
                    continue
                }
                when (response.string("status")?.lowercase() ?: "wait") {
                    "wait" -> session.view = session.view.copy(
                        status = WeixinQrLoginStatus.WAITING,
                        message = "请使用微信扫描二维码，并在手机上确认登录",
                    )
                    "scaned" -> session.view = session.view.copy(
                        status = WeixinQrLoginStatus.SCANNED,
                        message = "已扫码，请在微信中确认登录",
                    )
                    "scaned_but_redirect" -> handleRedirect(session, response)
                    "expired" -> if (!refresh(session)) return
                    "confirmed" -> {
                        confirm(session, response)
                        return
                    }
                    else -> {
                        session.view = session.view.copy(
                            status = WeixinQrLoginStatus.FAILED,
                            qrImageDataUrl = null,
                            message = "iLink 返回了无法识别的扫码状态",
                        )
                        return
                    }
                }
            }
        } catch (error: CancellationException) {
            if (session.view.status.isActive) {
                session.view = session.view.copy(
                    status = WeixinQrLoginStatus.CANCELLED,
                    qrImageDataUrl = null,
                    message = "扫码登录已取消",
                )
            }
            throw error
        } catch (error: Exception) {
            logger.warn { "Weixin QR login failed for platform '${session.target.platformId}': ${error.message}" }
            session.view = session.view.copy(
                status = WeixinQrLoginStatus.FAILED,
                qrImageDataUrl = null,
                message = error.message ?: "扫码登录失败",
            )
        } finally {
            session.api.close()
        }
    }

    private fun handleRedirect(session: Session, response: JsonObject) {
        val redirectHost = response.string("redirect_host")
            ?: throw WeixinQrException("iLink QR redirect response did not include redirect_host")
        session.currentBaseUrl = WeixinQrOriginPolicy.redirectBaseUrl(redirectHost)
        session.view = session.view.copy(
            status = WeixinQrLoginStatus.SCANNED,
            message = "已扫码，正在切换登录节点并等待确认",
        )
    }

    private suspend fun refresh(session: Session): Boolean {
        if (session.refreshCount >= maximumRefreshes) {
            session.view = session.view.copy(
                status = WeixinQrLoginStatus.EXPIRED,
                qrImageDataUrl = null,
                message = "二维码多次过期，请重新开始扫码",
            )
            return false
        }
        session.refreshCount += 1
        session.code = session.api.requestQrCode()
        session.currentBaseUrl = WeixinConfig.DEFAULT_BASE_URL
        session.view = session.view.copy(
            status = WeixinQrLoginStatus.WAITING,
            qrImageDataUrl = renderer(session.code.scanContent),
            qrRevision = session.view.qrRevision + 1,
            message = "二维码已刷新（${session.refreshCount}/$maximumRefreshes），请重新扫描",
        )
        return true
    }

    private suspend fun confirm(session: Session, response: JsonObject) {
        val accountId = response.string("ilink_bot_id")?.takeIf { it.isNotBlank() }
            ?: throw WeixinQrException("iLink confirmation did not include an account ID")
        val token = response.string("bot_token")?.takeIf { it.isNotBlank() }
            ?: throw WeixinQrException("iLink confirmation did not include a bot token")
        val baseUrl = WeixinQrOriginPolicy.validateConfirmedBaseUrl(
            response.string("baseurl")?.takeIf { it.isNotBlank() } ?: WeixinConfig.DEFAULT_BASE_URL,
        )
        val credentials = WeixinCredentials(
            accountId = accountId,
            token = token,
            baseUrl = baseUrl,
            userId = response.string("ilink_user_id").orEmpty(),
        )
        WeixinCredentialStore(session.target.stateDirectory).save(credentials)
        val restarted = platformCase.restart(session.target.platformId)
        session.view = session.view.copy(
            status = WeixinQrLoginStatus.CONFIRMED,
            qrImageDataUrl = null,
            message = if (restarted) "微信登录成功，平台已启动" else "微信凭据已保存，但平台启动失败，请检查日志",
            accountId = accountId,
            platformRunning = restarted,
        )
    }

    private fun resolveTarget(platformId: String): Target {
        require(platformId.isNotBlank()) { "Platform id must not be blank" }
        val connection = runtimeConfig.current().platforms[platformId]
            ?: throw NoSuchElementException("Configured platform '$platformId' not found")
        require(connection.type == "weixin") { "Platform '$platformId' is not a Weixin platform" }
        require("token" !in connection.credentials) {
            "Platform '$platformId' uses an explicit token credential; remove credentialRefs.token before QR login"
        }
        val stateDirectory = connection.settings["stateDirectory"]
            ?: ".priestess/weixin/${platformId.replace(Regex("[^A-Za-z0-9._-]"), "_")}"
        return Target(platformId, Path.of(stateDirectory))
    }

    private fun requireDashboardAuthentication() {
        check(runtimeConfig.current().serverConfig().apiToken.isNotBlank()) {
            "Weixin QR login requires runtime.server.apiCredentialRef so the Dashboard API is authenticated"
        }
    }

    private fun cleanupSessionsLocked(nowMonotonic: Long) {
        val removable = sessions.values
            .filter { !it.view.status.isActive && nowMonotonic - it.createdMonotonicMillis >= TERMINAL_RETENTION_MILLIS }
            .map { it.id }
        removable.forEach(sessions::remove)
        if (sessions.size < MAX_SESSIONS) return
        sessions.values
            .filter { !it.view.status.isActive }
            .sortedBy { it.createdMonotonicMillis }
            .take(sessions.size - MAX_SESSIONS + 1)
            .forEach { sessions.remove(it.id) }
    }

    private fun JsonObject.string(key: String): String? =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()

    private data class Target(
        val platformId: String,
        val stateDirectory: Path,
    )

    private class Session(
        val id: String,
        val target: Target,
        val api: WeixinQrApi,
        var code: WeixinQrCode,
        var currentBaseUrl: String,
        val deadlineMonotonicMillis: Long,
        val expiresAtEpochMillis: Long,
        val createdMonotonicMillis: Long,
        @Volatile var view: WeixinQrLoginView,
        var refreshCount: Int = 0,
        var job: Job? = null,
    )

    private val WeixinQrLoginStatus.isActive: Boolean
        get() = this == WeixinQrLoginStatus.WAITING || this == WeixinQrLoginStatus.SCANNED

    private companion object {
        const val MAX_SESSIONS = 128
        const val TERMINAL_RETENTION_MILLIS = 10 * 60_000L
    }
}
