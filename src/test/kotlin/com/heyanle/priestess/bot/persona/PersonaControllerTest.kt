package com.heyanle.priestess.bot.persona

import com.heyanle.priestess.bot.testkit.testPersonaCase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PersonaControllerTest {
    @Test
    fun `upsert normalizes fields and lists active personas by workspace`() {
        val personas = testPersonaCase("persona-list")

        val created = personas.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-a",
                name = "  concise kotlin helper  ",
                description = "  Answers with Kotlin examples  ",
                tone = "  concise  ",
                boundaries = listOf(" no secrets ", "", "no secrets", "cite uncertainty"),
                systemPromptTemplate = "  Prefer short answers.  ",
                exampleDialogs = listOf(
                    PersonaExampleDialog(
                        user = "  The task failed.  ",
                        assistant = "  Keep the logs; I will inspect the failed step.  ",
                    ),
                ),
                agentNames = listOf(" assistant ", "", "assistant", "reviewer"),
                errorMessages = PersonaErrorMessages(permissionDenied = " denied "),
            ),
        )
        personas.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-b",
                name = "other workspace persona",
            ),
        )

        val listed = personas.list("workspace-a")
        val loaded = assertNotNull(personas.get(created.id))

        assertEquals(listOf(created.id), listed.map { it.id })
        assertEquals("concise kotlin helper", loaded.name)
        assertEquals("Answers with Kotlin examples", loaded.description)
        assertEquals("concise", loaded.tone)
        assertEquals(listOf("no secrets", "cite uncertainty"), loaded.boundaries)
        assertEquals("Prefer short answers.", loaded.systemPromptTemplate)
        assertEquals(
            listOf(PersonaExampleDialog("The task failed.", "Keep the logs; I will inspect the failed step.")),
            loaded.exampleDialogs,
        )
        assertEquals(listOf("assistant", "reviewer"), loaded.agentNames)
        assertEquals("denied", loaded.errorMessages.permissionDenied)
        assertTrue(loaded.enabled)
    }

    @Test
    fun `upsert with existing id preserves createdAt and clears soft deletion`() {
        val personas = testPersonaCase("persona-upsert")
        val created = personas.upsert(
            PersonaUpsertRequest(
                id = "persona-a",
                workspaceId = "workspace-a",
                name = "first",
            ),
        )

        assertTrue(personas.delete(created.id))
        assertNull(personas.get(created.id))

        val updated = personas.upsert(
            PersonaUpsertRequest(
                id = "persona-a",
                workspaceId = "workspace-a",
                name = "second",
                enabled = false,
            ),
        )

        assertEquals(created.createdAt, updated.createdAt)
        assertEquals("second", updated.name)
        assertFalse(updated.enabled)
        assertNull(updated.deletedAt)
        assertEquals(updated.id, personas.get("persona-a")?.id)
    }

    @Test
    fun `resolve prefers agent-specific enabled persona over generic persona`() {
        val personas = testPersonaCase("persona-resolve")
        val generic = personas.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-a",
                name = "generic",
            ),
        )
        val specific = personas.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-a",
                name = "assistant-specific",
                agentNames = listOf("assistant"),
            ),
        )

        assertEquals(specific.id, personas.resolve("workspace-a", "assistant")?.id)
        assertEquals(generic.id, personas.resolve("workspace-a", "reviewer")?.id)
        assertNull(personas.resolve("workspace-b", "assistant"))
    }

    @Test
    fun `resolve ignores disabled and deleted personas`() {
        val personas = testPersonaCase("persona-disabled")
        val disabled = personas.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-a",
                name = "disabled",
                enabled = false,
                agentNames = listOf("assistant"),
            ),
        )
        val deleted = personas.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-a",
                name = "deleted",
                agentNames = listOf("assistant"),
            ),
        )

        assertTrue(personas.delete(deleted.id))

        assertNull(personas.resolve("workspace-a", "assistant"))
        assertEquals(listOf(disabled.id), personas.list("workspace-a").map { it.id })
    }

    @Test
    fun `delete is idempotent and hides persona from reads`() {
        val personas = testPersonaCase("persona-delete")
        val created = personas.upsert(
            PersonaUpsertRequest(
                workspaceId = "workspace-a",
                name = "temporary",
            ),
        )

        assertTrue(personas.delete(created.id))
        assertFalse(personas.delete(created.id))
        assertNull(personas.get(created.id))
        assertTrue(personas.list("workspace-a").isEmpty())
    }

    @Test
    fun `upsert rejects incomplete or excessive example dialogs`() {
        val personas = testPersonaCase("persona-examples-validation")

        assertFailsWith<IllegalArgumentException> {
            personas.upsert(
                PersonaUpsertRequest(
                    workspaceId = "workspace-a",
                    name = "invalid",
                    exampleDialogs = listOf(PersonaExampleDialog(user = "hello", assistant = " ")),
                ),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            personas.upsert(
                PersonaUpsertRequest(
                    workspaceId = "workspace-a",
                    name = "too-many",
                    exampleDialogs = List(21) { PersonaExampleDialog("user-$it", "assistant-$it") },
                ),
            )
        }
    }
}
