package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.core.controller.BaseController

/**
 * 服务端模块控制器，负责承接 HTTP 服务生命周期。
 */
class ServerController(
    private val server: PriestessBotServer,
) : BaseController("ServerController") {

    fun start(wait: Boolean = false) {
        server.start(wait)
    }

    override suspend fun stop() {
        server.stop()
        super.stop()
    }
}
