package com.heyanle.priestess.bot.core.db

/**
 * 数据库模块门面，向其他模块提供事务执行和生命周期停止能力。
 */
class DatabaseCase(
    private val controller: DatabaseController,
) {
    fun <T> execute(block: () -> T): T = controller.execute(block)
    suspend fun stop() {
        controller.stop()
    }
}
