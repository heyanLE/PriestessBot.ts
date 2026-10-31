package com.heyanle.priestess.bot.core.db

/**
 * 应用数据库生命周期接口，抽象数据库打开和关闭动作。
 */
interface AppDatabase {
    suspend fun open()
    suspend fun close()
}
