package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.DatabaseRuntimeDocument
import com.heyanle.priestess.bot.config.model.DesiredConfig
import com.heyanle.priestess.bot.config.model.EffectiveConfigVersion
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeView
import com.heyanle.priestess.bot.config.model.EffectiveWorkspaceSnapshot
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.ServerRuntimeDocument
import com.heyanle.priestess.bot.config.model.SourceFingerprint
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class EffectiveConfigStoreTest {
    @Test
    fun `store publishes monotonically versioned complete snapshots`() {
        val store = EffectiveConfigStore(nowProvider = { 123L })

        val first = store.publish(desired("one", 1001, "/one"))
        val second = store.publish(desired("two", 1002, "/two"))

        assertEquals(1, first.version.value)
        assertEquals(2, second.version.value)
        assertEquals(123L, second.loadedAtEpochMillis)
        assertEquals(1002, store.requireCurrent().runtime.server.port)
        assertEquals("/two", store.requireCurrent().runtime.pipeline.wakingPrefix)
    }

    @Test
    fun `retired snapshot resources close only after the final lease releases`() {
        val closed = AtomicInteger(0)
        val store = EffectiveConfigStore()
        store.publish(desired("one", 1001, "/one", AutoCloseable { closed.incrementAndGet() }))
        val lease = store.acquire()

        store.publish(desired("two", 1002, "/two"))

        assertEquals(0, closed.get())
        assertEquals("one", lease.snapshot.desiredRevision.value)
        lease.close()
        lease.close()
        assertEquals(1, closed.get())
    }

    @Test
    fun `concurrent readers observe only complete generations`() {
        val store = EffectiveConfigStore()
        store.publish(desired("one", 1001, "/one"))
        val executor = Executors.newFixedThreadPool(8)
        val failures = AtomicInteger(0)
        val futures = (1..200).map { index ->
            executor.submit {
                if (index == 100) store.publish(desired("two", 1002, "/two"))
                val snapshot = store.requireCurrent()
                val consistent = (snapshot.runtime.server.port == 1001 && snapshot.runtime.pipeline.wakingPrefix == "/one") ||
                    (snapshot.runtime.server.port == 1002 && snapshot.runtime.pipeline.wakingPrefix == "/two")
                if (!consistent) failures.incrementAndGet()
            }
        }
        futures.forEach { it.get(5, TimeUnit.SECONDS) }
        executor.shutdown()

        assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
        assertEquals(0, failures.get())
    }

    @Test
    fun `activation keeps restart fields active while publishing live fields`() {
        val store = EffectiveConfigStore()
        val coordinator = ConfigActivationCoordinator(store)
        coordinator.activate(desired("one", 1001, "/one"))

        val result = coordinator.activate(desired("two", 2002, "/two"))

        val active = store.requireCurrent()
        assertEquals(1001, active.runtime.server.port)
        assertEquals("/two", active.runtime.pipeline.wakingPrefix)
        assertEquals("two", result.desiredRevision.value)
        assertEquals(listOf("runtime.server"), result.pendingRestart.map { it.path })
        assertEquals(result.pendingRestart, active.pendingRestart)
        assertEquals(2, coordinator.state().activeVersion)
    }

    @Test
    fun `diff classifier conservatively separates restart and live paths`() {
        val store = EffectiveConfigStore()
        val initial = store.publish(desired("one", 1001, "/one"))
        val plan = ConfigurationDiffClassifier().classify(initial, desired("two", 2002, "/two"))

        assertTrue("runtime.server" in plan.restartRequiredPaths)
        assertTrue("runtime.pipeline" in plan.livePaths)
        assertFalse(plan.rejectedPaths.isNotEmpty())
    }

    @Test
    fun `platform directory relocation retains the entire active resource graph until restart`() {
        val store = EffectiveConfigStore()
        val coordinator = ConfigActivationCoordinator(store)
        val activeClosed = AtomicInteger()
        val discardedClosed = AtomicInteger()
        val oldApp = com.heyanle.priestess.bot.config.model.ApplicationConfigurationDocument(
            platformDirectory = "/old/platform",
            skillLibraries = listOf(com.heyanle.priestess.bot.config.model.SkillLibraryDocument("common", directory = "/old/platform/skills/common")),
        )
        coordinator.activate(desired("one", 8080, "#", AutoCloseable { activeClosed.incrementAndGet() }).copy(application = oldApp))
        val lease = store.acquire()
        val newApp = oldApp.copy(platformDirectory = "/new/platform", skillLibraries = listOf(
            com.heyanle.priestess.bot.config.model.SkillLibraryDocument("common", directory = "/new/platform/skills/common"),
        ))
        val result = coordinator.activate(desired("two", 8080, "!", AutoCloseable { discardedClosed.incrementAndGet() }).copy(application = newApp))
        assertTrue(result.success)
        assertEquals(oldApp, store.requireCurrent().application)
        assertEquals("#", store.requireCurrent().runtime.pipeline.wakingPrefix)
        assertEquals(lease.snapshot.version, store.requireCurrent().version)
        assertTrue(store.requireCurrent().pendingRestart.any { it.path == "platformDirectory" })
        assertEquals(0, activeClosed.get())
        assertEquals(1, discardedClosed.get())
        lease.close()
        assertEquals(0, activeClosed.get())
        store.close()
        assertEquals(1, activeClosed.get())
    }

    private fun desired(
        revision: String,
        serverPort: Int,
        wakingPrefix: String,
        handle: AutoCloseable? = null,
    ): DesiredConfig {
        val document = AppConfigDocument()
        val runtime = EffectiveRuntimeView(
            server = ServerRuntimeDocument(port = serverPort),
            database = DatabaseRuntimeDocument(),
            plugins = document.runtime.plugins,
            reload = document.runtime.reload,
            pipeline = document.runtime.pipeline.copy(wakingPrefix = wakingPrefix),
            command = document.runtime.command,
            permission = document.runtime.permission,
        )
        val workspaces = if (handle == null) emptyMap() else mapOf(
            "default" to EffectiveWorkspaceSnapshot(
                version = EffectiveConfigVersion(0),
                fingerprint = SourceFingerprint("workspace-$revision"),
                sourcePath = "/workspace/config.yaml",
                config = WorkspaceConfigDocument(
                    id = "default",
                    name = "Default",
                    primaryAgentId = "agent",
                    agents = emptyList(),
                ),
                agents = emptyMap(),
                availableToolIds = emptySet(),
                resourceHandles = listOf(handle),
            ),
        )
        return DesiredConfig(
            document = document,
            rawRevision = RawConfigRevision(revision),
            sourceFingerprint = SourceFingerprint("fingerprint-$revision"),
            runtime = runtime,
            platforms = emptyMap(),
            providers = emptyMap(),
            workspaces = workspaces,
            provenance = emptyMap(),
        )
    }
}
