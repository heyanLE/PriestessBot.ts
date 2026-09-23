package com.heyanle.priestess.bot.plugin

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.PluginRuntimeDocument
import com.heyanle.priestess.bot.config.model.RuntimeConfigDocument
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.provider.ProviderController
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.config.PlatformConfig
import com.heyanle.priestess.bot.platform.PlatformRegistry
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.testkit.testRuntimeConfiguration
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import javax.tools.ToolProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class PluginControllerTest {
    @Test
    fun `discovers plugin manifest and transitions lifecycle`() {
        val root = Files.createTempDirectory("priestess-plugins")
        val pluginDir = root.resolve("demo")
        Files.createDirectories(pluginDir)
        Files.writeString(
            pluginDir.resolve("plugin.json"),
            Json.encodeToString(
                PluginManifest(
                    id = "demo",
                    name = "Demo",
                    version = "1.2.3",
                    capabilities = listOf("tool"),
                ),
            ),
        )
        val runtime = pluginRuntime(root.toString())
        val manager = PluginController(
            runtimeConfig = runtime.case,
            extensionRegistry = PluginExtensionRegistry(),
            toolCase = ToolCase(ToolController()),
            providerCase = ProviderCase(ProviderController(runtime.case)),
        )

        val discovered = manager.discover().single()
        assertEquals("demo", discovered.manifest.id)
        assertEquals(PluginState.DISCOVERED, discovered.state)
    }

    @Test
    fun `loads enables disables and unloads executable plugin jar`() {
        val root = Files.createTempDirectory("priestess-runtime-plugins")
        val pluginDir = root.resolve("demo")
        Files.createDirectories(pluginDir)
        buildJavaPluginJar(pluginDir.toFile(), "demo.plugin.DemoPlugin")
        Files.writeString(
            pluginDir.resolve("plugin.json"),
            Json.encodeToString(
                PluginManifest(
                    id = "demo",
                    name = "Demo",
                    version = "1.2.3",
                    entrypoint = "demo.plugin.DemoPlugin",
                    capabilities = listOf("tool"),
                ),
            ),
        )
        val registry = PluginExtensionRegistry()
        val toolController = ToolController()
        val (manager, providerController) = pluginManager(root.toString(), registry, toolController)
        manager.discover()

        assertEquals(PluginState.LOADED, manager.load("demo").state)
        assertEquals(PluginState.ENABLED, manager.enable("demo").state)
        assertEquals("demo-tool", registry.list("tool").single().name)
        assertEquals("demo-provider", registry.list("provider").single().name)
        assertEquals("demo-platform", registry.list("platform").single().name)
        assertEquals("Demo tool", toolController.get("demo-tool")?.schema?.description)
        assertEquals("Demo Provider", providerController.getByName("demo-provider")?.metadata?.displayName)
        assertEquals("Demo Platform", PlatformRegistry.getMetaList().single { it.name == "demo-platform" }.displayName)
        assertEquals("demo-platform", PlatformRegistry.createPlatform("demo-platform")?.metadata?.name)
        assertEquals(
            "demo-platform",
            PlatformRegistry.createFromConfig(PlatformConfig(name = "demo-platform", type = "demo-platform"))?.metadata?.name,
        )
        assertEquals(true, runBlocking { providerController.getByName("demo-provider")?.test() })
        assertEquals(
            "plugin response",
            runBlocking { providerController.getByName("demo-provider")?.textChat(LLMRequest()) }?.content,
        )
        val toolResult = runBlocking {
            toolController.get("demo-tool")?.execute(AgentToolContext(), mapOf("name" to "Priestess"))
        }
        assertEquals("hello Priestess", toolResult?.output)

        assertEquals(PluginState.ENABLED, manager.enable("demo").state)
        assertEquals(1, toolController.getAll().count { it.schema.name == "demo-tool" })

        assertEquals(PluginState.DISABLED, manager.disable("demo").state)
        assertTrue(registry.list().isEmpty())
        assertEquals(null, toolController.get("demo-tool"))
        assertEquals(null, providerController.getByName("demo-provider"))
        assertEquals(null, PlatformRegistry.createPlatform("demo-platform"))

        assertEquals(PluginState.ENABLED, manager.enable("demo").state)
        assertEquals("demo-tool", toolController.get("demo-tool")?.schema?.name)
        assertEquals("demo-provider", providerController.getByName("demo-provider")?.metadata?.name)
        assertEquals("demo-platform", PlatformRegistry.createPlatform("demo-platform")?.metadata?.name)

        assertEquals(PluginState.DISCOVERED, manager.unload("demo").state)
        assertTrue(registry.list().isEmpty())
        assertEquals(null, toolController.get("demo-tool"))
        assertEquals(null, providerController.getByName("demo-provider"))
        assertEquals(null, PlatformRegistry.createPlatform("demo-platform"))
    }

    @Test
    fun `load failure marks plugin failed without crashing manager`() {
        val root = Files.createTempDirectory("priestess-failed-plugins")
        val pluginDir = root.resolve("bad")
        Files.createDirectories(pluginDir)
        Files.writeString(
            pluginDir.resolve("plugin.json"),
            Json.encodeToString(
                PluginManifest(
                    id = "bad",
                    name = "Bad",
                    entrypoint = "missing.Plugin",
                ),
            ),
        )
        val toolController = ToolController()
        val (manager, providerController) = pluginManager(root.toString(), PluginExtensionRegistry(), toolController)
        manager.discover()

        val failed = manager.load("bad")

        assertEquals(PluginState.FAILED, failed.state)
        assertNotNull(failed.error)
        assertEquals("bad", manager.list().single().manifest.id)
        assertTrue(toolController.getAll().isEmpty())
        assertTrue(providerController.getAll().isEmpty())
    }

    private fun pluginManager(
        pluginDir: String,
        registry: PluginExtensionRegistry,
        toolController: ToolController,
    ): Pair<PluginController, ProviderController> {
        val runtime = pluginRuntime(pluginDir)
        val providerController = ProviderController(runtime.case)
        return PluginController(
            runtimeConfig = runtime.case,
            extensionRegistry = registry,
            toolCase = ToolCase(toolController),
            providerCase = ProviderCase(providerController),
        ) to providerController
    }

    private fun pluginRuntime(directory: String) = testRuntimeConfiguration(
        AppConfigDocument(runtime = RuntimeConfigDocument(plugins = PluginRuntimeDocument(directory = directory, autoDiscover = false))),
    )

    private fun buildJavaPluginJar(pluginDir: File, className: String) {
        val sourceRoot = pluginDir.resolve("src")
        val classesDir = pluginDir.resolve("classes")
        val packageDir = sourceRoot.resolve("demo/plugin")
        packageDir.mkdirs()
        classesDir.mkdirs()
        val source = packageDir.resolve("DemoPlugin.java")
        source.writeText(
            """
            package demo.plugin;

            import com.heyanle.priestess.bot.plugin.Plugin;
            import com.heyanle.priestess.bot.plugin.PluginContext;
            import com.heyanle.priestess.bot.config.PlatformConfig;
            import com.heyanle.priestess.bot.config.ProviderConfig;
            import com.heyanle.priestess.bot.platform.MessageChain;
            import com.heyanle.priestess.bot.platform.MessageSession;
            import com.heyanle.priestess.bot.platform.Platform;
            import com.heyanle.priestess.bot.platform.PlatformMetadata;
            import com.heyanle.priestess.bot.provider.ChatProvider;
            import com.heyanle.priestess.bot.provider.LLMKind;
            import com.heyanle.priestess.bot.provider.ProviderMetadata;
            import com.heyanle.priestess.bot.tool.AgentToolContext;
            import com.heyanle.priestess.bot.tool.FunctionTool;
            import com.heyanle.priestess.bot.tool.ToolParameters;
            import com.heyanle.priestess.bot.tool.ToolResult;
            import com.heyanle.priestess.bot.tool.ToolSchema;
            import com.heyanle.priestess.bot.provider.model.LLMRequest;
            import com.heyanle.priestess.bot.provider.model.LLMResponse;
            import java.util.Map;
            import java.util.List;
            import kotlinx.coroutines.CompletableJob;
            import kotlinx.coroutines.Job;
            import kotlinx.coroutines.JobKt;

            public class DemoPlugin implements Plugin {
                public static int loadCount = 0;
                public static int enableCount = 0;
                public static int disableCount = 0;
                public static int unloadCount = 0;

                @Override
                public void onLoad(PluginContext context) {
                    loadCount++;
                }

                @Override
                public void onEnable(PluginContext context) {
                    enableCount++;
                    context.registerTool(new DemoTool());
                    context.registerProvider(new DemoProvider());
                    context.registerPlatform(
                        new PlatformMetadata("demo-platform", "Demo Platform", false, true),
                        (PlatformConfig config) -> new DemoPlatform()
                    );
                }

                @Override
                public void onDisable(PluginContext context) {
                    disableCount++;
                }

                @Override
                public void onUnload(PluginContext context) {
                    unloadCount++;
                }

                public static class DemoTool extends FunctionTool {
                    private final ToolSchema schema = new ToolSchema(
                        "demo-tool",
                        "Demo tool",
                        new ToolParameters()
                    );

                    @Override
                    public ToolSchema getSchema() {
                        return schema;
                    }

                    @Override
                    public Object execute(AgentToolContext context, Map<String, String> args, kotlin.coroutines.Continuation<? super ToolResult> continuation) {
                        String name = args.getOrDefault("name", "world");
                        return ToolResult.Companion.success("hello " + name);
                    }
                }

                public static class DemoProvider implements ChatProvider {
                    private final ProviderMetadata metadata = new ProviderMetadata(
                        "demo-provider",
                        "Demo Provider",
                        LLMKind.OPENAI,
                        false,
                        false,
                        false
                    );
                    private final ProviderConfig config = new ProviderConfig(
                        "demo-provider",
                        "demo-provider",
                        "demo-model",
                        "",
                        "",
                        true,
                        new java.util.LinkedHashMap<String, String>(),
                        true
                    );

                    @Override
                    public ProviderMetadata getMetadata() {
                        return metadata;
                    }

                    @Override
                    public ProviderConfig getConfig() {
                        return config;
                    }

                    @Override
                    public Object test(kotlin.coroutines.Continuation<? super Boolean> continuation) {
                        return Boolean.TRUE;
                    }

                    @Override
                    public Object textChat(LLMRequest request, kotlin.coroutines.Continuation<? super LLMResponse> continuation) {
                        return new LLMResponse("plugin response", new java.util.ArrayList<>(), "stop", new com.heyanle.priestess.bot.provider.model.TokenUsage());
                    }

                    @Override
                    public Object getModels(kotlin.coroutines.Continuation<? super List<String>> continuation) {
                        return java.util.Collections.singletonList("demo-model");
                    }
                }

                public static class DemoPlatform extends Platform {
                    private final PlatformMetadata metadata = new PlatformMetadata(
                        "demo-platform",
                        "Demo Platform",
                        false,
                        true
                    );

                    @Override
                    public PlatformMetadata getMetadata() {
                        return metadata;
                    }

                    @Override
                    public Object run(kotlin.coroutines.Continuation<? super Job> continuation) {
                        return JobKt.Job(null);
                    }

                    @Override
                    public Object terminate(kotlin.coroutines.Continuation<? super kotlin.Unit> continuation) {
                        return kotlin.Unit.INSTANCE;
                    }

                    @Override
                    public Object sendMessage(MessageSession session, MessageChain chain, kotlin.coroutines.Continuation<? super String> continuation) {
                        return "demo-message";
                    }
                }
            }
            """.trimIndent(),
        )
        val compiler = ToolProvider.getSystemJavaCompiler()
        assertNotNull(compiler, "Tests require a JDK with javac")
        val classpath = System.getProperty("java.class.path")
        val compileExit = compiler.run(
            null,
            null,
            null,
            "-classpath",
            classpath,
            "-d",
            classesDir.absolutePath,
            source.absolutePath,
        )
        assertEquals(0, compileExit)
        val jar = pluginDir.resolve("demo-plugin.jar")
        val jarExit = ProcessBuilder(
            "jar",
            "--create",
            "--file",
            jar.absolutePath,
            "-C",
            classesDir.absolutePath,
            ".",
        ).inheritIO().start().waitFor()
        assertEquals(0, jarExit)
        assertTrue(jar.exists(), "Expected plugin jar for $className")
    }
}
