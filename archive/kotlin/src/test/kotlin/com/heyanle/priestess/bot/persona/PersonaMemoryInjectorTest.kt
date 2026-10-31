package com.heyanle.priestess.bot.persona

import com.heyanle.priestess.bot.memory.MemoryController
import com.heyanle.priestess.bot.memory.MemoryCase
import com.heyanle.priestess.bot.memory.MemoryScope
import com.heyanle.priestess.bot.memory.MemoryScopeContext
import com.heyanle.priestess.bot.memory.MemoryType
import com.heyanle.priestess.bot.testkit.testPersonaMemoryControllers
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PersonaMemoryInjectorTest {
    @Test
    fun `renders persona and bounded matching memory into instructions with trace metadata`() {
        val (personaController, memoryController) = testPersonaMemoryControllers("injector-render")
        val injector = PersonaMemoryInjector(
            personaCase = PersonaCase(personaController),
            memoryCase = MemoryCase(memoryController),
            maxMemorySnippetChars = 40,
        )
        val persona = personaController.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-a",
                name = "Concise Helper",
                description = "Helps with Kotlin",
                tone = "concise",
                boundaries = listOf("Do not invent APIs"),
                systemPromptTemplate = "Prefer precise Kotlin examples.",
                exampleDialogs = listOf(
                    PersonaExampleDialog(
                        user = "Show a coroutine example",
                        assistant = "Here is a concise coroutine example with a test.",
                    ),
                ),
                agentNames = listOf("assistant"),
            ),
        )
        val scope = MemoryScopeContext(
            workspaceId = "workspace-a",
            sessionId = "session-1",
            userId = "user-1",
            agentName = "assistant",
        )
        val memory = memoryController.save(
            content = "User prefers concise Kotlin coroutine examples with tests",
            type = MemoryType.PREFERENCE,
            scope = MemoryScope.SESSION,
            scopeContext = scope,
            tags = listOf("kotlin"),
            confidence = 0.8,
        )
        memoryController.save(
            content = "Other session should stay hidden",
            type = MemoryType.PREFERENCE,
            scope = MemoryScope.SESSION,
            scopeContext = scope.copy(sessionId = "session-2"),
            tags = listOf("kotlin"),
        )

        val injection = injector.inject(
            baseInstructions = "Base instructions",
            context = PersonaMemoryInjectionContext(
                workspaceId = "workspace-a",
                agentName = "assistant",
                sessionId = "session-1",
                userId = "user-1",
                message = "Need Kotlin coroutine tests",
                maxMemories = 1,
            ),
        )

        assertTrue(injection.hasContent)
        assertContains(injection.instructions, "Base instructions")
        assertContains(injection.instructions, "Persona And Memory Context")
        assertContains(injection.instructions, "Concise Helper")
        assertContains(injection.instructions, "Prefer precise Kotlin examples.")
        assertContains(injection.instructions, "Do not invent APIs")
        assertContains(injection.instructions, memory.id)
        assertFalse(injection.instructions.contains("Other session should stay hidden"))
        assertEquals(persona.id, injection.metadata["injected_persona_id"])
        assertEquals(persona.name, injection.metadata["injected_persona_name"])
        assertEquals(persona.exampleDialogs, injection.exampleDialogs)
        assertEquals("1", injection.metadata["injected_example_dialog_count"])
        assertEquals(memory.id, injection.metadata["injected_memory_ids"])
        assertContains(injection.metadata.getValue("injected_memory_reasons"), "content term")
    }

    @Test
    fun `keeps base instructions when no persona or memory matches`() {
        val (personaController, memoryController) = testPersonaMemoryControllers("injector-empty")
        val injector = PersonaMemoryInjector(PersonaCase(personaController), MemoryCase(memoryController))

        val injection = injector.inject(
            baseInstructions = "Base instructions",
            context = PersonaMemoryInjectionContext(
                workspaceId = "workspace-a",
                agentName = "assistant",
                message = "anything",
                maxMemories = 3,
            ),
        )

        assertFalse(injection.hasContent)
        assertEquals("Base instructions", injection.instructions)
        assertEquals("0", injection.metadata["injected_memory_count"])
    }
}
