package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.WireProtocol
import java.nio.file.Path
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** Builds the native engine's in-memory custom Responses provider, without calling Codex login. */
internal object CodexProviderBootstrap {
    const val PROVIDER_ID = "priestess"

    fun engineOptions(codexHome: Path, provider: EffectiveProviderConnection): String {
        require(provider.enabled) { "Codex requires an enabled provider" }
        require(provider.protocol == WireProtocol.OPENAI_RESPONSES) { "Codex requires OPENAI_RESPONSES" }
        val token = provider.credential?.reveal()?.takeIf(String::isNotBlank)
            ?: error("Codex provider credential is unavailable")
        val endpoint = provider.endpoint.trim().trimEnd('/')
            .removeSuffix("/responses")
            .removeSuffix("/chat/completions")
        require(endpoint.startsWith("https://") || endpoint.startsWith("http://")) {
            "Codex provider endpoint must be an HTTP URL"
        }
        return buildJsonObject {
            put("codex_home", codexHome.toAbsolutePath().normalize().toString())
            putJsonObject("config") {
                put("web_search", "disabled")
                putJsonObject("model_providers.$PROVIDER_ID") {
                    put("name", PROVIDER_ID)
                    put("base_url", endpoint)
                    put("wire_api", "responses")
                    put("requires_openai_auth", false)
                    put("experimental_bearer_token", token)
                }
            }
        }.toString()
    }

    fun threadParams(workspace: Path, model: String, instructions: String): String {
        require(model.isNotBlank()) { "Codex model is required" }
        return buildJsonObject {
            put("cwd", workspace.toAbsolutePath().normalize().toString())
            put("model", model)
            put("model_provider", PROVIDER_ID)
            put("developer_instructions", instructions)
            put("no_environment", true)
        }.toString()
    }
}
