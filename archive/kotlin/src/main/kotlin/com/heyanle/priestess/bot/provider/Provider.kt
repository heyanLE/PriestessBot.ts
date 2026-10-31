package com.heyanle.priestess.bot.provider

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse

/**
 * 模型提供者元信息，描述能力、展示名称和模型类型。
 */
data class ProviderMetadata(
    val name: String,
    val displayName: String,
    val kind: LLMKind,
    val supportToolCalling: Boolean,
    val supportVision: Boolean,
    val supportStreaming: Boolean,
)

/**
 * 模型提供者注册项，绑定元信息和按配置创建实例的工厂。
 */
data class ProviderRegistration(
    val metadata: ProviderMetadata,
    val factory: (ProviderConfig) -> ChatProvider,
)

/**
 * 大模型提供者类型。
 */
enum class LLMKind {
    OPENAI,       // OpenAI / OpenAI-compatible
    OLLAMA,       // Ollama local models
    ANTHROPIC,    // Anthropic Claude (v2)
    GEMINI,       // Google Gemini (v2)
}

/**
 * 聊天模型提供者接口，提供文本对话和模型列表能力。
 */
interface ChatProvider : Provider {
    suspend fun textChat(request: LLMRequest): LLMResponse
    suspend fun getModels(): List<String>
}

/**
 * 模型提供者基础接口，定义元信息、配置和连通性测试能力。
 */
interface Provider {
    val metadata: ProviderMetadata
    val config: ProviderConfig
    suspend fun test(): Boolean
}

/**
 * 模型提供者注册表，维护内置和插件提供的提供者工厂。
 */
object ProviderRegistry {

    private val registrations = mutableListOf<ProviderRegistration>()

    fun register(metadata: ProviderMetadata, factory: (ProviderConfig) -> ChatProvider) {
        registrations.removeAll { it.metadata.name == metadata.name }
        registrations.add(ProviderRegistration(metadata, factory))
    }

    fun unregister(name: String) {
        registrations.removeAll { it.metadata.name == name }
    }

    fun getMetaList(): List<ProviderMetadata> {
        return registrations.map { it.metadata }
    }

    fun createFromConfig(config: ProviderConfig): ChatProvider? {
        if (!config.enabled) return null
        return registrations.find { it.metadata.name == config.type || it.metadata.name == config.name }
            ?.factory?.invoke(config)
    }

    fun createByType(type: String, config: ProviderConfig): ChatProvider? {
        return registrations.find { it.metadata.name == type }
            ?.factory?.invoke(config)
    }
}
