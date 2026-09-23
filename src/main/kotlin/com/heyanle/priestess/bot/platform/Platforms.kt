package com.heyanle.priestess.bot.platform

import com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatConfig
import com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatPlatform
import com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatPlatformTools
import com.heyanle.priestess.bot.platform.adapters.telegram.TelegramConfig
import com.heyanle.priestess.bot.platform.adapters.telegram.TelegramPlatform
import com.heyanle.priestess.bot.platform.adapters.weixin.WeixinConfig
import com.heyanle.priestess.bot.platform.adapters.weixin.WeixinPlatform
import com.heyanle.priestess.bot.platform.adapters.weixin.toWeixinConfig

fun registerBuiltinPlatforms() {
    PlatformRegistry.registerMeta(
        metadata = PlatformMetadata(
            name = "telegram",
            displayName = "Telegram",
            supportStreaming = true,
            supportProactiveMessage = true,
        ),
        factory = { cfg ->
            TelegramPlatform(
                config = TelegramConfig(
                    token = cfg?.token ?: "",
                    name = cfg?.name ?: "telegram",
                    displayName = "Telegram",
                    proxyUrl = cfg?.config?.get("proxyUrl")?.takeIf { it.isNotBlank() },
                )
            )
        }
    )

    PlatformRegistry.registerMeta(
        metadata = PlatformMetadata(
            name = "napcat4_18_6",
            displayName = "NapCat v4.18.6 (QQ)",
            supportStreaming = false,
            supportProactiveMessage = false,
            supportReply = true,
        ),
        toolFactory = NapCatPlatformTools::all,
        factory = { cfg ->
            NapCatPlatform(
                config = NapCatConfig(
                    host = cfg?.host ?: "127.0.0.1",
                    port = cfg?.port ?: 3000,
                    wsPort = cfg?.wsPort ?: 3001,
                    token = cfg?.token ?: "",
                    useWs = cfg?.useWs ?: true,
                    name = cfg?.name ?: "napcat4_18_6",
                    displayName = "NapCat v4.18.6 (QQ)",
                )
            )
        }
    )

    PlatformRegistry.registerMeta(
        metadata = PlatformMetadata(
            name = "weixin",
            displayName = "WeChat (iLink)",
            supportStreaming = false,
            supportProactiveMessage = false,
        ),
        factory = { cfg ->
            WeixinPlatform(config = (cfg ?: com.heyanle.priestess.bot.config.PlatformConfig()).toWeixinConfig())
        },
    )
}
