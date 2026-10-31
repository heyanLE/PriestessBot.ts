package com.heyanle.priestess.bot.testkit

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase

data class TestRuntimeConfiguration(
    val store: EffectiveConfigStore,
    val case: RuntimeConfigurationCase,
) {
    fun publish(
        document: AppConfigDocument,
        workspaces: Map<String, EffectiveWorkspaceSnapshot> = emptyMap(),
        providers: Map<String, EffectiveProviderConnection> = document.providers.associate { source ->
            source.id to EffectiveProviderConnection(source.id, source.type, source.enabled, source.endpoint, null, source.credentialRef, source.settings)
        },
        platforms: Map<String, EffectivePlatformConnection> = document.platforms.associate { source ->
            source.id to EffectivePlatformConnection(source.id, source.type, source.enabled, source.defaultWorkspaceId, emptyMap(), source.settings)
        },
    ) {
        store.publish(
            DesiredConfig(
                document = document,
                rawRevision = RawConfigRevision("test-${System.nanoTime()}"),
                sourceFingerprint = SourceFingerprint("test-${System.nanoTime()}"),
                runtime = EffectiveRuntimeView(
                    document.runtime.server,
                    document.runtime.database,
                    document.runtime.plugins,
                    document.runtime.reload,
                    document.runtime.pipeline,
                    document.runtime.command,
                    document.runtime.permission,
                ),
                platforms = platforms,
                providers = providers,
                workspaces = workspaces,
                provenance = emptyMap(),
            ),
        )
    }
}

fun testRuntimeConfiguration(document: AppConfigDocument = AppConfigDocument()): TestRuntimeConfiguration {
    val store = EffectiveConfigStore()
    val configuration = TestRuntimeConfiguration(store, RuntimeConfigurationCase(store) {})
    configuration.publish(document)
    return configuration
}
