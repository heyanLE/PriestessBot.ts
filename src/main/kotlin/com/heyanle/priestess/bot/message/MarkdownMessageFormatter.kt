package com.heyanle.priestess.bot.message

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageComponent
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableRow
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.*
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

/** Converts Markdown into ordered, transport-independent text and image components. */
class MarkdownMessageFormatter(
    private val renderer: MarkdownBlockRenderer = PngMarkdownBlockRenderer(),
) {
    private val parser = Parser.builder()
        .extensions(listOf(TablesExtension.create(), StrikethroughExtension.create()))
        .includeSourceSpans(IncludeSourceSpans.BLOCKS)
        .build()

    fun format(markdown: String): MessageChain {
        if (markdown.isEmpty()) return MessageChain()
        val writer = Writer(markdown.lines())
        writer.blocks(parser.parse(markdown))
        return writer.finish()
    }

    private inner class Writer(private val sourceLines: List<String>) {
        private val components = mutableListOf<MessageComponent>()
        private val text = StringBuilder()

        fun blocks(parent: Node, indent: String = "", quoted: Boolean = false) {
            children(parent).forEach { block(it, indent, quoted) }
        }

        private fun block(node: Node, indent: String, quoted: Boolean) {
            val prefix = (if (quoted) "> " else "") + indent
            when (node) {
                is Paragraph, is Heading -> paragraph(inlineChildren(node), prefix)
                is BlockQuote -> blocks(node, indent, true)
                is BulletList -> list(node, indent, quoted, ordered = false)
                is OrderedList -> list(node, indent, quoted, ordered = true)
                is FencedCodeBlock -> picture(MarkdownVisualBlock.Code(node.literal, node.info), prefix)
                is IndentedCodeBlock -> picture(MarkdownVisualBlock.Code(node.literal), prefix)
                is TableBlock -> {
                    val rows = children(node).flatMap { children(it) }
                        .filterIsInstance<TableRow>()
                        .map { row -> children(row).map(::inlineChildren) }
                    picture(MarkdownVisualBlock.Table(rows), prefix)
                }
                is ThematicBreak -> paragraph("────────", prefix)
                is HtmlBlock -> paragraph(stripFormattingHtml(node.literal).trimEnd(), prefix)
                else -> blocks(node, indent, quoted)
            }
        }

        private fun list(node: Node, indent: String, quoted: Boolean, ordered: Boolean) {
            children(node).forEachIndexed { index, item ->
                // CommonMark stores only the first ordinal on OrderedList. Source spans preserve
                // intentionally nonsequential ordinals and the author's '.' / ')' delimiter.
                val marker = if (ordered) {
                    val span = item.sourceSpans.firstOrNull()
                    val original = span?.let { sourceLines.getOrNull(it.lineIndex)?.drop(it.columnIndex) }
                    ORDERED_MARKER.find(original.orEmpty())?.groupValues?.get(1)
                        ?: "${(node as OrderedList).markerStartNumber + index}."
                } else "-"
                val prefix = (if (quoted) "> " else "") + indent
                children(item).forEachIndexed { childIndex, child ->
                    if (childIndex == 0 && child is Paragraph) {
                        val lines = inlineChildren(child).lines()
                        text.append(prefix).append(marker).append(' ').append(lines.first()).append('\n')
                        lines.drop(1).forEach { text.append(prefix).append("  ").append(it).append('\n') }
                    } else {
                        if (childIndex == 0) text.append(prefix).append(marker).append('\n')
                        block(child, "$indent  ", quoted)
                    }
                }
            }
            text.append('\n')
        }

        private fun paragraph(value: String, prefix: String) {
            value.lines().forEach { text.append(prefix).append(it).append('\n') }
            text.append('\n')
        }

        private fun picture(block: MarkdownVisualBlock, prefix: String) {
            val images = try {
                renderer.render(block).also { require(it.isNotEmpty()) { "Renderer produced no images" } }
            } catch (_: Exception) {
                // A broken font/encoder or an oversized block must never drop the reply content.
                paragraph(block.plainText(), prefix)
                return
            } catch (_: LinkageError) {
                // Headless/minimal JRE installations can lack native Java2D/font libraries.
                paragraph(block.plainText(), prefix)
                return
            }
            flush()
            components.addAll(images)
        }

        private fun flush() {
            if (text.isNotEmpty()) {
                val value = text.toString().trim('\n')
                if (value.isNotEmpty()) components += MessageComponent.Text(value + "\n\n")
                text.setLength(0)
            }
        }

        fun finish(): MessageChain {
            flush()
            if (components.lastOrNull() is MessageComponent.Text) {
                val last = components.last() as MessageComponent.Text
                components[components.lastIndex] = last.copy(text = last.text.trimEnd('\n'))
            }
            return MessageChain(components)
        }
    }

    private fun inlineChildren(node: Node): String = children(node).joinToString("") { inline(it) }

    private fun inline(node: Node): String = when (node) {
        is Text -> node.literal
        is Code -> node.literal
        is SoftLineBreak, is HardLineBreak -> "\n"
        is Link -> {
            val label = inlineChildren(node)
            if (label == node.destination || label.isBlank()) node.destination else "$label (${node.destination})"
        }
        is Image -> "[图片: ${inlineChildren(node)}] (${node.destination})"
        is HtmlInline -> stripFormattingHtml(node.literal)
        else -> inlineChildren(node) // Emphasis, strong emphasis, and strikethrough retain their contents.
    }

    private fun stripFormattingHtml(value: String): String = value
        .replace(HTML_BREAK, "\n")
        .replace(HTML_FORMATTING, "")

    private fun children(node: Node): List<Node> = buildList {
        var child = node.firstChild
        while (child != null) {
            add(child)
            child = child.next
        }
    }

    private companion object {
        val ORDERED_MARKER = Regex("^\\s*(\\d+[.)])\\s+")
        val HTML_BREAK = Regex("<br\\s*/?>", RegexOption.IGNORE_CASE)
        val HTML_FORMATTING = Regex("</?(?:u|ins|b|strong|i|em|s|del|strike)(?:\\s[^>]*)?>", RegexOption.IGNORE_CASE)
    }
}

sealed interface MarkdownVisualBlock {
    data class Code(val source: String, val language: String = "") : MarkdownVisualBlock
    data class Table(val rows: List<List<String>>) : MarkdownVisualBlock

    fun plainText(): String = when (this) {
        is Code -> source.removeSuffix("\n")
        is Table -> rows.joinToString("\n") { it.joinToString(" | ") }
    }
}

/** Images are returned atomically so a render failure can fall back to the complete text. */
fun interface MarkdownBlockRenderer {
    fun render(block: MarkdownVisualBlock): List<MessageComponent.Image>
}
