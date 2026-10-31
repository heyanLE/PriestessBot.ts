package com.heyanle.priestess.bot.server

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 服务端模块门面，向运行时和其他模块暴露 HTTP 生命周期与健康快照能力。
 */
class ServerCase(
    private val controller: ServerController,
    private val healthProvider: RuntimeHealthProvider,
) {
    private val json = Json {
        encodeDefaults = true
        prettyPrint = true
    }

    fun start(wait: Boolean = false) {
        controller.start(wait)
    }

    fun healthSnapshot(): HealthResponse {
        return healthProvider.snapshot()
    }

    fun healthSnapshotJson(): String {
        return json.encodeToString(healthSnapshot())
    }

    suspend fun stop() {
        controller.stop()
    }
}
