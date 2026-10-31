package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.config.PlatformConfig
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermission
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class WeixinCredentialStoreTest {
    @Test
    fun `QR credentials persist atomically with owner-only permissions when supported`() {
        val directory = Files.createTempDirectory("weixin-credentials")
        val store = WeixinCredentialStore(directory)
        val credentials = WeixinCredentials(
            accountId = "account-a",
            token = "secret-token",
            baseUrl = WeixinConfig.DEFAULT_BASE_URL,
            userId = "user-a",
        )

        store.save(credentials)

        assertEquals(credentials, store.load())
        assertFalse(Files.list(directory).use { paths -> paths.anyMatch { ".tmp-" in it.fileName.toString() } })
        runCatching { Files.getPosixFilePermissions(store.path()) }.getOrNull()?.let { permissions ->
            assertEquals(
                setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE),
                permissions,
            )
        }
    }

    @Test
    fun `saved QR credentials fill missing config while explicit values win`() {
        val directory = Files.createTempDirectory("weixin-credential-resolution")
        WeixinCredentialStore(directory).save(
            WeixinCredentials("saved-account", "saved-token", WeixinConfig.DEFAULT_BASE_URL),
        )

        val resolved = PlatformConfig(
            name = "weixin-main",
            type = "weixin",
            config = mapOf("stateDirectory" to directory.toString()),
        ).toWeixinConfig()
        val overridden = PlatformConfig(
            name = "weixin-main",
            type = "weixin",
            token = "configured-token",
            baseUrl = "https://configured.example",
            config = mapOf("stateDirectory" to directory.toString(), "accountId" to "configured-account"),
        ).toWeixinConfig()

        assertEquals("saved-token", resolved.token)
        assertEquals("saved-account", resolved.accountId)
        assertEquals("configured-token", overridden.token)
        assertEquals("configured-account", overridden.accountId)
        assertEquals("https://configured.example", overridden.baseUrl)
    }
}
