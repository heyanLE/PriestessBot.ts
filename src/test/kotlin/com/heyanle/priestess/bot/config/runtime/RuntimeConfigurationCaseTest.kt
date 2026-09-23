package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.model.*
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals

class RuntimeConfigurationCaseTest {
    @Test
    fun `runtime consumers require one activated v2 snapshot and startup is checked once`() {
        val store = EffectiveConfigStore()
        val starts = AtomicInteger()
        val runtime = RuntimeConfigurationCase(store) {
            starts.incrementAndGet()
            val document = AppConfigDocument()
            store.publish(
                DesiredConfig(
                    document = document,
                    rawRevision = RawConfigRevision("v2"),
                    sourceFingerprint = SourceFingerprint("v2-fingerprint"),
                    runtime = EffectiveRuntimeView(
                        document.runtime.server,
                        DatabaseRuntimeDocument("effective.db"),
                        document.runtime.plugins,
                        document.runtime.reload,
                        document.runtime.pipeline,
                        document.runtime.command,
                        document.runtime.permission,
                    ),
                    platforms = emptyMap(),
                    providers = emptyMap(),
                    workspaces = emptyMap(),
                    provenance = emptyMap(),
                ),
            )
        }

        assertEquals("effective.db", runtime.current().databaseConfig().path)
        runtime.current()
        assertEquals(1, starts.get())
    }
}
