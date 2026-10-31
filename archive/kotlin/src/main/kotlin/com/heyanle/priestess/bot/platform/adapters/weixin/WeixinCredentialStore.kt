package com.heyanle.priestess.bot.platform.adapters.weixin

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission
import java.time.Instant
import java.util.UUID

@Serializable
internal data class WeixinCredentials(
    val accountId: String,
    val token: String,
    val baseUrl: String = WeixinConfig.DEFAULT_BASE_URL,
    val userId: String = "",
    val savedAt: String = Instant.now().toString(),
)

internal class WeixinCredentialStore(
    directory: Path,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    private val directory = directory.toAbsolutePath().normalize()
    private val credentialFile = this.directory.resolve("credentials.json")

    fun load(): WeixinCredentials? {
        if (!Files.isRegularFile(credentialFile)) return null
        return try {
            json.decodeFromString<WeixinCredentials>(Files.readString(credentialFile))
        } catch (error: Exception) {
            throw IllegalStateException("Weixin credential file is unreadable: $credentialFile", error)
        }
    }

    fun save(credentials: WeixinCredentials) {
        require(credentials.accountId.isNotBlank()) { "Weixin account ID must not be blank" }
        require(credentials.token.isNotBlank()) { "Weixin bot token must not be blank" }
        WeixinQrOriginPolicy.validateConfirmedBaseUrl(credentials.baseUrl)
        Files.createDirectories(directory)
        val temporary = directory.resolve("credentials.json.tmp-${UUID.randomUUID()}")
        try {
            Files.writeString(temporary, json.encodeToString(credentials))
            setOwnerOnlyPermissions(temporary)
            try {
                Files.move(
                    temporary,
                    credentialFile,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary, credentialFile, StandardCopyOption.REPLACE_EXISTING)
            }
            setOwnerOnlyPermissions(credentialFile)
        } finally {
            Files.deleteIfExists(temporary)
        }
    }

    internal fun path(): Path = credentialFile

    private fun setOwnerOnlyPermissions(path: Path) {
        runCatching {
            Files.setPosixFilePermissions(
                path,
                setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE),
            )
        }
    }
}
