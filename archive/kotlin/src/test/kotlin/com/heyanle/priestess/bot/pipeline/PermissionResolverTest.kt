package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.config.CommandConfig
import com.heyanle.priestess.bot.config.PermissionConfig
import kotlin.test.Test
import kotlin.test.assertEquals

class PermissionResolverTest {
    @Test
    fun `command and permission configuration retain compatible defaults`() {
        assertEquals("/", CommandConfig().prefix)
        assertEquals(emptyList(), PermissionConfig().adminIds)
        assertEquals(emptyList(), PermissionConfig().superAdminIds)
    }

    @Test
    fun `super administrator wins and unconfigured sender is operator`() {
        val resolver = PermissionResolver {
            PermissionConfig(superAdminIds = listOf(" super "), adminIds = listOf("super", "admin"))
        }

        assertEquals(PermissionGroup.SUPER_ADMIN, resolver.resolve("super"))
        assertEquals(PermissionGroup.ADMIN, resolver.resolve(" admin "))
        assertEquals(PermissionGroup.OPERATOR, resolver.resolve("operator"))
    }
}
