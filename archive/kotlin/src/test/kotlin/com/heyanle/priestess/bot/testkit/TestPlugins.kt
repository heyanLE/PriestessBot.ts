package com.heyanle.priestess.bot.testkit

import java.io.File
import javax.tools.ToolProvider
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

fun buildDemoPluginJar(pluginDir: File) {
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
        import kotlinx.coroutines.Job;
        import kotlinx.coroutines.JobKt;

        public class DemoPlugin implements Plugin {
            @Override
            public void onEnable(PluginContext context) {
                context.registerTool(new DemoTool());
                context.registerProvider(new DemoProvider());
                context.registerPlatform(
                    new PlatformMetadata("demo-platform", "Demo Platform", false, true),
                    (PlatformConfig config) -> new DemoPlatform()
                );
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
                    new java.util.LinkedHashMap<String, String>()
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
                public Object sendMessage(MessageSession session, MessageChain chain, kotlin.coroutines.Continuation<? super kotlin.Unit> continuation) {
                    return kotlin.Unit.INSTANCE;
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
    assertTrue(jar.exists(), "Expected plugin jar")
}
