package com.heyanle.priestess.bot.message

import com.heyanle.priestess.bot.platform.MessageComponent
import java.awt.Font
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.util.Base64
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class MarkdownMessageFormatterTest {
    @Test
    fun `formatting markers disappear while literal underscores and links survive`() {
        val input = "# 标题\n\n**加粗** *斜体* __强调__ _倾斜_ ~~删除~~ <u>下划线</u>\n\nuser_name `a_b * 2` [文档](https://example.com/a_b)"
        val result = MarkdownMessageFormatter().format(input).textContent
        assertEquals("标题\n\n加粗 斜体 强调 倾斜 删除 下划线\n\nuser_name a_b * 2 文档 (https://example.com/a_b)", result)
    }

    @Test
    fun `nested quotes flatten and bullets normalize while exact ordered markers survive`() {
        val input = "> 引用\n>\n> > 二级引用\n\n* 苹果\n* 香蕉\n  * 子项\n\n3. 三\n9. 九\n\n5) 五\n8) 八"
        val result = MarkdownMessageFormatter().format(input).textContent
        assertTrue("> 引用" in result)
        assertTrue("> 二级引用" in result)
        assertFalse(">>" in result)
        assertTrue("- 苹果\n- 香蕉\n  - 子项" in result)
        assertTrue("3. 三\n9. 九" in result)
        assertTrue("5) 五\n8) 八" in result)
    }

    @Test
    fun `code and tables become images in source order with exact code contents`() {
        val rendered = mutableListOf<MarkdownVisualBlock>()
        val formatter = MarkdownMessageFormatter { block ->
            rendered += block
            listOf(MessageComponent.Image("base64://image${rendered.size}"))
        }
        val input = "前言\n\n```kotlin\nval a_b = \"**原样**\"\n```\n\n中间\n\n| 名称 | 数值 |\n| --- | --- |\n| **苹果** | 2 |\n\n后记"
        val chain = formatter.format(input)
        assertEquals(5, chain.components.size)
        assertEquals("前言\n\n", assertIs<MessageComponent.Text>(chain.components[0]).text)
        assertIs<MessageComponent.Image>(chain.components[1])
        assertEquals("中间\n\n", assertIs<MessageComponent.Text>(chain.components[2]).text)
        assertIs<MessageComponent.Image>(chain.components[3])
        assertEquals("后记", assertIs<MessageComponent.Text>(chain.components[4]).text)
        assertEquals("val a_b = \"**原样**\"\n", assertIs<MarkdownVisualBlock.Code>(rendered[0]).source)
        assertEquals(listOf(listOf("名称", "数值"), listOf("苹果", "2")), assertIs<MarkdownVisualBlock.Table>(rendered[1]).rows)
    }

    @Test
    fun `renderer failure retains readable tables and unmodified source code`() {
        val formatter = MarkdownMessageFormatter { error("font unavailable") }
        val chain = formatter.format("```\n_a_ **b** <u>x</u>\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |")
        assertTrue("_a_ **b** <u>x</u>" in chain.textContent)
        assertTrue("A | B\n1 | 2" in chain.textContent)
        assertTrue(chain.components.all { it is MessageComponent.Text })
    }

    @Test
    fun `minimal JRE font linkage failure falls back to text`() {
        val formatter = MarkdownMessageFormatter { throw UnsatisfiedLinkError("fontmanager") }
        assertEquals("hello", formatter.format("```\nhello\n```").textContent)
    }

    @Test
    fun `empty render result falls back without losing content`() {
        val formatter = MarkdownMessageFormatter { emptyList() }
        assertEquals("hello", formatter.format("```\nhello\n```").textContent)
    }

    @Test
    fun `long code paginates into decodable bounded PNG images`() {
        val renderer = PngMarkdownBlockRenderer(width = 400, maxHeight = 300)
        val images = renderer.render(MarkdownVisualBlock.Code((1..20).joinToString("\n") { "第 $it 行 a_b **code**" }, "kotlin"))
        assertTrue(images.size > 1)
        images.forEach { component ->
            val png = Base64.getDecoder().decode(component.url.removePrefix("base64://"))
            val image = ImageIO.read(ByteArrayInputStream(png))
            assertEquals(400, image.width)
            assertTrue(image.height <= 300)
        }
    }

    @Test
    fun `large table splits both columns and tall cells into bounded PNGs`() {
        val renderer = PngMarkdownBlockRenderer(width = 400, maxHeight = 300)
        val images = renderer.render(MarkdownVisualBlock.Table(listOf(
            listOf("A", "B", "C", "D"),
            listOf("first ".repeat(35), "second", "third", "last"),
        )))
        assertTrue(images.size >= 3)
        images.forEach {
            val image = ImageIO.read(ByteArrayInputStream(Base64.getDecoder().decode(it.url.removePrefix("base64://"))))
            assertTrue(image.height <= 300)
            assertEquals(400, image.width)
        }
    }

    @Test
    fun `image budget fallback retains complete oversized block`() {
        val source = (1..100).joinToString("\n") { "line_$it" }
        val formatter = MarkdownMessageFormatter(PngMarkdownBlockRenderer(maxHeight = 200, maxPages = 1))
        val result = formatter.format("```\n$source\n```")
        assertEquals(source, result.textContent)
    }

    @Test
    fun `wrapping preserves supplementary characters and whitespace`() {
        val image = BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB)
        val graphics = image.createGraphics()
        try {
            graphics.font = Font(Font.MONOSPACED, Font.PLAIN, 22)
            val value = " a😀b  𠮷c  "
            val lines = PngMarkdownBlockRenderer().wrap(value, 35, graphics.fontMetrics)
            assertEquals(value, lines.joinToString(""))
            assertTrue(lines.all { line -> line.codePoints().noneMatch { it in 0xD800..0xDFFF } })
        } finally {
            graphics.dispose()
        }
    }
}
